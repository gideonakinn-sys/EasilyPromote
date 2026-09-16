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
  assert.deepEqual(contentCard.pay, { amount: 15000, unit: "approved video" });
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
