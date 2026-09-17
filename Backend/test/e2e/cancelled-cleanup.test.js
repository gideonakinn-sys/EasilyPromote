// The hourly clean-up of cancelled campaigns may only remove campaigns nothing depends on.
// A cancelled campaign that was paid for, or that creators joined, keeps its records: they
// back refunds, pay owed to creators, appeals and the payout history.
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

const DAY = 24 * 60 * 60 * 1000;

async function cancel(brand, id) {
  const res = await harness.api("PATCH", `/api/campaigns/${id}/cancel`, { token: brand.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

test("a cancelled campaign that was paid for and joined is never deleted", async () => {
  const Campaign = require("../../src/models/Campaign");
  const Slot = require("../../src/models/Slot");
  const Submission = require("../../src/models/Submission");
  const Transaction = require("../../src/models/Transaction");
  const { cleanupCancelledCampaigns } = require("../../src/utils/cleanupCancelled");

  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Paid views", category: "Music", targetViews: 100000 } });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  const claim = await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: created.body.id } });
  assert.equal(claim.status, 200);
  await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: created.body.id, slotId: claim.body.id, videoUrl: "https://www.tiktok.com/@c/video/1", caption: "hi" },
  });
  await cancel(brand, created.body.id);

  await cleanupCancelledCampaigns({ now: new Date(Date.now() + 3 * DAY) });

  assert.ok(await Campaign.exists({ _id: created.body.id }), "campaign kept");
  assert.ok((await Slot.countDocuments({ campaignId: created.body.id })) > 0, "placements kept");
  assert.equal(await Submission.countDocuments({ campaignId: created.body.id }), 1, "submission kept");
  assert.ok((await Transaction.countDocuments({ campaignId: created.body.id })) > 0, "money trail kept");
});

test("a cancelled campaign nothing depends on is still removed after 24 hours", async () => {
  const Campaign = require("../../src/models/Campaign");
  const { cleanupCancelledCampaigns } = require("../../src/utils/cleanupCancelled");

  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Never paid", category: "Music", targetViews: 100000 } });
  await Campaign.updateOne({ _id: created.body.id }, { $set: { status: "cancelled" } });

  await cleanupCancelledCampaigns({ now: new Date(Date.now() + 2 * 60 * 60 * 1000) });
  assert.ok(await Campaign.exists({ _id: created.body.id }), "kept for its first 24 hours");

  await cleanupCancelledCampaigns({ now: new Date(Date.now() + 2 * DAY) });
  assert.equal(await Campaign.exists({ _id: created.body.id }), null, "removed once nothing depends on it");
});

test("admins and brands can't delete a campaign that money, creators or content depend on", async () => {
  const Campaign = require("../../src/models/Campaign");
  const admin = await harness.registerAdmin({ role: "super_admin" });
  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();

  const paid = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Paid then cancelled", category: "Music", targetViews: 100000 } });
  const checkout = await harness.api("POST", `/api/campaigns/${paid.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${paid.body.id}/payment-status`, { token: brand.token });
  await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: paid.body.id } });
  await cancel(brand, paid.body.id);

  const refused = await harness.api("DELETE", `/api/admin/campaigns/${paid.body.id}`, { token: admin.token });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, "CAMPAIGN_HAS_RECORDS");
  assert.ok(await Campaign.exists({ _id: paid.body.id }));

  // A pending checkout the brand abandons can still be deleted while nothing was booked.
  const draft = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Abandoned", category: "Music", targetViews: 100000 } });
  await harness.api("POST", `/api/campaigns/${draft.body.id}/pay`, { token: brand.token });
  const deleted = await harness.api("DELETE", `/api/campaigns/${draft.body.id}`, { token: brand.token });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const unused = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Admin removes", category: "Music", targetViews: 100000 } });
  const adminDeleted = await harness.api("DELETE", `/api/admin/campaigns/${unused.body.id}`, { token: admin.token });
  assert.equal(adminDeleted.status, 200, JSON.stringify(adminDeleted.body));
});
