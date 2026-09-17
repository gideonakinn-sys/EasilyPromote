// Marketplace sections and paging (M8, SPEC D26–D28): Recommended for You, Trending and New as separate
// pages with cursors per pay-shape tab, the same campaigns and order as the whole-list marketplace older
// web clients still read, reasons on recommended cards, and the dashboard without the marketplace.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  if (harness) await harness.stop();
});

const SECTIONS = ["recommended", "trending", "new"];

async function liveCampaign(body, brand = null) {
  const Campaign = require("../../src/models/Campaign");
  const { ensureCampaignSlots } = require("../../src/utils/ensureSlots");
  brand = brand || (await harness.registerBrand());
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Campaign", category: "Fashion", campaignObjective: "content", contentPay: { ratePerDeliverable: 10000, deliverables: 4 }, ...body },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaign = await Campaign.findByIdAndUpdate(created.body.id, { $set: { status: "live" } }, { new: true });
  await ensureCampaignSlots(campaign);
  return created.body.id;
}

// The paged marketplace reads places and joins from snapshots a few seconds old; tests change the
// database directly, so they start each read fresh.
function fresh() {
  require("../../src/services/marketplace").resetMarketplaceCaches();
}

async function sections(creator, query = "") {
  fresh();
  const res = await harness.api("GET", `/api/creators/marketplace/sections${query}`, { token: creator.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

// Every card of one section for a tab, following cursors page by page.
async function walk(creator, section, tab, limit) {
  const first = await sections(creator, `?tab=${tab}&limit=${limit}`);
  const cards = [...first.sections[section].campaigns];
  let cursor = first.sections[section].nextCursor;
  let pages = 1;
  while (cursor) {
    fresh();
    const res = await harness.api("GET", `/api/creators/marketplace/sections/${section}?tab=${tab}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`, {
      token: creator.token,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.campaigns.length <= limit);
    cards.push(...res.body.campaigns);
    cursor = res.body.nextCursor;
    pages += 1;
    assert.ok(pages < 100, "cursors must end");
  }
  return { cards, total: first.sections[section].total, pages };
}

async function legacyMarketplace(creator) {
  fresh();
  const res = await harness.api("GET", "/api/creators/marketplace", { token: creator.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test("pages walk every campaign once, in the whole-list order, per tab; cursors belong to their section and tab", async () => {
  // Fixed pay, performance (views, sign-ups) and one campaign that trends (3 recent joins of 6 places).
  for (let i = 0; i < 5; i += 1) await liveCampaign({ name: `Fashion ${i}`, category: i % 2 ? "Fashion" : "Music" });
  for (let i = 0; i < 3; i += 1) await liveCampaign({ name: `Views ${i}`, campaignObjective: "views", targetViews: 100000, contentPay: undefined });
  await liveCampaign({ name: "Sign-ups", campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000 }, contentPay: undefined });
  const hot = await liveCampaign({ name: "Hot", category: "Gaming", contentPay: { ratePerDeliverable: 10000, deliverables: 6 } });
  for (let i = 0; i < 3; i += 1) {
    const joiner = await harness.registerCreator({ niches: ["Gaming"] });
    const joined = await harness.api("POST", `/api/campaigns/${hot}/join`, { token: joiner.token });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  const creator = await harness.registerCreator({ niches: ["Music"] });

  const legacy = await legacyMarketplace(creator);
  const legacyIds = legacy.campaigns.map((c) => String(c.id));
  const byId = new Map(legacy.campaigns.map((c) => [String(c.id), c]));

  for (const tab of ["all", "fixed", "performance", "hybrid"]) {
    const walked = {};
    for (const section of SECTIONS) {
      walked[section] = await walk(creator, section, tab, 2);
      assert.equal(walked[section].cards.length, walked[section].total, `${tab}/${section}: total matches what was paged`);
    }
    const ids = SECTIONS.flatMap((section) => walked[section].cards.map((c) => String(c.id)));
    assert.equal(new Set(ids).size, ids.length, `${tab}: no campaign twice`);
    const expected = legacy.campaigns.filter((c) => tab === "all" || c.payShape === tab).map((c) => String(c.id));
    assert.deepEqual([...ids].sort(), [...expected].sort(), `${tab}: no campaign missing`);

    // Recommended in the whole list's order; Trending flagged there; New newest first.
    assert.deepEqual(
      walked.recommended.cards.map((c) => String(c.id)),
      expected.filter((id) => byId.get(id).recommended)
    );
    assert.ok(walked.recommended.cards.every((c) => c.recommended && !c.trending));
    assert.deepEqual(walked.trending.cards.map((c) => String(c.id)).sort(), expected.filter((id) => byId.get(id).trending).sort());
    assert.ok(walked.trending.cards.every((c) => c.trending && c.eligible));
    const newer = walked.new.cards.map((c) => new Date(c.publishedAt).getTime());
    for (let i = 1; i < newer.length; i += 1) assert.ok(newer[i - 1] >= newer[i], `${tab}: New is newest first`);
    for (const card of walked.new.cards) assert.equal(card.payShape === tab || tab === "all", true);
  }
  assert.ok(legacyIds.includes(hot));
  const all = await sections(creator, "?limit=2");
  assert.ok(all.sections.trending.campaigns.some((c) => String(c.id) === hot), "the campaign filling fastest trends");
  assert.equal(all.tabCounts.all, legacy.campaigns.length);
  assert.equal(all.tabCounts.fixed + all.tabCounts.performance + all.tabCounts.hybrid, all.tabCounts.all);
  assert.deepEqual([all.activeSlots, all.maxSlots, all.canClaim, all.locked], [legacy.activeSlots, legacy.maxSlots, legacy.canClaim, legacy.locked]);

  // A cursor only works for the section and tab it came from; bad tabs, limits and sections are refused.
  const cursor = all.sections.new.nextCursor;
  assert.ok(cursor);
  const get = (path) => harness.api("GET", path, { token: creator.token });
  assert.equal((await get(`/api/creators/marketplace/sections/recommended?cursor=${encodeURIComponent(cursor)}`)).body.code, "INVALID_CURSOR");
  assert.equal((await get(`/api/creators/marketplace/sections/new?tab=fixed&cursor=${encodeURIComponent(cursor)}`)).body.code, "INVALID_CURSOR");
  assert.equal((await get("/api/creators/marketplace/sections/new?cursor=garbage")).status, 400);
  assert.equal((await get("/api/creators/marketplace/sections?tab=views")).body.code, "INVALID_TAB");
  assert.equal((await get("/api/creators/marketplace/sections?limit=0")).body.code, "INVALID_LIMIT");
  assert.equal((await get("/api/creators/marketplace/sections?limit=49")).body.code, "INVALID_LIMIT");
  assert.equal((await get("/api/creators/marketplace/sections/popular")).status, 404);
  const brand = await harness.registerBrand();
  assert.equal((await harness.api("GET", "/api/creators/marketplace/sections", { token: brand.token })).status, 403);
});

test("a campaign that goes live between pages never repeats or skips a card on the next page", async () => {
  for (let i = 0; i < 4; i += 1) await liveCampaign({ name: `Before ${i}`, category: "Food" });
  const creator = await harness.registerCreator({ niches: ["Travel"] });
  const first = await sections(creator, "?limit=3");
  const firstIds = first.sections.new.campaigns.map((c) => String(c.id));
  const expectedRest = (await walk(creator, "new", "all", 48)).cards.map((c) => String(c.id)).slice(3);

  const newest = await liveCampaign({ name: "Went live after page one", category: "Food" });
  fresh();
  const next = await harness.api("GET", `/api/creators/marketplace/sections/new?limit=48&cursor=${encodeURIComponent(first.sections.new.nextCursor)}`, {
    token: creator.token,
  });
  assert.equal(next.status, 200, JSON.stringify(next.body));
  const nextIds = next.body.campaigns.map((c) => String(c.id));
  assert.deepEqual(nextIds, expectedRest);
  assert.ok(!nextIds.some((id) => firstIds.includes(id)));
  assert.ok(!nextIds.includes(newest), "the newer campaign belongs before the cursor");
  assert.equal(String((await sections(creator, "?limit=3")).sections.new.campaigns[0].id), newest, "and shows at the top on reload");
});

test("eligibility is respected: campaigns the creator can't join sit in New with the reason, held ones aren't listed", async () => {
  const locked = await liveCampaign({ name: "Verified only", category: "Music", creatorEligibility: { verifiedOnly: true } });
  const open = await liveCampaign({ name: "Open to all", category: "Music" });
  const creator = await harness.registerCreator({ niches: ["Music"] });

  const page = await sections(creator, "?limit=48");
  const where = (id) => SECTIONS.find((section) => page.sections[section].campaigns.some((c) => String(c.id) === id));
  const lockedCard = page.sections.new.campaigns.find((c) => String(c.id) === locked);
  assert.equal(where(locked), "new");
  assert.equal(lockedCard.eligible, false);
  assert.deepEqual(lockedCard.ineligibleReasons, ["Only verified creators can take part"]);
  assert.deepEqual(lockedCard.why, []);
  assert.equal(where(open), "recommended");

  const joined = await harness.api("POST", `/api/campaigns/${open}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const after = await sections(creator, "?limit=48");
  assert.ok(!SECTIONS.some((section) => after.sections[section].campaigns.some((c) => String(c.id) === open)), "a held campaign isn't listed");
  assert.equal(after.activeSlots, 1);
});

test("recommended cards say why, from the creator's own audience and record, and never name another creator", async () => {
  const Submission = require("../../src/models/Submission");
  const lagos = await liveCampaign({ name: "Lagos launch", category: "Food", audienceTargeting: { locations: ["Lagos"] } });
  const creator = await harness.registerCreator({ niches: ["Beauty"] });
  const saved = await harness.api("PUT", "/api/creators/profile/audience", {
    token: creator.token,
    body: { locations: [{ name: "Lagos", percentage: 70 }], proofUrl: "https://files.test/proof.png" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  // Cold start: the audience reason and the match score as the score.
  let page = await sections(creator, "?limit=48");
  let card = page.sections.recommended.campaigns.find((c) => String(c.id) === lagos);
  assert.ok(card, "the Lagos campaign is recommended");
  assert.equal(card.recommendationScore, 70);
  assert.deepEqual(card.why, ["70% of your audience is in Lagos"]);

  // Two finished content campaigns in Beauty: a new Beauty content campaign says they did well.
  for (let i = 0; i < 2; i += 1) {
    const done = await liveCampaign({ name: `Done ${i}`, category: "Beauty" });
    await Submission.create({ campaignId: done, creatorId: creator.id, creatorHandle: creator.username, slotId: new mongoose.Types.ObjectId(), status: "completed", completedAt: new Date() });
  }
  const beauty = await liveCampaign({ name: "Beauty drop", category: "Beauty" });
  const joiner = await harness.registerCreator({ niches: ["Beauty"] });
  await harness.api("POST", `/api/campaigns/${beauty}/join`, { token: joiner.token });

  page = await sections(creator, "?limit=48");
  card = page.sections.recommended.campaigns.find((c) => String(c.id) === beauty);
  assert.ok(card, "the Beauty campaign is recommended");
  assert.deepEqual(card.why, ["Fits your Beauty niche", "You did well on content campaigns"]);
  const text = JSON.stringify(page);
  assert.ok(!text.includes(joiner.username) && !text.includes(joiner.id), "no other creator is named");
});

test("older web clients keep the whole list; the dashboard can leave the marketplace out", async () => {
  await liveCampaign({ name: "Still listed", category: "Music" });
  const creator = await harness.registerCreator({ niches: ["Music"] });

  const legacy = await legacyMarketplace(creator);
  assert.ok(Array.isArray(legacy.campaigns) && legacy.campaigns.length > 0);
  for (const field of ["id", "title", "pay", "payShape", "creatorAccess", "placesLeft", "eligible", "ineligibleReasons", "matchScore", "recommended", "recentCreators", "trending", "slotId", "reward"]) {
    assert.ok(field in legacy.campaigns[0], `whole-list cards still carry ${field}`);
  }
  const recommendedFirst = legacy.campaigns.findIndex((c) => !c.recommended);
  assert.ok(recommendedFirst === -1 || legacy.campaigns.slice(recommendedFirst).every((c) => !c.recommended));

  const full = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  assert.equal(full.status, 200);
  assert.equal(full.body.marketplace.campaigns.length, legacy.campaigns.length);
  const lean = await harness.api("GET", "/api/creators/dashboard?marketplace=none", { token: creator.token });
  assert.equal(lean.status, 200);
  assert.equal(lean.body.marketplace, null);
  assert.ok(lean.body.profile && lean.body.wallet && lean.body.campaigns);
});
