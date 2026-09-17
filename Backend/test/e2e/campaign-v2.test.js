// Campaign v2 (ticket 02): campaign model, objective, pay shape, rate authority, destination,
// access, targeting, eligibility and brief — added beside the existing campaign fields (ADR 0001).
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

const contentCampaign = {
  name: "Summer lookbook",
  category: "Fashion",
  campaignObjective: "content",
  payShape: "fixed",
  contentPay: { ratePerDeliverable: 15000, deliverables: 10 },
  contentDestination: "both",
  creatorAccess: "application_required",
  audienceTargeting: { locations: ["Lagos"], minLocationShare: 50, ageRanges: ["18-24", "25-34"], genders: ["female"], interests: ["fashion"], platforms: ["tiktok", "instagram"] },
  creatorEligibility: { minFollowers: 5000, minEngagementRate: 3, categories: ["Fashion", "Lifestyle"], verifiedOnly: true, minRank: "rank2", requiredBadges: [] },
  brief: {
    summary: "Style three looks from the summer drop",
    dos: ["Show the fabric up close"],
    donts: ["No competitor brands in frame"],
    hashtags: ["#SummerDrop"],
    soundUrl: "https://www.tiktok.com/music/summer-123",
    referenceVideos: ["https://www.tiktok.com/@brand/video/1"],
    tone: "Playful",
    keyMessages: ["Breathable cotton"],
    productInfo: "Linen shirts, ₦18,000",
    approvalRequirements: "Send a draft before posting",
  },
};

async function getCampaign(brand, id) {
  const res = await harness.api("GET", `/api/campaigns/${id}`, { token: brand.token });
  assert.equal(res.status, 200);
  return res.body;
}

test("a brand creates a content campaign and is quoted its rate times deliverables plus the fee", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: contentCampaign });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.quote, { creatorBudget: 150000, performanceBudget: 0, platformFee: 45000, total: 195000 });

  const campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.campaignObjective, "content");
  assert.equal(campaign.campaignModel, "content");
  assert.equal(campaign.payShape, "fixed");
  assert.equal(campaign.rateAuthority, "brand");
  assert.deepEqual(campaign.contentPay, { ratePerDeliverable: 15000, deliverables: 10 });
  assert.equal(campaign.contentDestination, "both");
  assert.equal(campaign.creatorAccess, "application_required");
  assert.deepEqual(campaign.audienceTargeting, contentCampaign.audienceTargeting);
  assert.deepEqual(campaign.creatorEligibility, contentCampaign.creatorEligibility);
  assert.deepEqual(campaign.brief, contentCampaign.brief);
  assert.equal(campaign.budget, 195000);
  assert.equal(campaign.creatorPool, 150000);
  assert.equal(campaign.platformFee, 45000);
});

test("a campaign created the old way gets the matching v2 fields and today's price", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Old wizard", category: "Music", targetViews: 100000 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.budget, 430000);

  const campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.campaignObjective, "views");
  assert.equal(campaign.campaignModel, "performance");
  assert.equal(campaign.payShape, "performance");
  assert.equal(campaign.performanceMetric, "views");
  assert.equal(campaign.rateAuthority, "platform");
  assert.equal(campaign.creatorAccess, "open_call");
  assert.equal(campaign.contentDestination, "creator_page");
  assert.equal(campaign.objective, "views");
  assert.equal(campaign.creatorPool, 301000);

  const purchases = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Old wizard purchases", category: "Tech", objective: "actions", targetViews: 100000, referral: { eventTypes: ["purchase"], requestedBudget: 20000 } },
  });
  assert.equal(purchases.status, 201, JSON.stringify(purchases.body));
  const purchaseCampaign = await getCampaign(brand, purchases.body.id);
  assert.equal(purchaseCampaign.campaignObjective, "sales");
  assert.deepEqual(purchaseCampaign.referral.eventTypes, ["purchase"]);
  assert.equal(purchaseCampaign.rateAuthority, "admin");
});

test("a sign-ups campaign turns on referral tracking and leaves the reward to admin", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "App launch", category: "Tech", campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000 } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.quote, { creatorBudget: 301000, performanceBudget: 35000, platformFee: 144000, total: 480000 });

  const campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.objective, "actions");
  assert.equal(campaign.referral.enabled, true);
  assert.deepEqual(campaign.referral.eventTypes, ["signup"]);
  assert.equal(campaign.rateAuthority, "admin");
  assert.equal(campaign.performanceMetric, "signups");
});

test("brands can't set a rate that EasilyPromote or admin owns (ADR 0003)", async () => {
  const brand = await harness.registerBrand();
  const attempts = [
    { name: "Views rate", category: "Music", targetViews: 100000, costPerView: 0.5 },
    { name: "Reward", category: "Tech", campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000, rewardPerConversion: 1000 } },
    { name: "Content pay on views", category: "Music", campaignObjective: "views", targetViews: 100000, contentPay: { ratePerDeliverable: 1000, deliverables: 3 } },
  ];
  for (const body of attempts) {
    const res = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
    assert.equal(res.status, 400, body.name);
    assert.equal(res.body.code, "RATE_NOT_BRAND_SET", body.name);
  }
});

test("hybrid pay is for content campaigns only, and objectives that aren't ready are refused with a reason", async () => {
  const brand = await harness.registerBrand();
  const performanceHybrid = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Views hybrid", category: "Tech", campaignObjective: "views", payShape: "hybrid", targetViews: 100000 },
  });
  assert.equal(performanceHybrid.status, 400);
  assert.match(performanceHybrid.body.error, /Hybrid pay is for content campaigns/);

  // Hybrid drafts can be saved before the bonus is set; they're unpriced until then (ticket 10).
  const unpricedHybrid = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Hybrid draft", category: "Beauty", campaignObjective: "content", payShape: "hybrid" },
  });
  assert.equal(unpricedHybrid.status, 201, JSON.stringify(unpricedHybrid.body));
  assert.equal(unpricedHybrid.body.quote, null);

  const sales = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Sales", category: "Tech", campaignObjective: "sales", targetViews: 100000 } });
  assert.equal(sales.status, 400);
  assert.match(sales.body.error, /available yet/);

  const badPay = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { ...contentCampaign, contentPay: { ratePerDeliverable: 0, deliverables: 3 } } });
  assert.equal(badPay.status, 400);
});

test("editing a draft content campaign's pay reprices it; a draft can't switch to a rate it doesn't own", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: contentCampaign });

  const edited = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, {
    token: brand.token,
    body: { contentPay: { ratePerDeliverable: 20000, deliverables: 5 }, creatorAccess: "open_call" },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));

  const campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.budget, 130000);
  assert.equal(campaign.creatorPool, 100000);
  assert.equal(campaign.platformFee, 30000);
  assert.equal(campaign.creatorAccess, "open_call");

  const views = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Views", category: "Music", targetViews: 100000 } });
  const resized = await harness.api("PATCH", `/api/campaigns/${views.body.id}`, { token: brand.token, body: { targetViews: 200000 } });
  assert.equal(resized.status, 200);
  const viewsCampaign = await getCampaign(brand, views.body.id);
  assert.deepEqual([viewsCampaign.budget, viewsCampaign.platformFee, viewsCampaign.creatorPool], [780000, 234000, 546000]);

  const rate = await harness.api("PATCH", `/api/campaigns/${views.body.id}`, { token: brand.token, body: { costPerView: 0.1 } });
  assert.equal(rate.status, 400);
  assert.equal(rate.body.code, "RATE_NOT_BRAND_SET");
});

test("the old wizard can still switch a draft between views and referral tracking", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Switcher", category: "Tech", targetViews: 100000 } });

  const toActions = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, {
    token: brand.token,
    body: { objective: "actions", referral: { eventTypes: ["signup"], requestedBudget: 50000 } },
  });
  assert.equal(toActions.status, 200, JSON.stringify(toActions.body));
  let campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.objective, campaign.referral.enabled, campaign.campaignObjective, campaign.rateAuthority], ["actions", true, "signups", "admin"]);

  const toInstalls = await harness.api("PATCH", `/api/campaigns/${created.body.id}/save-and-close`, {
    token: brand.token,
    body: { step: 3, data: { objective: "actions", referral: { eventTypes: ["install"], requestedBudget: 50000 } } },
  });
  assert.equal(toInstalls.status, 200, JSON.stringify(toInstalls.body));
  campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.objective, campaign.campaignObjective, campaign.performanceMetric], ["actions", "downloads", "downloads"]);

  const backToViews = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { objective: "views" } });
  assert.equal(backToViews.status, 200);
  campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.objective, campaign.referral.enabled, campaign.campaignObjective, campaign.rateAuthority], ["views", false, "views", "platform"]);
});

test("editing unrelated fields never reprices a campaign or resets its checkout", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Priced last year", category: "Music", targetViews: 100000 } });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200);
  // An older campaign priced before the current price table.
  await Campaign.collection.updateOne(
    { _id: new (require("mongoose").Types.ObjectId)(created.body.id) },
    { $set: { budget: 400000, platformFee: 120000, creatorPool: 280000, costPerView: 4, paymentAmount: 400000 } }
  );

  for (const edit of [
    () => harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { name: "Renamed" } }),
    () => harness.api("PATCH", `/api/campaigns/${created.body.id}/save-and-close`, { token: brand.token, body: { step: 2, data: { contentBrief: "New brief" } } }),
  ]) {
    const res = await edit();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const stored = await Campaign.findById(created.body.id).lean();
    assert.deepEqual(
      [stored.status, stored.budget, stored.platformFee, stored.creatorPool, stored.costPerView, stored.paymentAmount, stored.paymentReference],
      ["pending_payment", 400000, 120000, 280000, 4, 400000, checkout.body.reference]
    );
  }
});

test("older clients changing only the objective or referral switch keep conversion types and both objective fields in step", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Mixed", category: "Tech", objective: "actions", targetViews: 100000, referral: { eventTypes: ["install", "purchase"], requestedBudget: 20000 } },
  });

  const toViews = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { referral: { enabled: false } } });
  assert.equal(toViews.status, 200, JSON.stringify(toViews.body));
  let campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.objective, campaign.campaignObjective], ["views", "views"]);

  const backToActions = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { objective: "actions" } });
  assert.equal(backToActions.status, 200, JSON.stringify(backToActions.body));
  campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual(campaign.referral.eventTypes, ["install", "purchase"]);
  assert.deepEqual([campaign.objective, campaign.campaignObjective], ["actions", "downloads"]);

  const step3 = await harness.api("PATCH", `/api/campaigns/${created.body.id}/save-and-close`, {
    token: brand.token,
    body: { step: 3, data: { objective: "actions" } },
  });
  assert.equal(step3.status, 200);
  campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual(campaign.referral.eventTypes, ["install", "purchase"]);
});

test("a content campaign ignores target views from older wizard steps", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: contentCampaign });
  const patch = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { targetViews: 100000, name: "Still content" } });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const step1 = await harness.api("PATCH", `/api/campaigns/${created.body.id}/save-and-close`, { token: brand.token, body: { step: 1, data: { targetViews: 100000 } } });
  assert.equal(step1.status, 200);
  const campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.targetViews, campaign.budget, campaign.name], [undefined, 195000, "Still content"]);
});

test("admin can only set a conversion reward where admin is the rate authority", async () => {
  const Campaign = require("../../src/models/Campaign");
  const admin = await harness.registerAdmin();
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: contentCampaign });
  // Even if referral tracking were switched on by mistake, a brand-rate campaign has no admin reward.
  await Campaign.updateOne({ _id: created.body.id }, { $set: { "referral.enabled": true, status: "live" } });

  const res = await harness.api("PATCH", `/api/admin/referrals/campaigns/${created.body.id}/reward`, { token: admin.token, body: { rewardPerConversion: 500 } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "RATE_NOT_ADMIN_SET");
});
