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
    assert.equal(alert.link, `/verifications/campaign/${campaignId}`);
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
  assert.equal(alert.link, `/verifications/campaign/${id}`);
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
  await runOpsAlerts({ now, notify });
  assert.equal(emailed.filter((a) => String(a.subjectId) === String(withdrawal._id)).length, 1);
  await runOpsAlerts({ now: new Date(now.getTime() + 15 * 60 * 1000), notify });
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
  await runOpsAlerts({ now: new Date(now.getTime() + 45 * 60 * 1000), notify });
  const after = await OpsAlert.find({ kind: "withdrawal_stuck", subjectId: withdrawal._id }).lean();
  assert.equal(after.length, 1, "not reopened while the condition lasts");
  assert.ok(after[0].resolvedAt);
  assert.equal(String(after[0].resolvedBy), admin.id);
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
