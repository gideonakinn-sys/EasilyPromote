// Open Call join (ticket 05): an eligible creator joins and a place is reserved; an
// ineligible one is told every rule they missed and nothing is reserved.
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

const brief = {
  summary: "Style three looks from the summer drop",
  dos: ["Show the fabric up close"],
  donts: ["No competitor brands in frame"],
  hashtags: ["#SummerDrop"],
  soundUrl: "https://www.tiktok.com/music/summer-123",
  referenceVideos: ["https://www.tiktok.com/@brand/video/1"],
};

// Content campaigns can't be paid for on this branch yet (checkout comes with M2), so the
// fixture creates one through the API, then puts it live and opens its placements directly.
async function liveCampaign(body) {
  const Campaign = require("../../src/models/Campaign");
  const { ensureCampaignSlots } = require("../../src/utils/ensureSlots");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Summer lookbook", category: "Fashion", ...body },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaign = await Campaign.findByIdAndUpdate(created.body.id, { $set: { status: "live" } }, { new: true });
  await ensureCampaignSlots(campaign);
  return { brand, id: created.body.id };
}

const contentBody = (overrides = {}) => ({
  campaignObjective: "content",
  contentPay: { ratePerDeliverable: 15000, deliverables: 3 },
  creatorAccess: "open_call",
  brief,
  ...overrides,
});

async function heldPlacements(campaignId) {
  const Slot = require("../../src/models/Slot");
  return Slot.find({ campaignId, status: { $ne: "available" } }).lean();
}

test("an eligible creator joins an Open Call content campaign and gets the full brief", async () => {
  const { id } = await liveCampaign(contentBody());
  const creator = await harness.registerCreator();

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.status, "claimed");
  assert.equal(joined.body.kind, "deliverable");
  assert.equal(joined.body.reward, 15000);
  assert.equal(joined.body.placesLeft, 2);
  assert.deepEqual(joined.body.brief.hashtags, ["#SummerDrop"]);
  assert.equal(joined.body.brief.soundUrl, brief.soundUrl);

  const held = await heldPlacements(id);
  assert.equal(held.length, 1);
  assert.equal(String(held[0].creatorId), creator.id);

  // The full brief stays with the creator's campaign afterwards.
  const dashboard = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  const mine = dashboard.body.campaigns.campaigns.find((c) => String(c.id) === id);
  assert.ok(mine, "joined campaign is in the creator's campaigns");
  assert.deepEqual(mine.brief.dos, brief.dos);
  assert.deepEqual(mine.brief.referenceVideos, brief.referenceVideos);
});

test("an ineligible creator is told every rule they missed and nothing is reserved", async () => {
  const { id } = await liveCampaign(
    contentBody({
      audienceTargeting: { platforms: ["instagram"] },
      creatorEligibility: { minFollowers: 5000, verifiedOnly: true },
    })
  );
  const creator = await harness.registerCreator();

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 403);
  assert.equal(joined.body.code, "NOT_ELIGIBLE");
  assert.deepEqual(joined.body.failures.map((f) => f.criterion).sort(), ["minFollowers", "platform", "verified"]);
  assert.ok(joined.body.failures.every((f) => typeof f.message === "string" && f.message.length > 0));
  assert.equal((await heldPlacements(id)).length, 0);
});

test("today's join rules are part of the eligibility check", async () => {
  const { id } = await liveCampaign(contentBody());
  const creator = await harness.registerCreator({ niches: [], connected: false });

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 403);
  assert.deepEqual(joined.body.failures.map((f) => f.criterion).sort(), ["niches", "socialAccount"]);
  assert.equal((await heldPlacements(id)).length, 0);
});

test("a creator with three active placements can't join a fourth", async () => {
  const creator = await harness.registerCreator();
  for (let i = 0; i < 3; i += 1) {
    const { id } = await liveCampaign(contentBody());
    const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
    assert.equal(joined.status, 200);
  }
  const { id } = await liveCampaign(contentBody());
  const fourth = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(fourth.status, 403);
  assert.deepEqual(fourth.body.failures.map((f) => f.criterion), ["placementLimit"]);
});

test("two creators racing for the last place: exactly one gets it", async () => {
  const { id } = await liveCampaign(contentBody({ contentPay: { ratePerDeliverable: 15000, deliverables: 1 } }));
  const [first, second] = await Promise.all([harness.registerCreator(), harness.registerCreator()]);

  const results = await Promise.all(
    [first, second].map((c) => harness.api("POST", `/api/campaigns/${id}/join`, { token: c.token }))
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const lost = results.find((r) => r.status === 409);
  assert.equal(lost.body.code, "CAMPAIGN_FULL");
  assert.equal((await heldPlacements(id)).length, 1);
});

test("a creator can't hold two places on the same campaign, even joining twice at once", async () => {
  const Slot = require("../../src/models/Slot");
  await Slot.init();
  const { id } = await liveCampaign(contentBody({ contentPay: { ratePerDeliverable: 15000, deliverables: 5 } }));
  const creator = await harness.registerCreator();

  const results = await Promise.all(
    [1, 2, 3].map(() => harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token }))
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
  for (const r of results.filter((r) => r.status !== 200)) {
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_JOINED");
  }
  assert.equal((await heldPlacements(id)).length, 1);

  const again = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "ALREADY_JOINED");
});

test("join is refused on Application Required campaigns", async () => {
  const { id } = await liveCampaign(contentBody({ creatorAccess: "application_required" }));
  const creator = await harness.registerCreator();

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 403);
  assert.equal(joined.body.code, "APPLICATION_REQUIRED");
  assert.equal((await heldPlacements(id)).length, 0);

  // The older claim route is the same reservation path, so it refuses too.
  const claimed = await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: id } });
  assert.equal(claimed.status, 403);
  assert.equal((await heldPlacements(id)).length, 0);
});

test("joining a sign-up campaign hands the creator their referral code", async () => {
  const { id } = await liveCampaign({
    campaignObjective: "signups",
    targetViews: 100000,
    referral: { requestedBudget: 50000 },
  });
  const creator = await harness.registerCreator();

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.kind, "views");
  assert.ok(joined.body.referralCode, "referral code is ready on join");
});

test("an existing views campaign is joined through the same path", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Afrobeats", category: "Music", targetViews: 100000, niches: ["Music"] },
  });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });

  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${created.body.id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.kind, "views");
  assert.ok(joined.body.viewTarget > 0);
  assert.ok(joined.body.reward > 0);
  assert.equal(joined.body.placesLeft, 4);
});
