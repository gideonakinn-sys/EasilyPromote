// Creator marketplace v2 (ticket 04): every card leads with pay per unit, shows platform,
// target location and access, and says why a creator can't join instead of hiding it.
// The dashboard carries the whole marketplace, so it loads in one request.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  if (harness) await harness.stop();
});

// Content and sign-up campaigns can't be paid for on this branch yet (checkout comes with
// M2), so the fixture creates them through the API, then puts them live directly.
async function liveCampaign(body) {
  const Campaign = require("../../src/models/Campaign");
  const { ensureCampaignSlots } = require("../../src/utils/ensureSlots");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Campaign", category: "Fashion", ...body },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaign = await Campaign.findByIdAndUpdate(created.body.id, { $set: { status: "live" } }, { new: true });
  await ensureCampaignSlots(campaign);
  return created.body.id;
}

async function marketplaceFor(creator) {
  const res = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  assert.equal(res.status, 200);
  return res.body.marketplace;
}

const card = (marketplace, id) => marketplace.campaigns.find((c) => String(c.id) === id);

test("cards lead with pay per unit for every kind of campaign", async () => {
  const content = await liveCampaign({
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 15000, deliverables: 4 },
    audienceTargeting: { locations: ["Lagos"], platforms: ["tiktok"] },
    brief: { summary: "Try on the summer drop", hashtags: ["#SummerDrop"], dos: ["Show the fabric"] },
  });
  const views = await liveCampaign({ campaignObjective: "views", targetViews: 100000, platforms: ["instagram"] });
  const signups = await liveCampaign({ campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000 } });
  const creator = await harness.registerCreator();

  const marketplace = await marketplaceFor(creator);

  const contentCard = card(marketplace, content);
  assert.deepEqual(contentCard.pay, { amount: 15000, unit: "approved deliverable" });
  assert.equal(contentCard.campaignModel, "content");
  assert.equal(contentCard.payShape, "fixed");
  assert.equal(contentCard.creatorAccess, "open_call");
  assert.deepEqual(contentCard.targetPlatforms, ["tiktok"]);
  assert.deepEqual(contentCard.targetLocations, ["Lagos"]);
  assert.equal(contentCard.placesLeft, 4);
  assert.equal(contentCard.briefSummary, "Try on the summer drop");
  // The full brief only unlocks after joining.
  assert.ok(!JSON.stringify(contentCard).includes("#SummerDrop"));
  assert.ok(contentCard.publishedAt);

  const viewsCard = card(marketplace, views);
  assert.equal(viewsCard.payShape, "performance");
  assert.equal(viewsCard.pay.unit, "1,000 views");
  assert.equal(viewsCard.pay.amount, Math.round((viewsCard.reward / viewsCard.viewTarget) * 1000 * 100) / 100);
  assert.deepEqual(viewsCard.targetPlatforms, ["instagram"]);

  // Admin hasn't set the sign-up reward yet.
  assert.deepEqual(card(marketplace, signups).pay, { amount: null, unit: "sign-up" });
});

test("campaigns a creator can't join stay listed with the reason", async () => {
  const id = await liveCampaign({
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 20000, deliverables: 2 },
    creatorAccess: "open_call",
    audienceTargeting: { platforms: ["instagram"] },
    creatorEligibility: { minFollowers: 5000 },
  });
  const creator = await harness.registerCreator();

  const entry = card(await marketplaceFor(creator), id);
  assert.ok(entry, "ineligible campaign is still listed");
  assert.equal(entry.eligible, false);
  assert.deepEqual(entry.ineligibleReasons, ["Needs a connected Instagram account", "Needs 5,000+ followers on Instagram"]);
  assert.equal(entry.recommended, false);
});

test("Recommended for You puts the campaigns that suit the creator's audience first", async () => {
  const abuja = await liveCampaign({
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 10000, deliverables: 2 },
    audienceTargeting: { locations: ["Abuja"] },
  });
  const lagos = await liveCampaign({
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 10000, deliverables: 2 },
    audienceTargeting: { locations: ["Lagos"] },
  });
  const creator = await harness.registerCreator();
  const saved = await harness.api("PUT", "/api/creators/profile/audience", {
    token: creator.token,
    body: { locations: [{ name: "Lagos", percentage: 80 }, { name: "Abuja", percentage: 10 }], proofUrl: "https://files.test/proof.png" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const marketplace = await marketplaceFor(creator);
  const lagosCard = card(marketplace, lagos);
  const abujaCard = card(marketplace, abuja);
  assert.equal(lagosCard.matchScore, 80);
  assert.equal(abujaCard.matchScore, 10);
  assert.equal(lagosCard.recommended, true);
  assert.equal(abujaCard.recommended, false);
  const order = marketplace.campaigns.map((c) => String(c.id));
  assert.ok(order.indexOf(lagos) < order.indexOf(abuja));
});

test("an untargeted campaign is recommended only when it shares the creator's niches or categories", async () => {
  const offNiche = await liveCampaign({ campaignObjective: "views", category: "Finance", targetViews: 100000, niches: ["Finance"] });
  const onNiche = await liveCampaign({ campaignObjective: "views", category: "Finance", targetViews: 100000, niches: ["Music"] });
  const byCategory = await liveCampaign({ campaignObjective: "views", category: "Comedy", targetViews: 100000 });
  const creator = await harness.registerCreator({ niches: ["Music"] });
  const categories = await harness.api("PUT", "/api/creators/profile/me", { token: creator.token, body: { categories: ["Comedy"] } });
  assert.equal(categories.status, 200);

  const marketplace = await marketplaceFor(creator);
  assert.equal(card(marketplace, offNiche).recommended, false);
  assert.equal(card(marketplace, onNiche).recommended, true);
  assert.equal(card(marketplace, byCategory).recommended, true);

  // Recommended first, then everything else newest first.
  const ids = marketplace.campaigns.map((c) => String(c.id));
  const firstOther = marketplace.campaigns.findIndex((c) => !c.recommended);
  assert.ok(marketplace.campaigns.slice(firstOther).every((c) => !c.recommended));
  const others = marketplace.campaigns.slice(firstOther);
  for (let i = 1; i < others.length; i += 1) {
    assert.ok(new Date(others[i - 1].publishedAt) >= new Date(others[i].publishedAt));
  }
  assert.ok(ids.indexOf(onNiche) < ids.indexOf(offNiche));
});

test("a views card prices from the place a join would take", async () => {
  const Slot = require("../../src/models/Slot");
  const id = await liveCampaign({ campaignObjective: "views", targetViews: 100000 });
  // Make the newest open place pay differently from the oldest.
  const newest = await Slot.findOne({ campaignId: id, status: "available" }).sort({ createdAt: -1, _id: -1 });
  await Slot.updateOne({ _id: newest._id }, { $set: { reward: 1, viewTarget: 1000 } });
  const creator = await harness.registerCreator();

  const entry = card(await marketplaceFor(creator), id);
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(entry.pay.amount, Math.round((joined.body.reward / joined.body.viewTarget) * 1000 * 100) / 100);
  assert.equal(entry.reward, joined.body.reward);
});

test("Trending shows the eligible campaigns most creators joined or applied to in the last 72 hours, each creator once", async () => {
  const Campaign = require("../../src/models/Campaign");
  const Slot = require("../../src/models/Slot");
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const { ensureCampaignSlots } = require("../../src/utils/ensureSlots");
  const DAY = 24 * 60 * 60 * 1000;
  const launch = async (body) => {
    const brand = await harness.registerBrand();
    const created = await harness.api("POST", "/api/campaigns", {
      token: brand.token,
      body: { name: "Trending", category: "Fashion", campaignObjective: "content", contentPay: { ratePerDeliverable: 10000, deliverables: 6 }, ...body },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const campaign = await Campaign.findByIdAndUpdate(created.body.id, { $set: { status: "live" } }, { new: true });
    await ensureCampaignSlots(campaign);
    return { id: created.body.id, brand };
  };
  const join = async (id) => {
    const creator = await harness.registerCreator();
    const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    return { creator, slotId: joined.body.id };
  };

  // Open call: three joins now and one four days ago.
  const hot = await launch({ creatorAccess: "open_call" });
  for (let i = 0; i < 3; i += 1) await join(hot.id);
  const old = await join(hot.id);
  await Slot.updateOne({ _id: old.slotId }, { $set: { claimedAt: new Date(Date.now() - 4 * DAY) } });

  // Application required: two applicants, one approved (applied and given a place counts once), one from last week.
  const picky = await launch({ creatorAccess: "application_required" });
  let approvedApplication = null;
  for (let i = 0; i < 3; i += 1) {
    const creator = await harness.registerCreator();
    const applied = await harness.api("POST", `/api/campaigns/${picky.id}/apply`, { token: creator.token, body: {} });
    assert.equal(applied.status, 201, JSON.stringify(applied.body));
    const application = await CampaignApplication.findOne({ campaign: picky.id, creator: creator.id }).lean();
    if (i === 0) approvedApplication = application;
    if (i === 2) await CampaignApplication.updateOne({ _id: application._id }, { $set: { appliedAt: new Date(Date.now() - 7 * DAY) } });
  }
  const approved = await harness.api("POST", `/api/campaigns/${picky.id}/applications/${approvedApplication._id}/approve`, { token: picky.brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  // One join isn't a trend; a campaign the viewer can't join isn't shown as trending.
  const quiet = await launch({ creatorAccess: "open_call" });
  await join(quiet.id);
  const locked = await launch({ creatorAccess: "open_call", creatorEligibility: { verifiedOnly: true } });
  const lockedSlots = await Slot.find({ campaignId: locked.id }).limit(3).lean();
  for (const slot of lockedSlots) {
    const creator = await harness.registerCreator();
    await Slot.updateOne({ _id: slot._id }, { $set: { creatorId: creator.id, status: "claimed", claimedAt: new Date() } });
  }

  const viewer = await harness.registerCreator();
  const marketplace = await marketplaceFor(viewer);
  const hotCard = card(marketplace, hot.id);
  const pickyCard = card(marketplace, picky.id);
  assert.deepEqual([hotCard.recentCreators, hotCard.trending], [3, true]);
  assert.deepEqual([pickyCard.recentCreators, pickyCard.trending], [2, true]);
  assert.deepEqual([card(marketplace, quiet.id).recentCreators, card(marketplace, quiet.id).trending], [1, false]);
  const lockedCard = card(marketplace, locked.id);
  assert.equal(lockedCard.recentCreators, 3);
  assert.equal(lockedCard.eligible, false);
  assert.equal(lockedCard.trending, false);
  assert.ok(marketplace.campaigns.filter((c) => c.trending).length <= 6);
  // Counts only: no creator is named.
  assert.ok(!JSON.stringify(hotCard).includes(old.creator.username));

  // Both halves of the query are served by their index.
  const since = new Date(Date.now() - 3 * DAY);
  const slotPlan = JSON.stringify(await Slot.find({ claimedAt: { $type: "date", $gte: since }, campaignId: { $in: [hot.id] } }).explain());
  assert.match(slotPlan, /claimedAt_-1_campaignId_1_creatorId_1/);
  const applicationPlan = JSON.stringify(await CampaignApplication.find({ appliedAt: { $gte: since }, campaign: { $in: [picky.id] } }).explain());
  assert.match(applicationPlan, /appliedAt_-1_campaign_1_creator_1/);
});

// The marketplace summarises each campaign's open places in the database (load test, ticket 11):
// the card must still show the first place the creator's rank allows, in join order, and count
// every open place.
test("a card shows the first open place the creator's rank allows and counts every open place", async () => {
  const Slot = require("../../src/models/Slot");
  const id = await liveCampaign({ campaignObjective: "views", targetViews: 100000, platforms: ["tiktok"] });
  const creator = await harness.registerCreator();
  const places = await Slot.find({ campaignId: id }).sort({ createdAt: 1, _id: 1 });
  assert.ok(places.length >= 4, `needs 4 places, has ${places.length}`);

  // The first two places need rank 3; the third is open to anyone; one place is already taken.
  const base = places[0].createdAt.getTime();
  await Slot.updateOne({ _id: places[0]._id }, { $set: { rankRequired: "rank3", reward: 900, createdAt: new Date(base) } });
  await Slot.updateOne({ _id: places[1]._id }, { $set: { rankRequired: "rank3", reward: 800, createdAt: new Date(base + 1) } });
  await Slot.updateOne({ _id: places[2]._id }, { $set: { rankRequired: null, reward: 700, createdAt: new Date(base + 2) } });
  for (const [i, place] of places.slice(3).entries()) {
    await Slot.updateOne({ _id: place._id }, { $set: { rankRequired: null, reward: 600, createdAt: new Date(base + 3 + i) } });
  }
  const other = await harness.registerCreator();
  await Slot.updateOne({ _id: places[places.length - 1]._id }, { $set: { creatorId: other.id, status: "claimed", claimedAt: new Date() } });

  let view = card(await marketplaceFor(creator), id);
  assert.equal(view.placesLeft, places.length - 1);
  assert.equal(view.slotsLeft, places.length - 1);
  assert.equal(view.reward, 700, "a rank 1 creator gets the first place without a rank requirement");
  assert.equal(String(view.slotId), String(places[2]._id));
  assert.equal(view.rankLocked, false);

  // Every open place needs rank 3: the card shows the first place, locked, with the reason.
  await Slot.updateMany({ campaignId: id, status: "available" }, { $set: { rankRequired: "rank3" } });
  view = card(await marketplaceFor(creator), id);
  assert.equal(view.rankLocked, true);
  assert.equal(String(view.slotId), String(places[0]._id));
  assert.equal(view.reward, 900);
  assert.equal(view.eligible, false);
  assert.ok(view.ineligibleReasons.some((r) => /rank 3/.test(r)), JSON.stringify(view.ineligibleReasons));

  // No open places left: no card.
  await Slot.updateMany({ campaignId: id, status: "available" }, { $set: { status: "closed" } });
  assert.equal(card(await marketplaceFor(creator), id), undefined);
});

// Live campaigns are kept in the API between marketplace requests (load test, ticket 11); any change
// to a live campaign must still show on the very next request.
test("a campaign that changes, pauses or goes live shows on the next marketplace request", async () => {
  const Campaign = require("../../src/models/Campaign");
  const creator = await harness.registerCreator();
  const id = await liveCampaign({ campaignObjective: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 3 } });
  assert.equal(card(await marketplaceFor(creator), id).pay.amount, 15000);

  await Campaign.updateOne({ _id: id }, { $set: { name: "Renamed while live" } });
  assert.equal(card(await marketplaceFor(creator), id).title, "Renamed while live");

  await Campaign.updateOne({ _id: id }, { $set: { status: "paused" } });
  assert.equal(card(await marketplaceFor(creator), id), undefined);

  await Campaign.updateOne({ _id: id }, { $set: { status: "live" } });
  assert.ok(card(await marketplaceFor(creator), id));

  const second = await liveCampaign({ campaignObjective: "content", contentPay: { ratePerDeliverable: 9000, deliverables: 2 } });
  assert.equal(card(await marketplaceFor(creator), second).pay.amount, 9000);
});
