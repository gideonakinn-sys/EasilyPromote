// Views campaigns keep their payouts and refunds exactly as before fixed pay (ticket 09), and their
// books reconcile to the kobo: paid in, a creator's weekly withdrawal, then the brand cancels and
// the unused pool is refunded.
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

test("a views campaign's withdrawal, cancellation refund and ledger reconcile to the kobo", async () => {
  const Slot = require("../../src/models/Slot");
  const Submission = require("../../src/models/Submission");
  const Transaction = require("../../src/models/Transaction");
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");

  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Afrobeats", category: "Music", targetViews: 100000, niches: ["Music"] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  let result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.paidIn, 430000);
  assert.equal(result.platformFee, 129000);
  assert.equal(result.left, 301000);
  const [deposit] = await Transaction.find({ campaignId: id, type: "escrow_deposit" }).lean();
  assert.equal(deposit.bucket, "views");
  assert.equal(deposit.feeAmount, 129000);

  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  await harness.api("POST", "/api/creators/bank-account", {
    token: creator.token,
    body: { accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" },
  });
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: id, slotId: joined.body.id, videoUrl: "https://www.tiktok.com/@c/video/9", caption: "New song" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  // Views come from the platform sync; the fixture records them directly.
  const slot = await Slot.findById(joined.body.id).lean();
  await Submission.updateOne({ _id: submitted.body.id }, { $set: { viewsDelivered: slot.viewTarget } });

  const requested = await harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId: id } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.viewsAmount, slot.reward);
  assert.equal(requested.body.referralAmount, 0);
  assert.equal(requested.body.fixedAmount, 0);
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const paid = await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const releases = await Transaction.find({ campaignId: id, type: "release" }).lean();
  assert.deepEqual(releases.map((r) => [r.bucket, r.amount, r.status]), [["views", slot.reward, "released"]]);

  result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.released, slot.reward);

  const cancelled = await harness.api("PATCH", `/api/campaigns/${id}/cancel`, { token: brand.token });
  assert.equal(cancelled.status, 200);
  const refunds = await Transaction.find({ campaignId: id, type: "refund" }).lean();
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].bucket, "views");
  assert.equal(refunds[0].amount, Math.round((301000 - slot.reward) * 100) / 100);

  result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.left, 0);
  assert.equal(result.platformFee, 129000);
});

test("cancelling a content campaign never refunds the fixed pot automatically", async () => {
  const Transaction = require("../../src/models/Transaction");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Lookbook",
      category: "Fashion",
      campaignObjective: "content",
      contentPay: { ratePerDeliverable: 15000, deliverables: 2 },
      contentDestination: "brand_page",
      creatorAccess: "open_call",
      brief: { summary: "Style it" },
    },
  });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  const [deposit] = await Transaction.find({ campaignId: created.body.id, type: "escrow_deposit" }).lean();
  assert.equal(deposit.bucket, "fixed");

  const cancelled = await harness.api("PATCH", `/api/campaigns/${created.body.id}/cancel`, { token: brand.token });
  assert.equal(cancelled.status, 200);
  assert.equal(await Transaction.countDocuments({ campaignId: created.body.id, type: "refund" }), 0);
});
