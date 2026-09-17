// Ops alerts (M7): the job finds payouts, refunds, webhooks, deadlines and books that need a person,
// records each once, resolves it when the condition clears, and admins can list and resolve them.
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const model = (name) => require(`../../src/models/${name}`);
const service = () => require("../../src/services/opsAlerts");
const oid = () => new mongoose.Types.ObjectId();

async function liveCampaign(body) {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { brand, id: created.body.id };
}

const viewsCampaign = () => liveCampaign({ name: "Afrobeats", category: "Music", targetViews: 100000 });
const contentCampaign = () =>
  liveCampaign({
    name: "Lookbook",
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 15000, deliverables: 2 },
    contentDestination: "brand_page",
    creatorAccess: "open_call",
    brief: { summary: "Style it" },
  });

const alertsFor = (kind, subjectId) => model("OpsAlert").find({ kind, subjectId }).lean();
const found = (alerts, kind, subjectId) => alerts.filter((a) => a.kind === kind && String(a.subjectId) === String(subjectId));
const noEmail = async () => {};

// The condition shows up once, a second run adds nothing, and clearing it resolves the alert.
async function expectLifecycle({ kind, subjectId, now = new Date(), clear, clearedNow = now, full = false }) {
  const { collectAlerts, runOpsAlerts } = service();
  const collected = await collectAlerts({ now, full });
  assert.equal(found(collected, kind, subjectId).length, 1, `${kind} collected once: ${JSON.stringify(collected.map((a) => a.key))}`);
  assert.ok(found(collected, kind, subjectId)[0].message);

  await runOpsAlerts({ now, full, notify: noEmail });
  await runOpsAlerts({ now: new Date(now.getTime() + 15 * 60 * 1000), full, notify: noEmail });
  let stored = await alertsFor(kind, subjectId);
  assert.equal(stored.length, 1, "no duplicate");
  assert.equal(stored[0].active, true);
  assert.equal(stored[0].resolvedAt, null);
  assert.ok(stored[0].lastSeenAt > stored[0].firstSeenAt);

  await clear();
  assert.equal(found(await collectAlerts({ now: clearedNow, full }), kind, subjectId).length, 0, "condition cleared");
  await runOpsAlerts({ now: clearedNow, full, notify: noEmail });
  stored = await alertsFor(kind, subjectId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].active, false);
  assert.ok(stored[0].resolvedAt, "resolved when the condition cleared");
  return stored[0];
}

test("a failed payout transfer waiting in the queue raises an alert until it's paid or rejected", async () => {
  const { Withdrawal, Transaction } = { Withdrawal: model("Withdrawal"), Transaction: model("Transaction") };
  const campaignId = oid();
  const withdrawal = await Withdrawal.create({
    creatorId: oid(),
    campaignId,
    businessId: oid(),
    amount: 5000,
    kind: "campaign",
    viewsAmount: 5000,
    status: "pending",
    reference: `wd_test_${campaignId}_1`,
    payoutAttempts: 1,
  });
  await Transaction.create({
    campaignId,
    type: "release",
    bucket: "views",
    amount: 5000,
    status: "failed",
    reference: `wd_test_${campaignId}_1`,
    transferReference: `wd_test_${campaignId}_1`,
  });

  const alert = await expectLifecycle({
    kind: "payout_failed",
    subjectId: withdrawal._id,
    clear: () => Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { status: "rejected" } }),
  });
  assert.equal(alert.link, "/withdrawals");
});

test("a withdrawal in processing for more than 24 hours raises an alert", async () => {
  const Withdrawal = model("Withdrawal");
  const withdrawal = await Withdrawal.create({
    creatorId: oid(),
    campaignId: oid(),
    businessId: oid(),
    amount: 5000,
    status: "processing",
    reference: "wd_stuck_1",
    reviewedAt: new Date(Date.now() - 23 * HOUR),
  });
  const { collectAlerts } = service();
  assert.equal(found(await collectAlerts({ now: new Date() }), "withdrawal_stuck", withdrawal._id).length, 0, "not yet at 23 hours");

  await expectLifecycle({
    kind: "withdrawal_stuck",
    subjectId: withdrawal._id,
    now: new Date(Date.now() + 2 * HOUR),
    clear: () => Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { status: "released" } }),
  });
});

test("refunds pending, failed or never sent for more than an hour raise an alert, for every pot", async () => {
  const Transaction = model("Transaction");
  const { collectAlerts } = service();
  for (const [bucket, status] of [["views", "refund_pending"], ["referral", "refund_failed"], ["fixed", "refund_pending"]]) {
    const campaignId = oid();
    const refund = await Transaction.create({
      campaignId,
      type: "refund",
      bucket,
      amount: 1000,
      status,
      reference: `refund_${bucket}_${campaignId}`,
      refundParts: [{ chargeReference: `ch_${campaignId}`, amount: 1000, status: status === "refund_failed" ? "failed" : "pending" }],
      ...(bucket === "fixed" && { refundBreakdown: { deliverables: 1, creatorBudget: 769.23, platformFee: 230.77 } }),
    });
    assert.equal(found(await collectAlerts({ now: new Date() }), "refund_stuck", refund._id).length, 0, "not after minutes");
    const alert = await expectLifecycle({
      kind: "refund_stuck",
      subjectId: refund._id,
      now: new Date(Date.now() + 2 * HOUR),
      clear: () => Transaction.updateOne({ _id: refund._id }, { $set: { status: "refunded" } }),
    });
    assert.equal(String(alert.campaignId), String(campaignId));
    assert.equal(alert.link, `/campaigns?open=${campaignId}`);
  }
});

test("five or more rejected conversion webhooks for a brand key in an hour raise an alert", async () => {
  const WebhookDelivery = model("WebhookDelivery");
  const businessId = oid();
  const reject = () => WebhookDelivery.create({ businessId, keyId: "key_live_x", statusCode: 401, result: "rejected", error: "Invalid signature" });
  for (let i = 0; i < 4; i += 1) await reject();
  // Accepted deliveries and code checks don't count.
  await WebhookDelivery.create({ businessId, keyId: "key_live_x", statusCode: 200, result: "recorded" });
  await WebhookDelivery.create({ businessId, keyId: "key_live_x", source: "code_check", statusCode: 401, result: "rejected" });
  const { collectAlerts } = service();
  assert.equal(found(await collectAlerts({ now: new Date() }), "webhook_failing", businessId).length, 0, "four isn't enough");
  await reject();

  const alert = await expectLifecycle({
    kind: "webhook_failing",
    subjectId: businessId,
    now: new Date(Date.now() + 60 * 1000),
    // An hour later the failures are out of the window.
    clear: async () => {},
    clearedNow: new Date(Date.now() + 2 * HOUR),
  });
  assert.match(alert.message, /5 rejected/);
  assert.equal(alert.link, "/referrals");
});

test("content left past its 72-hour deadline raises an alert until the deadline job processes it", async () => {
  const Submission = model("Submission");
  const { id } = await contentCampaign();
  const creator = await harness.registerCreator();
  await Submission.create({
    campaignId: id,
    creatorId: creator.id,
    creatorHandle: creator.username,
    videoUrl: "https://drive.example.com/cut.mp4",
    status: "new",
    awaitingBrandSince: new Date(Date.now() - 72.5 * HOUR),
  });
  const { collectAlerts } = service();
  assert.equal(found(await collectAlerts({ now: new Date() }), "content_deadline_stuck", id).length, 0, "within the job's grace period");

  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
  const alert = await expectLifecycle({
    kind: "content_deadline_stuck",
    subjectId: id,
    now: new Date(Date.now() + 2 * HOUR),
    clear: () => autoApproveStaleSubmissions(new Date(Date.now() + 2 * HOUR)),
  });
  assert.equal(alert.link, `/campaigns?open=${id}`);
});

test("applications pending past 7 days raise an alert until the expiry job runs", async () => {
  const CampaignApplication = model("CampaignApplication");
  const { id } = await contentCampaign();
  await CampaignApplication.create({
    campaign: id,
    creator: oid(),
    status: "pending",
    applicantSnapshot: { username: "late" },
    appliedAt: new Date(Date.now() - 7 * DAY - 3 * HOUR),
  });
  const { processApplicationDeadlines } = require("../../src/services/applications");
  await expectLifecycle({
    kind: "application_expiry_stuck",
    subjectId: id,
    clear: () => processApplicationDeadlines(),
  });
});

test("a campaign whose books don't balance raises an alert; quiet campaigns are only checked in the daily full pass", async () => {
  const Campaign = model("Campaign");
  const Transaction = model("Transaction");
  const { id } = await viewsCampaign();
  const _id = new mongoose.Types.ObjectId(id);
  const stored = await Campaign.findById(id).lean();
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee + 1000 } });

  const alert = await expectLifecycle({
    kind: "reconciliation_mismatch",
    subjectId: id,
    clear: () => Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee } }),
  });
  assert.match(alert.message, /fee/);

  // No money has moved for 3 days: the 15-minute pass skips it, the full pass finds it.
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee + 1000 } });
  await Transaction.collection.updateMany({ campaignId: _id }, { $set: { updatedAt: new Date(Date.now() - 3 * DAY), date: new Date(Date.now() - 3 * DAY) } });
  const { collectAlerts } = service();
  assert.equal(found(await collectAlerts({ now: new Date() }), "reconciliation_mismatch", id).length, 0);
  assert.equal(found(await collectAlerts({ now: new Date(), full: true }), "reconciliation_mismatch", id).length, 1);
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee } });
});

test("new alerts are emailed once; an admin-resolved alert stays resolved while the condition lasts", async () => {
  const Withdrawal = model("Withdrawal");
  const OpsAlert = model("OpsAlert");
  const { runOpsAlerts } = service();
  const withdrawal = await Withdrawal.create({
    creatorId: oid(),
    campaignId: oid(),
    businessId: oid(),
    amount: 7000,
    status: "processing",
    reference: "wd_email_1",
    reviewedAt: new Date(Date.now() - 30 * HOUR),
  });
  const now = new Date();
  const emailed = [];
  const notify = async (alerts) => emailed.push(...alerts);
  await (await runOpsAlerts({ now, notify })).emailing;
  assert.equal(emailed.filter((a) => String(a.subjectId) === String(withdrawal._id)).length, 1);
  await (await runOpsAlerts({ now: new Date(now.getTime() + 15 * 60 * 1000), notify })).emailing;
  assert.equal(emailed.filter((a) => String(a.subjectId) === String(withdrawal._id)).length, 1, "not emailed again");
  const [alert] = await alertsFor("withdrawal_stuck", withdrawal._id);
  assert.ok(alert.emailedAt);

  // A slow or failing email never stops the run.
  const hanging = () => new Promise(() => {});
  await Withdrawal.create({ creatorId: oid(), campaignId: oid(), businessId: oid(), amount: 1, status: "processing", reference: "wd_email_2", reviewedAt: new Date(Date.now() - 30 * HOUR) });
  const summary = await runOpsAlerts({ now: new Date(now.getTime() + 30 * 60 * 1000), notify: hanging });
  assert.ok(summary.created >= 1);

  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const resolved = await harness.api("PATCH", `/api/admin/alerts/${alert._id}/resolve`, { token: admin.token });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  await (await runOpsAlerts({ now: new Date(now.getTime() + 45 * 60 * 1000), notify })).emailing;
  const after = await OpsAlert.find({ kind: "withdrawal_stuck", subjectId: withdrawal._id }).lean();
  assert.equal(after.length, 1, "not reopened while the condition lasts unchanged");
  assert.ok(after[0].resolvedAt);
  assert.equal(String(after[0].resolvedBy), admin.id);
});

test("an alert is only marked emailed once the email went out; a failed email is retried on the next run", async () => {
  const Withdrawal = model("Withdrawal");
  const { runOpsAlerts } = service();
  const withdrawal = await Withdrawal.create({
    creatorId: oid(),
    campaignId: oid(),
    businessId: oid(),
    amount: 9100,
    status: "processing",
    reference: "wd_email_retry",
    reviewedAt: new Date(Date.now() - 30 * HOUR),
  });
  const now = new Date();
  const failing = async () => {
    throw new Error("Brevo is down");
  };
  const error = console.error;
  console.error = () => {};
  try {
    await (await runOpsAlerts({ now, notify: failing })).emailing;
  } finally {
    console.error = error;
  }
  let [alert] = await alertsFor("withdrawal_stuck", withdrawal._id);
  assert.equal(alert.emailedAt, null, "not marked emailed after a failure");

  const emailed = [];
  await (await runOpsAlerts({ now: new Date(now.getTime() + 15 * 60 * 1000), notify: async (alerts) => emailed.push(...alerts) })).emailing;
  assert.equal(emailed.filter((a) => String(a.subjectId) === String(withdrawal._id)).length, 1, "retried");
  [alert] = await alertsFor("withdrawal_stuck", withdrawal._id);
  assert.ok(alert.emailedAt);
  await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { status: "released" } });
});

test("an admin-resolved alert reopens and is emailed again when the problem changes or 24 hours later", async () => {
  const Withdrawal = model("Withdrawal");
  const Transaction = model("Transaction");
  const { runOpsAlerts } = service();
  const admin = await harness.registerAdmin({ role: "admin" });
  const emailed = [];
  const notify = async (alerts) => emailed.push(...alerts.map((a) => String(a.subjectId)));
  const run = async (at) => (await runOpsAlerts({ now: at, notify })).emailing;
  const resolve = async (alertId) => {
    const res = await harness.api("PATCH", `/api/admin/alerts/${alertId}/resolve`, { token: admin.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return new Date(res.body.resolvedAt);
  };

  // Stuck withdrawal: unchanged stays resolved; a changed amount reopens it.
  const stuck = await Withdrawal.create({ creatorId: oid(), campaignId: oid(), businessId: oid(), amount: 4000, status: "processing", reference: "wd_reopen_1", reviewedAt: new Date(Date.now() - 30 * HOUR) });
  const now = new Date();
  await run(now);
  let [alert] = await alertsFor("withdrawal_stuck", stuck._id);
  const resolvedAt = await resolve(alert._id);
  await run(new Date(resolvedAt.getTime() + HOUR));
  [alert] = await alertsFor("withdrawal_stuck", stuck._id);
  assert.ok(alert.resolvedAt, "unchanged: stays resolved");
  await Withdrawal.updateOne({ _id: stuck._id }, { $set: { amount: 4500 } });
  await run(new Date(resolvedAt.getTime() + 2 * HOUR));
  [alert] = await alertsFor("withdrawal_stuck", stuck._id);
  assert.equal(alert.resolvedAt, null, "the amount changed: reopened");
  assert.equal(alert.resolvedBy, null);
  assert.ok(alert.reopenedAt);
  assert.ok(alert.emailedAt, "emailed again");
  assert.equal(emailed.filter((id) => id === String(stuck._id)).length, 2);

  // Resolved again and unchanged: reopens 24 hours after it was resolved.
  const resolvedAgain = await resolve(alert._id);
  await run(new Date(resolvedAgain.getTime() + 23 * HOUR));
  [alert] = await alertsFor("withdrawal_stuck", stuck._id);
  assert.ok(alert.resolvedAt, "not before 24 hours");
  await run(new Date(resolvedAgain.getTime() + 24 * HOUR + 60 * 1000));
  [alert] = await alertsFor("withdrawal_stuck", stuck._id);
  assert.equal(alert.resolvedAt, null, "24 hours later: reopened");
  assert.equal(emailed.filter((id) => id === String(stuck._id)).length, 3);
  assert.equal((await alertsFor("withdrawal_stuck", stuck._id)).length, 1, "the same alert, not a new one");
  await Withdrawal.updateOne({ _id: stuck._id }, { $set: { status: "released" } });

  // Failed payout: another failed transfer on the same withdrawal reopens it at once.
  const campaignId = oid();
  const failed = await Withdrawal.create({ creatorId: oid(), campaignId, businessId: oid(), amount: 6000, kind: "campaign", viewsAmount: 6000, status: "pending", reference: `wd_reopen_${campaignId}_1`, payoutAttempts: 1 });
  await Transaction.create({ campaignId, type: "release", bucket: "views", amount: 6000, status: "failed", reference: `wd_reopen_${campaignId}_1`, transferReference: `wd_reopen_${campaignId}_1` });
  await run(now);
  [alert] = await alertsFor("payout_failed", failed._id);
  const payoutResolvedAt = await resolve(alert._id);
  await Transaction.create({ campaignId, type: "release", bucket: "views", amount: 6000, status: "failed", reference: `wd_reopen_${campaignId}_2`, transferReference: `wd_reopen_${campaignId}_2` });
  await Withdrawal.updateOne({ _id: failed._id }, { $set: { reference: `wd_reopen_${campaignId}_2`, payoutAttempts: 2 } });
  await run(new Date(payoutResolvedAt.getTime() + 15 * 60 * 1000));
  [alert] = await alertsFor("payout_failed", failed._id);
  assert.equal(alert.resolvedAt, null, "a new failed transfer reopens it");
  assert.match(alert.message, /attempt 2/);
  await Withdrawal.updateOne({ _id: failed._id }, { $set: { status: "rejected" } });
});

test("money moving on a flagged campaign doesn't reopen or re-email a resolved mismatch; 24 hours later it does", async () => {
  const Campaign = model("Campaign");
  const OpsAlert = model("OpsAlert");
  const { runOpsAlerts } = service();
  const { id } = await viewsCampaign();
  const _id = new mongoose.Types.ObjectId(id);
  const stored = await Campaign.findById(id).lean();
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee + 1000 } });

  const emailed = [];
  const notify = async (alerts) => emailed.push(...alerts.map((a) => String(a.subjectId)));
  const start = new Date();
  await (await runOpsAlerts({ now: start, notify })).emailing;
  const [alert] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id, active: true }).lean();
  assert.ok(alert);
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const resolved = await harness.api("PATCH", `/api/admin/alerts/${alert._id}/resolve`, { token: admin.token });
  const resolvedAt = new Date(resolved.body.resolvedAt);

  for (let run = 1; run <= 4; run += 1) {
    // Brand tops up: paid in, fee and pool all move, the ₦1,000 fee discrepancy stays.
    await model("Transaction").create({ campaignId: id, type: "topup", bucket: "views", amount: 43000, status: "escrow_deposit", reference: `ref_move_${id}_${run}` });
    await Campaign.collection.updateOne({ _id }, { $inc: { budget: 43000, platformFee: 12900, creatorPool: 30100 } });
    await (await runOpsAlerts({ now: new Date(resolvedAt.getTime() + run * HOUR), notify })).emailing;
    const [current] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id, active: true }).lean();
    assert.ok(current, `run ${run}: still flagged`);
    assert.ok(current.resolvedAt, `run ${run}: still resolved`);
  }
  assert.equal(emailed.filter((s) => s === id).length, 1, "emailed only when first found");

  await (await runOpsAlerts({ now: new Date(resolvedAt.getTime() + 24 * HOUR + 60 * 1000), notify })).emailing;
  const [reopened] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id, active: true }).lean();
  assert.equal(reopened.resolvedAt, null, "24 hours later it reopens");
  assert.equal(emailed.filter((s) => s === id).length, 2);

  const fresh = await Campaign.findById(id).lean();
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: fresh.platformFee - 1000 } });
  await runOpsAlerts({ now: new Date(resolvedAt.getTime() + 25 * HOUR), notify: noEmail });
});

test("stuck views posts on completed or cancelled campaigns don't alert, and an open alert resolves", async () => {
  const Submission = model("Submission");
  const Campaign = model("Campaign");
  const { collectAlerts, runOpsAlerts } = service();
  const { id } = await viewsCampaign();
  const creator = await harness.registerCreator();
  await Submission.create({
    campaignId: id,
    creatorId: creator.id,
    creatorHandle: creator.username,
    videoUrl: "https://tiktok.example.com/v/9",
    status: "awaiting_post",
    reviewedAt: new Date(Date.now() - 9 * DAY),
  });
  await Campaign.updateOne({ _id: id }, { $set: { status: "paused" } });
  assert.equal(found(await collectAlerts({ now: new Date() }), "views_submission_stuck", id).length, 1, "paused still alerts");
  await runOpsAlerts({ now: new Date(), notify: noEmail });
  await Campaign.updateOne({ _id: id }, { $set: { status: "completed" } });
  assert.equal(found(await collectAlerts({ now: new Date() }), "views_submission_stuck", id).length, 0);
  await runOpsAlerts({ now: new Date(), notify: noEmail });
  const [alert] = await alertsFor("views_submission_stuck", id);
  assert.equal(alert.active, false, "resolved");
});

test("a failed payout older than the 30-day lookback stays open until the withdrawal is dealt with", async () => {
  const Withdrawal = model("Withdrawal");
  const Transaction = model("Transaction");
  const { runOpsAlerts } = service();
  const campaignId = oid();
  const reference = `wd_old_${campaignId}_1`;
  const withdrawal = await Withdrawal.create({ creatorId: oid(), campaignId, businessId: oid(), amount: 3000, kind: "campaign", viewsAmount: 3000, status: "pending", reference, payoutAttempts: 1 });
  const row = await Transaction.create({ campaignId, type: "release", bucket: "views", amount: 3000, status: "failed", reference, transferReference: reference });
  await Transaction.collection.updateOne({ _id: row._id }, { $set: { updatedAt: new Date(Date.now() - 40 * DAY) } });

  // Found while it was recent, 35 days ago.
  await runOpsAlerts({ now: new Date(Date.now() - 35 * DAY), notify: noEmail });
  let [alert] = await alertsFor("payout_failed", withdrawal._id);
  assert.equal(alert.active, true);

  await runOpsAlerts({ now: new Date(), notify: noEmail });
  await runOpsAlerts({ now: new Date(), full: true, notify: noEmail });
  [alert] = await alertsFor("payout_failed", withdrawal._id);
  assert.equal(alert.active, true, "still open past the lookback");
  assert.equal(alert.resolvedAt, null);

  await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { status: "rejected" } });
  await runOpsAlerts({ now: new Date(), notify: noEmail });
  [alert] = await alertsFor("payout_failed", withdrawal._id);
  assert.equal(alert.active, false, "resolved once re-checked and gone");
});

test("a flagged campaign past the lookback stays flagged through the daily full pass and a restart", async () => {
  const Campaign = model("Campaign");
  const Transaction = model("Transaction");
  const OpsAlert = model("OpsAlert");
  const { id } = await viewsCampaign();
  const _id = new mongoose.Types.ObjectId(id);
  const stored = await Campaign.findById(id).lean();
  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee + 500 } });
  await service().runOpsAlerts({ now: new Date(), notify: noEmail });
  assert.equal((await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id, active: true }).lean()).length, 1);

  // Finished 60 days ago with no money moving since, and moved out of the reconciled statuses.
  const old = new Date(Date.now() - 60 * DAY);
  await Campaign.collection.updateOne({ _id }, { $set: { status: "under_review", updatedAt: old } });
  await Transaction.collection.updateMany({ campaignId: _id }, { $set: { updatedAt: old, date: old } });

  const JobState = model("JobState");
  await JobState.deleteMany({});
  const first = await service().runScheduledOpsAlerts({ now: new Date(), notify: noEmail });
  assert.equal(first.full, true, "no full pass on record: this one is full");
  let [alert] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id }).lean();
  assert.equal(alert.active, true, "still flagged after the full pass");
  assert.equal(alert.resolvedAt, null);

  // A restart: the job module loads again, and the full pass it ran is remembered in the database.
  delete require.cache[require.resolve("../../src/services/opsAlerts")];
  const second = await service().runScheduledOpsAlerts({ now: new Date(Date.now() + HOUR), notify: noEmail });
  assert.equal(second.full, false, "no second full pass within 24 hours");
  [alert] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id }).lean();
  assert.equal(alert.active, true, "still flagged after the restart");
  const third = await service().runScheduledOpsAlerts({ now: new Date(Date.now() + 25 * HOUR), notify: noEmail });
  assert.equal(third.full, true, "full again a day later");

  await Campaign.collection.updateOne({ _id }, { $set: { platformFee: stored.platformFee } });
  await service().runOpsAlerts({ now: new Date(), notify: noEmail });
  [alert] = await OpsAlert.find({ kind: "reconciliation_mismatch", subjectId: _id }).lean();
  assert.equal(alert.active, false, "resolves once re-checked and balanced");
});

test("views content approved but never posted for more than 7 days raises an alert", async () => {
  const Submission = model("Submission");
  const { id } = await viewsCampaign();
  const creator = await harness.registerCreator();
  const submission = await Submission.create({
    campaignId: id,
    creatorId: creator.id,
    creatorHandle: creator.username,
    videoUrl: "https://tiktok.example.com/v/1",
    status: "awaiting_post",
    reviewedAt: new Date(Date.now() - 6 * DAY),
  });
  // Content campaigns use awaiting_post too; those aren't views posts.
  const content = await contentCampaign();
  await Submission.create({
    campaignId: content.id,
    creatorId: creator.id,
    creatorHandle: creator.username,
    videoUrl: "https://drive.example.com/c.mp4",
    status: "awaiting_post",
    reviewedAt: new Date(Date.now() - 20 * DAY),
  });
  const { collectAlerts } = service();
  assert.equal(found(await collectAlerts({ now: new Date() }), "views_submission_stuck", id).length, 0, "not at 6 days");
  assert.equal(found(await collectAlerts({ now: new Date(Date.now() + 30 * DAY) }), "views_submission_stuck", content.id).length, 0, "content campaigns are left out");

  const alert = await expectLifecycle({
    kind: "views_submission_stuck",
    subjectId: id,
    now: new Date(Date.now() + 2 * DAY),
    clear: () => Submission.updateOne({ _id: submission._id }, { $set: { status: "posted" } }),
  });
  assert.match(alert.message, /1 submission/);
  assert.equal(alert.link, `/campaigns?open=${id}`);
});

test("three or more Paystack webhooks that fail to process within an hour raise an alert", async () => {
  const PaystackWebhookFailure = model("PaystackWebhookFailure");
  const send = () =>
    harness.api("POST", "/api/webhooks/paystack", {
      body: { event: "charge.success", data: { reference: `ref_broken_${Date.now()}`, amount: 100, currency: "NGN", metadata: { campaignId: "not-a-campaign-id" } } },
    });
  const error = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 2; i += 1) assert.notEqual((await send()).status, 200);
  } finally {
    console.error = error;
  }
  const failures = await PaystackWebhookFailure.find({}).lean();
  assert.equal(failures.length, 2, "each processing failure is recorded");
  assert.equal(failures[0].event, "charge.success");
  assert.ok(failures[0].error);

  const { collectAlerts } = service();
  assert.equal((await collectAlerts({ now: new Date() })).filter((a) => a.kind === "paystack_webhook_failing").length, 0, "two isn't enough");
  console.error = () => {};
  try {
    await send();
  } finally {
    console.error = error;
  }
  const [alertNow] = (await collectAlerts({ now: new Date() })).filter((a) => a.kind === "paystack_webhook_failing");
  assert.ok(alertNow, "three in an hour");
  assert.match(alertNow.message, /3 Paystack webhooks/);

  await expectLifecycle({
    kind: "paystack_webhook_failing",
    subjectId: alertNow.subjectId,
    clear: async () => {},
    clearedNow: new Date(Date.now() + 2 * HOUR),
  });
});

test("alert copy counts hours correctly", async () => {
  const Transaction = model("Transaction");
  const { collectAlerts } = service();
  const campaignId = oid();
  const refund = await Transaction.create({
    campaignId,
    type: "refund",
    bucket: "views",
    amount: 2000,
    status: "refund_pending",
    reference: `refund_copy_${campaignId}`,
    refundParts: [{ chargeReference: `ch_${campaignId}`, amount: 2000, status: "pending", sentAt: new Date() }],
  });
  const at = (hours) => new Date(Date.now() + hours * HOUR);
  const [oneHour] = found(await collectAlerts({ now: at(1.5) }), "refund_stuck", refund._id);
  assert.match(oneHour.message, /after 1 hour\./);
  const [threeHours] = found(await collectAlerts({ now: at(3.2) }), "refund_stuck", refund._id);
  assert.match(threeHours.message, /after 3 hours\./);
  await Transaction.updateOne({ _id: refund._id }, { $set: { status: "refunded" } });
});

test("the open count is every open alert, not the length of the capped list", async () => {
  const OpsAlert = model("OpsAlert");
  const now = new Date();
  await OpsAlert.insertMany(
    Array.from({ length: 205 }, () => {
      const subjectId = oid();
      return { kind: "refund_stuck", key: `refund_stuck:${subjectId}`, subjectType: "transaction", subjectId, message: "Many", firstSeenAt: now, lastSeenAt: now };
    })
  );
  const support = await harness.registerAdmin({ role: "support" });
  const list = await harness.api("GET", "/api/admin/alerts", { token: support.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.alerts.length, 200);
  assert.equal(list.body.open, await OpsAlert.countDocuments({ resolvedAt: null }));
  assert.ok(list.body.open > 200);
  await OpsAlert.deleteMany({ message: "Many" });
});

test("admins list open alerts; finance, admin and super admin resolve them, and it's recorded", async () => {
  const OpsAlert = model("OpsAlert");
  const AdminActivity = model("AdminActivity");
  const now = new Date();
  const alert = await OpsAlert.create({
    kind: "refund_stuck",
    key: `refund_stuck:${oid()}`,
    subjectType: "transaction",
    subjectId: oid(),
    message: "A views refund of ₦1,000 has been pending for 3 hours",
    link: "/campaigns",
    firstSeenAt: now,
    lastSeenAt: now,
  });

  const creator = await harness.registerCreator();
  assert.equal((await harness.api("GET", "/api/admin/alerts", { token: creator.token })).status, 403);
  const support = await harness.registerAdmin({ role: "support" });
  const list = await harness.api("GET", "/api/admin/alerts", { token: support.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const row = list.body.alerts.find((a) => a.id === String(alert._id));
  assert.ok(row, "open alert listed");
  assert.equal(row.kind, "refund_stuck");
  assert.equal(row.link, "/campaigns");
  assert.ok(row.title);
  assert.ok(list.body.alerts.every((a) => a.resolvedAt === null));

  assert.equal((await harness.api("PATCH", `/api/admin/alerts/${alert._id}/resolve`, { token: support.token })).status, 403);
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  const resolved = await harness.api("PATCH", `/api/admin/alerts/${alert._id}/resolve`, { token: superAdmin.token });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.ok(resolved.body.resolvedAt);
  assert.equal((await harness.api("PATCH", `/api/admin/alerts/${alert._id}/resolve`, { token: superAdmin.token })).status, 409);
  assert.equal((await harness.api("PATCH", `/api/admin/alerts/${oid()}/resolve`, { token: superAdmin.token })).status, 404);

  const activity = await AdminActivity.find({ targetId: alert._id }).lean();
  assert.equal(activity.length, 1);
  assert.equal(activity[0].action, "ops_alert.resolved");

  const open = await harness.api("GET", "/api/admin/alerts", { token: support.token });
  assert.ok(!open.body.alerts.some((a) => a.id === String(alert._id)));
  const resolvedList = await harness.api("GET", "/api/admin/alerts?status=resolved", { token: support.token });
  assert.ok(resolvedList.body.alerts.some((a) => a.id === String(alert._id)));
});
