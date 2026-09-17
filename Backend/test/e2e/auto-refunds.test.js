// Automatic unused-budget refunds (ticket 11, D5 amended): once a campaign ends, a job refunds the
// unused content base, the unused hybrid bonus pool and unused views / referral budget, with no Paystack
// fee deducted, through the same crash-safe refund rows admins use. It never refunds money creators can
// still earn or are owed, runs any number of times without refunding twice, finishes what a crash
// interrupted, and raises an ops alert when it can't refund.
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
const RATE = 10000;
const REWARD = 500;
const model = (name) => require(`../../src/models/${name}`);
const run = (now = new Date()) => require("../../src/services/autoRefunds").runAutoRefunds({ now });
const patch = (path, token, body) => harness.api("PATCH", path, { token, body });
const refundRows = (campaignId, bucket) => model("Transaction").find({ campaignId, type: "refund", ...(bucket && { bucket }) }).sort({ createdAt: 1 }).lean();

async function assertBalanced(campaignId) {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const result = await reconcileCampaignById(campaignId);
  assert.ok(result.ok, JSON.stringify(result.problems));
  return result;
}

async function pay(brand, body) {
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { id, reference: checkout.body.reference };
}

async function connectBrandApp(brand) {
  const now = new Date();
  await model("BusinessProfile").updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

async function joinAndSubmit(campaignId, { submit = true } = {}) {
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${campaignId}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  if (!submit) return { ...creator, slotId: joined.body.id, referralCode: joined.body.referralCode || null };
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId, videoUrl: "https://drive.example.com/cut.mp4", caption: "Looks #AutoRefund" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { ...creator, submissionId: submitted.body.id, referralCode: joined.body.referralCode || null };
}

const complete = async (admin, id, daysAgo = 0) => {
  assert.equal((await patch(`/api/admin/campaigns/${id}/status`, admin.token, { status: "completed" })).status, 200);
  if (daysAgo) await model("Campaign").updateOne({ _id: id }, { $set: { completedAt: new Date(Date.now() - daysAgo * DAY) } });
};

let conversionCounter = 0;
function sendConversion(key, code) {
  const { buildSignedRequest } = require("../../src/services/conversions");
  conversionCounter += 1;
  const request = buildSignedRequest({
    keyId: key.keyId,
    secret: key.secret,
    payload: { event_id: `auto_${Date.now()}_${conversionCounter}`, code, event: "signup", timestamp: new Date().toISOString() },
  });
  return harness.rawPost("/api/webhooks/conversions", request);
}

test("content: unused deliverables are refunded automatically with their fee; delivery-pending pay and appealable rejections wait; repeats refund nothing", async () => {
  const brand = await harness.registerBrand();
  const { id, reference } = await pay(brand, {
    name: "Auto content",
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: RATE, deliverables: 4 },
    contentDestination: "brand_page",
    creatorAccess: "open_call",
    brief: { summary: "Style it", hashtags: ["#AutoRefund"] },
  });
  // One approved and credited but not delivered yet; one rejected (appealable for 7 days); two never taken.
  const owed = await joinAndSubmit(id);
  assert.equal((await patch(`/api/submissions/${owed.submissionId}/approve`, brand.token)).status, 200);
  const rejected = await joinAndSubmit(id);
  assert.equal((await patch(`/api/submissions/${rejected.submissionId}/reject`, brand.token, { reason: "Off brief" })).status, 200);

  // Nothing while the campaign is live.
  await run();
  assert.equal((await refundRows(id)).length, 0);

  const admin = await harness.registerAdmin({ role: "admin" });
  await complete(admin, id);
  const first = await run();
  assert.ok(first.refunds.some((r) => String(r.campaignId) === id && r.pot === "fixed"));
  let rows = await refundRows(id, "fixed");
  // 2 unused × ₦10,000 + 2/4 of the ₦12,000 fee; no Paystack fee deducted.
  assert.deepEqual(rows.map((r) => [r.amount, r.refundBreakdown.deliverables]), [[26000, 2]]);
  assert.equal(harness.paystack.refunds(reference).length, 1);
  assert.ok(await model("Notification").exists({ businessId: brand.id, campaignId: id, type: "campaign_refund" }));
  assert.ok(await model("AdminActivity").exists({ action: "campaign.unused_budget_auto_refunded", targetId: id }));
  await assertBalanced(id);

  // Idempotent: more runs refund nothing more.
  await run();
  await run();
  assert.equal((await refundRows(id, "fixed")).length, 1);
  assert.equal(harness.paystack.refunds(reference).length, 1);

  // Once the rejection can't be appealed any more, its deliverable is refunded too; the credited one never is.
  await model("Submission").updateOne({ _id: rejected.submissionId }, { $set: { appealableUntil: new Date(Date.now() - 1000) } });
  await run();
  rows = await refundRows(id, "fixed");
  assert.deepEqual(rows.map((r) => r.amount), [26000, 13000]);
  await run();
  assert.equal((await refundRows(id, "fixed")).length, 2);
  const result = await assertBalanced(id);
  assert.equal(result.owed, RATE, "the delivery-pending pay stays owed");
  assert.equal(result.left, 0);
});

test("content: an admin refund first leaves the job nothing; a cancelled campaign is refunded at once", async () => {
  const brand = await harness.registerBrand();
  const body = (name) => ({
    name,
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: RATE, deliverables: 2 },
    contentDestination: "creator_page",
    creatorAccess: "open_call",
    brief: { summary: "Style it" },
  });
  const manual = await pay(brand, body("Manual first"));
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  await complete(finance, manual.id);
  const refunded = await harness.api("POST", `/api/admin/campaigns/${manual.id}/refund-unused`, { token: finance.token, body: { expectedAmount: 26000 } });
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  await run();
  assert.equal((await refundRows(manual.id)).length, 1);
  assert.equal(harness.paystack.refunds(manual.reference).length, 1);

  const cancelled = await pay(brand, body("Cancelled"));
  assert.equal((await harness.api("PATCH", `/api/campaigns/${cancelled.id}/cancel`, { token: brand.token })).status, 200);
  assert.equal((await refundRows(cancelled.id)).length, 0, "cancelling itself never refunds the fixed pot");
  await run();
  assert.deepEqual((await refundRows(cancelled.id)).map((r) => [r.bucket, r.amount]), [["fixed", 26000]]);
  await assertBalanced(cancelled.id);
});

test("hybrid: the unused sign-up bonus pool waits 7 days after completion and for open appeals, then is refunded once", async () => {
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const { id, reference } = await pay(brand, {
    name: "Auto hybrid",
    category: "Beauty",
    campaignObjective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: 5000, deliverables: 2 },
    hybridBonus: { metric: "signups", pool: 10000, capPerCreator: 5000 },
    contentDestination: "brand_page",
    creatorAccess: "open_call",
    brief: { summary: "Glow" },
  });
  const appealing = await joinAndSubmit(id);
  assert.equal((await patch(`/api/submissions/${appealing.submissionId}/reject`, brand.token, { reason: "Off brief" })).status, 200);
  assert.equal((await patch(`/api/submissions/${appealing.submissionId}/appeal`, appealing.token, { reason: "It follows the brief" })).status, 200);
  const admin = await harness.registerAdmin({ role: "super_admin" });
  await complete(admin, id);

  // The base's unused deliverable (the untaken one) is refunded at once; the bonus waits for sign-ups to stop counting.
  await run();
  assert.deepEqual((await refundRows(id)).map((r) => r.bucket), ["fixed"]);

  await model("Campaign").updateOne({ _id: id }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  await run();
  assert.deepEqual((await refundRows(id)).map((r) => r.bucket), ["fixed"], "the appeal is still open");

  const decided = await patch(`/api/admin/submissions/${appealing.submissionId}/appeal`, admin.token, { decision: "reject", notes: "Doesn't meet the brief" });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  await run();
  const bonus = await refundRows(id, "bonus");
  // ₦10,000 unused pool + its ₦3,000 fee.
  assert.deepEqual(bonus.map((r) => r.amount), [13000]);
  await run();
  assert.equal((await refundRows(id, "bonus")).length, 1);
  assert.equal((await model("Campaign").findById(id).lean()).hybridBonus.poolRemaining, 0);
  assert.ok(harness.paystack.refunds(reference).length >= 2);
  await assertBalanced(id);
});

test("views and referral: a completed campaign keeps every placed creator's reward and earned rewards, refunds the rest 7 days later", async () => {
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const { id } = await pay(brand, {
    name: "Auto signups",
    category: "Tech",
    campaignObjective: "signups",
    targetViews: 100000,
    referral: { requestedBudget: 50000 },
    creatorAccess: "open_call",
    brief: { summary: "Sign up" },
  });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  assert.equal((await patch(`/api/admin/referrals/campaigns/${id}/reward`, finance.token, { rewardPerConversion: REWARD })).status, 200);
  const key = await harness.api("POST", "/api/referral/keys", { token: brand.token, body: { name: "Server" } });
  const creator = await joinAndSubmit(id, { submit: false });
  assert.equal((await sendConversion({ keyId: key.body.key.keyId, secret: key.body.secret }, creator.referralCode)).status, 200);
  const slot = await model("Slot").findById(creator.slotId).lean();

  await complete(finance, id);
  await run();
  assert.equal((await refundRows(id)).length, 0, "nothing until conversions stop counting");

  await model("Campaign").updateOne({ _id: id }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  await run();
  const campaign = await model("Campaign").findById(id).lean();
  const rows = await refundRows(id);
  const byPot = Object.fromEntries(rows.map((r) => [r.bucket, r.amount]));
  // Views: the creator pool less the placed creator's full reward.
  assert.equal(byPot.views, Math.round((campaign.creatorPool - slot.reward) * 100) / 100);
  // Referral: the unearned pool grossed up by its 30% fee.
  assert.equal(byPot.referral, Math.round(((campaign.referral.pool - REWARD) * 100) / 70 * 100) / 100);
  await run();
  assert.equal((await refundRows(id)).length, 2);
  await assertBalanced(id);

  // The placed creator can still earn and withdraw their whole reward from what's left.
  const { escrowBalanceFrom } = require("../../src/utils/escrow");
  const txs = await model("Transaction").find({ campaignId: id, bucket: { $nin: ["referral", "fixed", "bonus"] } }).lean();
  assert.equal(Math.round(escrowBalanceFrom(txs, "views", campaign.creatorPool) * 100) / 100, slot.reward);
});

test("referral: sign-ups waiting for a reward hold the refund and raise an alert; a crash after the pool was claimed is finished once", async () => {
  const { runOpsAlerts } = require("../../src/services/opsAlerts");
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const body = (name) => ({
    name,
    category: "Tech",
    campaignObjective: "signups",
    targetViews: 100000,
    referral: { requestedBudget: 50000 },
    creatorAccess: "open_call",
    brief: { summary: "Sign up" },
  });
  const waiting = await pay(brand, body("Waiting reward"));
  const key = await harness.api("POST", "/api/referral/keys", { token: brand.token, body: { name: "Server" } });
  const signing = { keyId: key.body.key.keyId, secret: key.body.secret };
  const creator = await joinAndSubmit(waiting.id, { submit: false });
  assert.equal((await sendConversion(signing, creator.referralCode)).status, 200);
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  await complete(finance, waiting.id, 8);
  await run();
  assert.equal((await refundRows(waiting.id, "referral")).length, 0);
  let flagged = await model("Campaign").findById(waiting.id).lean();
  assert.match(flagged.autoRefund.error, /waiting for a reward/);
  await runOpsAlerts({ notify: async () => {} });
  assert.ok(await model("OpsAlert").exists({ kind: "auto_refund_failed", subjectId: waiting.id, active: true }));

  // Once the reward is set and the sign-up paid, the refund goes through and the alert clears.
  assert.equal((await patch(`/api/admin/referrals/campaigns/${waiting.id}/reward`, finance.token, { rewardPerConversion: REWARD })).status, 200);
  await run();
  assert.equal((await refundRows(waiting.id, "referral")).length, 1);
  flagged = await model("Campaign").findById(waiting.id).lean();
  assert.equal(flagged.autoRefund, undefined);
  await runOpsAlerts({ notify: async () => {} });
  assert.ok(!(await model("OpsAlert").exists({ kind: "auto_refund_failed", subjectId: waiting.id, active: true })));
  await assertBalanced(waiting.id);

  // A cancel that crashed after claiming the referral pool, before writing its refund.
  const crashed = await pay(brand, body("Crashed cancel"));
  await model("Campaign").updateOne({ _id: crashed.id }, { $set: { status: "cancelled", "referral.poolRemaining": 0 } });
  const short = await require("../../src/services/campaignReconciliation").reconcileCampaignById(crashed.id);
  assert.ok(!short.ok);
  await run();
  await run();
  const rows = await refundRows(crashed.id);
  const campaign = await model("Campaign").findById(crashed.id).lean();
  assert.deepEqual(rows.map((r) => [r.bucket, r.amount]).sort(), [["referral", Math.round((campaign.referral.pool * 100) / 70 * 100) / 100], ["views", campaign.creatorPool]].sort());
  await assertBalanced(crashed.id);
});

test("a crash before a refund is sent is retried by the next run; a refund Paystack refuses raises an alert until finance retries it", async () => {
  const { refundHooks } = require("../../src/utils/fixedPay");
  const { runOpsAlerts } = require("../../src/services/opsAlerts");
  const brand = await harness.registerBrand();
  const { id, reference } = await pay(brand, {
    name: "Crashy content",
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: RATE, deliverables: 1 },
    contentDestination: "creator_page",
    creatorAccess: "open_call",
    brief: { summary: "Style it" },
  });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  await complete(finance, id);

  refundHooks.beforeSend = () => {
    throw new Error("simulated crash");
  };
  try {
    await run();
  } finally {
    refundHooks.beforeSend = null;
  }
  let [row] = await refundRows(id);
  assert.equal(row.status, "refund_pending");
  assert.equal(harness.paystack.refunds(reference).length, 0);
  // Still reserved, so the next run doesn't write a second refund; too fresh to retry yet.
  await run();
  assert.equal((await refundRows(id)).length, 1);
  assert.equal(harness.paystack.refunds(reference).length, 0);

  // After 10 minutes the unsent row is retried from itself.
  await run(new Date(Date.now() + 11 * 60 * 1000));
  [row] = await refundRows(id);
  assert.equal(harness.paystack.refunds(reference).length, 1);
  assert.ok(row.refundParts[0].sentAt);
  await run(new Date(Date.now() + 12 * 60 * 1000));
  assert.equal(harness.paystack.refunds(reference).length, 1);
  await assertBalanced(id);

  // A hybrid bonus refund Paystack refuses is recorded, alerted, and retried by finance.
  const hybrid = await pay(brand, {
    name: "Refused bonus",
    category: "Beauty",
    campaignObjective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: 5000, deliverables: 1 },
    hybridBonus: { metric: "views", pool: 2000, capPerCreator: 2000 },
    contentDestination: "creator_page",
    creatorAccess: "open_call",
    brief: { summary: "Glow" },
  });
  await complete(finance, hybrid.id);
  const paystack = require("../../src/services/paystack");
  const original = paystack.createRefund;
  paystack.createRefund = async () => {
    throw new Error("Refund declined");
  };
  try {
    await run();
  } finally {
    paystack.createRefund = original;
  }
  const flagged = await model("Campaign").findById(hybrid.id).lean();
  assert.match(flagged.autoRefund.error, /failed: .*Refund declined/);
  await runOpsAlerts({ notify: async () => {} });
  assert.ok(await model("OpsAlert").exists({ kind: "auto_refund_failed", subjectId: hybrid.id, active: true }));
  await assertBalanced(hybrid.id);

  const failedRows = (await refundRows(hybrid.id)).filter((r) => r.status === "refund_failed");
  assert.equal(failedRows.length, 2, "base and bonus both refused");
  for (const failed of failedRows) {
    await model("Transaction").updateOne({ _id: failed._id }, { $set: { refundSendingUntil: null } });
    const retried = await harness.api("POST", `/api/admin/refunds/${failed._id}/retry`, { token: finance.token });
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
  }
  await run();
  assert.equal((await model("Campaign").findById(hybrid.id).lean()).autoRefund, undefined);
  await runOpsAlerts({ notify: async () => {} });
  assert.ok(!(await model("OpsAlert").exists({ kind: "auto_refund_failed", subjectId: hybrid.id, active: true })));
  await assertBalanced(hybrid.id);
});
