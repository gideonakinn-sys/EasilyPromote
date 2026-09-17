// Migration (ticket 02): existing campaigns get Campaign v2 fields and nothing about their money changes.
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

const V2_FIELDS = ["campaignObjective", "campaignModel", "payShape", "rateAuthority", "performanceMetric", "contentDestination", "creatorAccess"];

test("existing campaigns gain v2 fields with money, placements and transactions untouched", async () => {
  const Campaign = require("../../src/models/Campaign");
  const Slot = require("../../src/models/Slot");
  const Transaction = require("../../src/models/Transaction");
  const { migrateCampaignsToV2 } = require("../../scripts/migrateCampaignV2");

  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();

  const live = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Live views", category: "Music", targetViews: 100000 } });
  const checkout = await harness.api("POST", `/api/campaigns/${live.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${live.body.id}/payment-status`, { token: brand.token });
  await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: live.body.id } });

  const draft = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Draft installs", category: "Tech", objective: "actions", targetViews: 100000, referral: { eventTypes: ["install"], requestedBudget: 20000 } } });

  // Campaigns made before the campaign engine have none of the v2 fields.
  const ids = [live.body.id, draft.body.id];
  await Campaign.collection.updateMany({ _id: { $in: ids.map((id) => new (require("mongoose").Types.ObjectId)(id)) } }, { $unset: Object.fromEntries(V2_FIELDS.map((f) => [f, 1])) });

  const snapshot = async () => ({
    campaigns: await Campaign.find({ _id: { $in: ids } }).select("budget costPerView platformFee creatorPool paymentAmount status objective referral targetViews").sort({ _id: 1 }).lean(),
    slots: await Slot.find({ campaignId: { $in: ids } }).select("reward viewTarget status creatorId").sort({ _id: 1 }).lean(),
    transactions: await Transaction.find({ campaignId: { $in: ids } }).sort({ _id: 1 }).lean(),
  });
  const beforeMigration = await snapshot();

  const dryRun = await migrateCampaignsToV2({ dryRun: true });
  assert.equal(dryRun.toMigrate, 2);
  assert.equal((await Campaign.findById(live.body.id).lean()).campaignObjective, undefined);

  const result = await migrateCampaignsToV2({ dryRun: false });
  assert.equal(result.migrated, 2);

  const liveCampaign = await Campaign.findById(live.body.id).lean();
  assert.deepEqual(V2_FIELDS.map((f) => liveCampaign[f]), ["views", "performance", "performance", "platform", "views", "creator_page", "open_call"]);
  const draftCampaign = await Campaign.findById(draft.body.id).lean();
  assert.deepEqual(V2_FIELDS.map((f) => draftCampaign[f]), ["downloads", "performance", "performance", "admin", "downloads", "creator_page", "open_call"]);

  assert.deepEqual(await snapshot(), beforeMigration);

  const again = await migrateCampaignsToV2({ dryRun: false });
  assert.equal(again.migrated, 0);
});
