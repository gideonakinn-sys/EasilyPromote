// A live content campaign offers one placement per deliverable the brand paid for, each
// paying the brand's rate. Views campaigns keep splitting views and pool across placements.
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

test("a content campaign gets one placement per deliverable at the brand's rate", async () => {
  const Campaign = require("../../src/models/Campaign");
  const Slot = require("../../src/models/Slot");
  const { ensureCampaignSlots, syncCampaignSlots } = require("../../src/utils/ensureSlots");

  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "UGC", category: "Beauty", campaignObjective: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 7 } },
  });
  assert.equal(created.status, 201);

  const campaign = await Campaign.findById(created.body.id);
  await ensureCampaignSlots(campaign);
  const slots = await Slot.find({ campaignId: campaign._id }).lean();
  assert.equal(slots.length, 7);
  for (const slot of slots) {
    assert.equal(slot.reward, 15000);
    assert.equal(slot.kind, "deliverable");
    assert.equal(slot.viewTarget, undefined);
    assert.equal(slot.status, "available");
  }

  // Admin's slot-count tool can't change how many deliverables a content campaign bought.
  await assert.rejects(() => syncCampaignSlots(campaign, 3), /deliverables/);
  assert.equal(await Slot.countDocuments({ campaignId: campaign._id }), 7);
});
