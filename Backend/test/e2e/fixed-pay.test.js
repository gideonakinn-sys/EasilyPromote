// Fixed pay payouts (ticket 09): content campaigns credit the placement's reward when D1 says pay
// is due, hold it until delivery is confirmed plus 7 days, pay it in the weekly per-campaign
// withdrawal, refund unused budget on admin's say-so, and reconcile to the kobo.
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RATE = 15000;

const brief = { summary: "Style three looks from the summer drop", hashtags: ["#SummerDrop"] };
const models = () => ({
  Campaign: require("../../src/models/Campaign"),
  Submission: require("../../src/models/Submission"),
  Transaction: require("../../src/models/Transaction"),
  Withdrawal: require("../../src/models/Withdrawal"),
  AdminActivity: require("../../src/models/AdminActivity"),
});

async function liveContentCampaign({ destination = "creator_page", deliverables = 3, rate = RATE } = {}) {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Summer lookbook",
      category: "Fashion",
      campaignObjective: "content",
      contentPay: { ratePerDeliverable: rate, deliverables },
      contentDestination: destination,
      creatorAccess: "open_call",
      brief,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { brand, id, reference: checkout.body.reference };
}

async function joinAndSubmit(campaignId) {
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${campaignId}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const bank = await harness.api("POST", "/api/creators/bank-account", {
    token: creator.token,
    body: { accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" },
  });
  assert.equal(bank.status, 200, JSON.stringify(bank.body));
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId, videoUrl: "https://drive.example.com/cut-1.mp4", caption: "Summer looks #SummerDrop" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { ...creator, submissionId: submitted.body.id };
}

const patch = (path, token, body) => harness.api("PATCH", path, { token, body });

async function approve(brand, creator) {
  const res = await patch(`/api/submissions/${creator.submissionId}/approve`, brand.token);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function deliver(creator) {
  const res = await patch(`/api/submissions/${creator.submissionId}/deliver`, creator.token, {
    url: "https://drive.example.com/final.mp4",
    acceptUsageRights: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function post(creator) {
  const res = await patch(`/api/submissions/${creator.submissionId}/mark-posted`, creator.token, {
    posts: [{ platform: "tiktok", postUrl: `https://www.tiktok.com/@c/video/${Date.now()}${Math.floor(Math.random() * 1e6)}` }],
    caption: "#SummerDrop",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function credits(campaignId) {
  return models().Transaction.find({ campaignId, type: "fixed_credit" }).lean();
}

// The hold is the only thing moved in time: completion is set back, as if it happened days ago.
async function completedDaysAgo(submissionId, days) {
  await models().Submission.updateOne({ _id: submissionId }, { $set: { completedAt: new Date(Date.now() - days * DAY) } });
}

async function walletCampaign(creator, campaignId) {
  const wallet = await harness.api("GET", "/api/creators/wallet", { token: creator.token });
  assert.equal(wallet.status, 200, JSON.stringify(wallet.body));
  return { wallet: wallet.body, entry: wallet.body.withdrawCampaigns.find((c) => String(c.id) === String(campaignId)) };
}

const withdraw = (creator, campaignId) => harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId } });

async function reconcile(campaignId) {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  return reconcileCampaignById(campaignId);
}

test("fixed pay is credited once, when D1 says: on approval for brand page, once the post is verified for creator page", async () => {
  const { Campaign } = models();

  const brandPage = await liveContentCampaign({ destination: "brand_page" });
  const deliverer = await joinAndSubmit(brandPage.id);
  assert.equal((await credits(brandPage.id)).length, 0);
  await approve(brandPage.brand, deliverer);
  const [credit] = await credits(brandPage.id);
  assert.ok(credit, "credited on approval");
  assert.equal(credit.amount, RATE);
  assert.equal(credit.bucket, "fixed");
  assert.equal(credit.status, "credited");
  assert.equal(String(credit.submissionId), deliverer.submissionId);
  assert.equal(String(credit.creatorId), deliverer.id);

  const creatorPage = await liveContentCampaign({ destination: "creator_page" });
  const poster = await joinAndSubmit(creatorPage.id);
  await approve(creatorPage.brand, poster);
  await post(poster);
  assert.equal((await credits(creatorPage.id)).length, 0, "nothing is credited before the post is verified");
  const confirms = await Promise.all([1, 2, 3].map(() => patch(`/api/submissions/${poster.submissionId}/confirm-post`, creatorPage.brand.token)));
  assert.equal(confirms.filter((r) => r.status === 200).length, 1);
  assert.equal((await credits(creatorPage.id)).length, 1);

  // Firing again, at once or after a retry, changes nothing.
  const { creditFixedPay } = require("../../src/utils/fixedPay");
  const Submission = require("../../src/models/Submission");
  const submission = await Submission.findById(poster.submissionId);
  const campaign = await Campaign.findById(creatorPage.id);
  const again = await Promise.all([1, 2, 3].map(() => creditFixedPay({ submission, campaign, trigger: "retry" })));
  assert.ok(again.every((r) => !r.credited));
  assert.equal((await credits(creatorPage.id)).length, 1);
  const stored = await Campaign.findById(creatorPage.id).lean();
  assert.equal(stored.fixedPay.credited, RATE);
  assert.equal(stored.fixedPay.creditedSubmissions.length, 1);
  assert.ok((await reconcile(creatorPage.id)).ok);
});

test("crediting can never pay more deliverables than were bought, even all at once", async () => {
  const { Campaign, Submission } = models();
  const { creditFixedPay } = require("../../src/utils/fixedPay");
  const { id } = await liveContentCampaign({ deliverables: 2 });
  const campaign = await Campaign.findById(id);
  // More submissions than places, as a bug elsewhere might create.
  const submissions = await Promise.all(
    [1, 2, 3, 4, 5].map(async () => {
      const creator = await harness.registerCreator();
      return Submission.create({ campaignId: id, creatorId: creator.id, creatorHandle: creator.username, videoUrl: "https://x.test/v.mp4", status: "completed" });
    })
  );
  const results = await Promise.all(submissions.map((submission) => creditFixedPay({ submission, campaign, trigger: "test" })));
  assert.equal(results.filter((r) => r.credited).length, 2);
  assert.equal(results.filter((r) => r.reason === "budget_exhausted").length, 3);
  const stored = await Campaign.findById(id).lean();
  assert.equal(stored.fixedPay.credited, 2 * RATE);
  assert.ok(stored.fixedPay.credited <= stored.creatorPool);
  assert.equal((await credits(id)).length, 2);
  assert.ok((await reconcile(id)).ok, JSON.stringify((await reconcile(id)).problems));
});

test("fixed pay waits for delivery to be confirmed, then the 7-day hold, then goes out in the weekly withdrawal", async () => {
  const { Transaction, Withdrawal } = models();
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const { brand, id } = await liveContentCampaign({ destination: "brand_page" });
  const creator = await joinAndSubmit(id);
  await approve(brand, creator);

  let { entry, wallet } = await walletCampaign(creator, id);
  assert.equal(entry.fixedAwaitingDelivery, RATE);
  assert.equal(entry.fixedAvailable, 0);
  assert.equal(entry.earnings.fixed, RATE);
  assert.equal(entry.earnings.performance, 0);
  assert.equal(entry.earnings.referral, 0);
  assert.deepEqual(entry.onHold.map((h) => h.reason), ["Waiting for the brand to confirm delivery"]);
  assert.ok(entry.payoutDate);
  assert.equal(wallet.fixed.awaitingDelivery, RATE);
  let refused = await withdraw(creator, id);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /waiting for the brand to confirm delivery/);

  await deliver(creator);
  const receipt = await patch(`/api/submissions/${creator.submissionId}/confirm-receipt`, brand.token);
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  ({ entry } = await walletCampaign(creator, id));
  assert.equal(entry.fixedAwaitingDelivery, 0);
  assert.equal(entry.fixedOnHold, RATE);
  assert.equal(entry.onHold[0].reason, "7-day hold");
  assert.ok(new Date(entry.onHold[0].until) > new Date(Date.now() + 6 * DAY));
  refused = await withdraw(creator, id);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /on hold until/);

  await completedDaysAgo(creator.submissionId, 6);
  assert.equal((await withdraw(creator, id)).status, 400, "still held on day 6");
  await completedDaysAgo(creator.submissionId, 8);
  ({ entry } = await walletCampaign(creator, id));
  assert.equal(entry.fixedAvailable, RATE);
  assert.equal(entry.state, "available");

  const requested = await withdraw(creator, id);
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.fixedAmount, RATE);
  assert.equal(requested.body.amount, RATE);
  assert.equal((await withdraw(creator, id)).status, 409, "once a week per campaign");

  const paid = await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.withdrawal.status, "released");
  const releases = await Transaction.find({ campaignId: id, type: "release" }).lean();
  assert.equal(releases.length, 1);
  assert.equal(releases[0].bucket, "fixed");
  assert.equal(releases[0].amount, RATE);
  assert.equal(releases[0].status, "released");
  assert.equal(releases[0].transferReference, (await Withdrawal.findById(requested.body.id)).reference);
  assert.ok(await Transaction.exists({ campaignId: id, type: "transfer_fee", transferReference: releases[0].transferReference }));

  ({ entry, wallet } = await walletCampaign(creator, id));
  assert.equal(wallet.fixed.withdrawn, RATE);
  assert.equal(wallet.fixed.availableToWithdraw, 0);
  const result = await reconcile(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.released, RATE);
});

test("fixed pay below the ₦2,000 campaign minimum carries over", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", rate: 1500, deliverables: 2 });
  const creator = await joinAndSubmit(id);
  await approve(brand, creator);
  await deliver(creator);
  await patch(`/api/submissions/${creator.submissionId}/confirm-receipt`, brand.token);
  await completedDaysAgo(creator.submissionId, 8);
  const refused = await withdraw(creator, id);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "BELOW_MINIMUM");
  const { entry } = await walletCampaign(creator, id);
  assert.equal(entry.state, "below_minimum");
});

test("a withdrawal pays views, referral and fixed parts from their own pots", () => {
  const { withdrawalParts } = require("../../src/services/withdrawalPayouts");
  assert.deepEqual(withdrawalParts({ kind: "campaign", viewsAmount: 100, referralAmount: 200.5, fixedAmount: 15000 }), [
    { bucket: "views", amount: 100 },
    { bucket: "referral", amount: 200.5 },
    { bucket: "fixed", amount: 15000 },
  ]);
  assert.deepEqual(withdrawalParts({ kind: "campaign", viewsAmount: 100, referralAmount: 0 }), [{ bucket: "views", amount: 100 }]);
  assert.deepEqual(withdrawalParts({ kind: "referral", amount: 50 }), [{ bucket: "referral", amount: 50 }]);
});

test("admin refunds unused budget once, never money still owed, and sees the amount first", async () => {
  const { AdminActivity, Campaign, Transaction } = models();
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const { brand, id, reference } = await liveContentCampaign({ destination: "brand_page", deliverables: 4 });
  const done = await joinAndSubmit(id);
  await approve(brand, done);
  await deliver(done);
  await patch(`/api/submissions/${done.submissionId}/confirm-receipt`, brand.token);
  // Credited on approval, delivery not confirmed yet: owed, so never refunded.
  const owed = await joinAndSubmit(id);
  await approve(brand, owed);
  // Still waiting for review: it can still earn its pay.
  await joinAndSubmit(id);

  const live = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token });
  assert.equal(live.status, 200, JSON.stringify(live.body));
  assert.equal(live.body.refundAllowed, false);
  const early = await harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount: 19500 } });
  assert.equal(early.status, 400);
  assert.equal(early.body.code, "CAMPAIGN_NOT_FINISHED");

  const completed = await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "completed" } });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(await Transaction.countDocuments({ campaignId: id, type: "refund" }), 0, "completing never refunds by itself");

  const summary = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.deliverables, 4);
  assert.equal(summary.body.completed, 1);
  assert.equal(summary.body.owed, 1);
  assert.equal(summary.body.inProgress, 1);
  assert.equal(summary.body.unused, 1);
  // One unused deliverable: ₦15,000 creator budget + 30% fee on it.
  assert.deepEqual(summary.body.refundable, { deliverables: 1, creatorBudget: 15000, platformFee: 4500, amount: 19500 });
  assert.ok(summary.body.reconciliation.ok, JSON.stringify(summary.body.reconciliation.problems));

  const stale = await harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount: 39000 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "REFUND_CHANGED");

  const clicks = await Promise.all(
    [1, 2, 3].map(() => harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount: 19500 } }))
  );
  assert.equal(clicks.filter((r) => r.status === 200).length, 1, JSON.stringify(clicks.map((r) => r.body)));
  assert.ok(clicks.every((r) => [200, 400, 409].includes(r.status)));
  const refunds = await Transaction.find({ campaignId: id, type: "refund" }).lean();
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount, 19500);
  assert.equal(refunds[0].bucket, "fixed");
  assert.deepEqual(refunds[0].refundBreakdown, { deliverables: 1, creatorBudget: 15000, platformFee: 4500 });
  assert.equal(refunds[0].refundParts.length, 1);
  assert.equal(refunds[0].refundParts[0].chargeReference, reference);
  assert.equal(refunds[0].refundParts[0].amount, 19500);
  const activity = await AdminActivity.find({ targetId: id, action: "campaign.unused_budget_refunded" }).lean();
  assert.equal(activity.length, 1);
  assert.equal(activity[0].metadata.amount, 19500);

  const after = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token });
  assert.equal(after.body.refunded, 1);
  assert.equal(after.body.refundable.amount, 0);
  assert.ok(after.body.reconciliation.ok, JSON.stringify(after.body.reconciliation.problems));

  // The owed deliverable still completes and is paid from what's left.
  await deliver(owed);
  const receipt = await patch(`/api/submissions/${owed.submissionId}/confirm-receipt`, brand.token);
  assert.equal(receipt.status, 200);
  const stored = await Campaign.findById(id).lean();
  assert.equal(stored.fixedPay.creditedSubmissions.length, 2);
  assert.ok((await reconcile(id)).ok);
});

// Content campaign paid → 2 of 3 deliverables completed → credits → hold passes → weekly
// withdrawal → admin refunds the unused deliverable → reconciliation passes to the kobo. Run for
// both D1 moments; one deliverable is confirmed by the brand, the other automatically after 72h.
for (const destination of ["brand_page", "creator_page"]) {
  test(`end to end (${destination}): paid, delivered, withdrawn, refunded and reconciled to the kobo`, async () => {
    const { Transaction, Withdrawal } = models();
    const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
    const { payoutWeekStart } = require("../../src/utils/payoutSchedule");
    const admin = await harness.registerAdmin({ role: "finance_admin" });
    const { brand, id } = await liveContentCampaign({ destination, deliverables: 3 });
    const paidIn = await reconcile(id);
    assert.ok(paidIn.ok, JSON.stringify(paidIn.problems));
    assert.equal(paidIn.paidIn, 58500);
    assert.equal(paidIn.left, 45000);
    assert.equal(paidIn.platformFee, 13500);

    const first = await joinAndSubmit(id);
    const second = await joinAndSubmit(id);
    for (const creator of [first, second]) await approve(brand, creator);
    if (destination === "brand_page") {
      for (const creator of [first, second]) await deliver(creator);
      assert.equal((await patch(`/api/submissions/${first.submissionId}/confirm-receipt`, brand.token)).status, 200);
    } else {
      for (const creator of [first, second]) await post(creator);
      assert.equal((await patch(`/api/submissions/${first.submissionId}/confirm-post`, brand.token)).status, 200);
    }
    await autoApproveStaleSubmissions(new Date(Date.now() + 73 * HOUR));
    assert.equal((await credits(id)).length, 2);

    for (const creator of [first, second]) await completedDaysAgo(creator.submissionId, 8);
    const requests = [];
    for (const creator of [first, second]) {
      const res = await withdraw(creator, id);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      requests.push(res.body.id);
    }
    // Requested last week, so they're due in this Friday's payout run.
    await Withdrawal.updateMany({ _id: { $in: requests } }, { $set: { requestedAt: new Date(payoutWeekStart(new Date()).getTime() - DAY) } });
    const run = await harness.api("GET", "/api/admin/payout-run", { token: admin.token });
    const group = run.body.groups.find((g) => String(g.campaignId) === String(id));
    assert.equal(group.lines.length, 2);
    const paid = await harness.api("POST", "/api/admin/payout-run/approve", { token: admin.token, body: { withdrawalIds: requests } });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.paid, 2);

    assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "completed" } })).status, 200);
    const summary = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token });
    assert.deepEqual(summary.body.refundable, { deliverables: 1, creatorBudget: 15000, platformFee: 4500, amount: 19500 });
    const refunded = await harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount: 19500 } });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    let result = await reconcile(id);
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.equal(result.pendingRefunds, 19500, "sent, waiting for Paystack");
    assert.equal(result.refunds, 0);

    // Paystack confirms it.
    const [refundRow] = await Transaction.find({ campaignId: id, type: "refund" }).lean();
    const webhook = await harness.api("POST", "/api/webhooks/paystack", {
      body: { event: "refund.processed", data: { transaction_reference: refundRow.refundParts[0].chargeReference } },
    });
    assert.equal(webhook.status, 200);

    result = await reconcile(id);
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.equal(result.paidIn, 58500);
    assert.equal(result.released, 30000);
    assert.equal(result.owed, 0);
    assert.equal(result.refunds, 19500);
    assert.equal(result.pendingRefunds, 0);
    assert.equal(result.platformFee, 9000);
    assert.equal(result.left, 0);
    assert.equal(result.paidIn, result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.pendingRefunds + result.left);
    assert.equal(await Transaction.countDocuments({ campaignId: id, type: "release", bucket: "fixed", status: "released" }), 2);
  });
}

// ── Review fixes ────────────────────────────────────────────────────────────

const finance = () => harness.registerAdmin({ role: "finance_admin" });
const paystackModule = () => require("../../src/services/paystack");

// A completed campaign with one delivered deliverable and one unused, ready to refund ₦19,500.
async function finishedCampaignWithOneUnused(admin) {
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 2 });
  const done = await joinAndSubmit(id);
  await approve(brand, done);
  await deliver(done);
  await patch(`/api/submissions/${done.submissionId}/confirm-receipt`, brand.token);
  const completed = await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "completed" } });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  return { brand, id, done };
}

const budgetOf = async (admin, id) => (await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token })).body;
const refundUnused = (admin, id, expectedAmount = 19500) =>
  harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount } });
const retryRefund = (admin, id, refundId) => harness.api("POST", `/api/admin/campaigns/${id}/refunds/${refundId}/retry`, { token: admin.token });

test("only finance admins and super admins can refund or void pay", async () => {
  const owner = await finance();
  const { id, done } = await finishedCampaignWithOneUnused(owner);
  for (const role of ["support", "admin"]) {
    const other = await harness.registerAdmin({ role });
    assert.equal((await refundUnused(other, id)).status, 403, role);
    assert.equal((await harness.api("POST", `/api/admin/submissions/${done.submissionId}/void-undelivered`, { token: other.token })).status, 403, role);
    assert.equal((await retryRefund(other, id, "000000000000000000000000")).status, 403, role);
  }
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  assert.equal((await refundUnused(superAdmin, id)).status, 200);
});

test("a refund Paystack rejects is recorded as failed, holds nothing back, and a retry sends it once", async () => {
  const { Transaction } = models();
  const admin = await finance();
  const { id } = await finishedCampaignWithOneUnused(admin);
  const paystack = paystackModule();
  const original = paystack.createRefund;
  let calls = 0;
  paystack.createRefund = async () => {
    calls += 1;
    throw Object.assign(new Error("Transaction has been fully reversed"), { status: 400 });
  };
  try {
    const failed = await refundUnused(admin, id);
    assert.equal(failed.status, 502, JSON.stringify(failed.body));
    assert.equal(failed.body.refund.state, "failed");
    assert.match(failed.body.refund.error, /fully reversed/);
  } finally {
    paystack.createRefund = original;
  }
  let budget = await budgetOf(admin, id);
  assert.equal(budget.refunded, 0, "a failed refund counts for nothing");
  assert.equal(budget.refundable.amount, 19500);
  assert.equal(budget.refunds.length, 1);
  assert.equal(budget.refunds[0].state, "failed");
  assert.equal(budget.refunds[0].retryable, true);
  assert.ok(budget.reconciliation.ok, JSON.stringify(budget.reconciliation.problems));

  // A new refund isn't started beside a failed one: the failed one is retried.
  const beside = await refundUnused(admin, id);
  assert.equal(beside.status, 409);
  assert.equal(beside.body.code, "REFUND_NEEDS_RETRY");

  paystack.createRefund = async (args) => {
    calls += 1;
    return original(args);
  };
  try {
    const retried = await retryRefund(admin, id, budget.refunds[0].id);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.refund.state, "sent");
    assert.equal((await retryRefund(admin, id, budget.refunds[0].id)).status, 409);
  } finally {
    paystack.createRefund = original;
  }
  assert.equal(calls, 2);
  assert.equal(await Transaction.countDocuments({ campaignId: id, type: "refund" }), 1, "the retry reused the row");
  budget = await budgetOf(admin, id);
  assert.equal(budget.refunded, 1);
  assert.equal(budget.refundable.amount, 0);
  assert.equal(budget.refunds[0].state, "sent");
  assert.ok(budget.reconciliation.ok, JSON.stringify(budget.reconciliation.problems));
  assert.equal(budget.reconciliation.pendingRefunds, 19500);
});

test("a refund interrupted after its row is written is retried from that row and never sent twice", async () => {
  const { Transaction } = models();
  const fixedPay = require("../../src/utils/fixedPay");
  const admin = await finance();
  const { id } = await finishedCampaignWithOneUnused(admin);
  const paystack = paystackModule();
  const original = paystack.createRefund;
  let calls = 0;

  fixedPay.refundHooks.beforeSend = () => {
    throw new Error("simulated crash");
  };
  try {
    const crashed = await refundUnused(admin, id);
    assert.equal(crashed.status, 500);
  } finally {
    fixedPay.refundHooks.beforeSend = null;
  }
  let budget = await budgetOf(admin, id);
  assert.equal(budget.refunds.length, 1);
  assert.equal(budget.refunds[0].state, "not_sent");
  assert.equal(budget.refunded, 1, "still reserved, so nothing can refund it again");
  assert.equal(budget.refundable.amount, 0);
  assert.equal((await refundUnused(admin, id)).status, 409);

  paystack.createRefund = async (args) => {
    calls += 1;
    return original(args);
  };
  try {
    const retries = await Promise.all([1, 2, 3].map(() => retryRefund(admin, id, budget.refunds[0].id)));
    assert.equal(retries.filter((r) => r.status === 200).length, 1, JSON.stringify(retries.map((r) => r.body)));
  } finally {
    paystack.createRefund = original;
  }
  assert.equal(calls, 1);
  assert.equal(await Transaction.countDocuments({ campaignId: id, type: "refund" }), 1);
  budget = await budgetOf(admin, id);
  assert.equal(budget.refunds[0].state, "sent");
  assert.ok(budget.reconciliation.ok, JSON.stringify(budget.reconciliation.problems));
});

test("a refund Paystack accepted just before a crash is adopted on retry, never sent twice", async () => {
  const { Transaction } = models();
  const fixedPay = require("../../src/utils/fixedPay");
  const admin = await finance();
  const { id } = await finishedCampaignWithOneUnused(admin);

  fixedPay.refundHooks.afterPaystackAccepted = () => {
    throw new Error("simulated crash after Paystack accepted");
  };
  try {
    assert.equal((await refundUnused(admin, id)).status, 500);
  } finally {
    fixedPay.refundHooks.afterPaystackAccepted = null;
  }
  const [row] = await Transaction.find({ campaignId: id, type: "refund" }).lean();
  const charge = row.refundParts[0].chargeReference;
  assert.equal(harness.paystack.refunds(charge).length, 1, "Paystack has the refund");
  let budget = await budgetOf(admin, id);
  assert.equal(budget.refunds[0].state, "not_sent", "our row never recorded it");
  // The crashed request's send lock has run out (time fixture).
  await Transaction.updateOne({ _id: row._id }, { $set: { refundSendingUntil: new Date(Date.now() - 1000) } });

  const retried = await retryRefund(admin, id, row._id);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.refund.state, "sent");
  assert.equal(harness.paystack.refunds(charge).length, 1, "adopted, not sent again");
  const adopted = await Transaction.findById(row._id).lean();
  assert.equal(adopted.refundParts[0].paystackRefundId, String(harness.paystack.refunds(charge)[0].id));
  budget = await budgetOf(admin, id);
  assert.ok(budget.reconciliation.ok, JSON.stringify(budget.reconciliation.problems));
});

test("when Paystack's refund list can't be checked, nothing is sent and the refund stays retryable", async () => {
  const { Transaction } = models();
  const admin = await finance();
  const { id } = await finishedCampaignWithOneUnused(admin);
  const paystack = paystackModule();
  const originalList = paystack.listRefunds;
  paystack.listRefunds = async () => {
    throw new Error("Paystack timed out");
  };
  let charge;
  try {
    const refused = await refundUnused(admin, id);
    assert.equal(refused.status, 502, JSON.stringify(refused.body));
    assert.equal(refused.body.refund.state, "not_sent");
    assert.equal(refused.body.refund.retryable, true);
    assert.match(refused.body.refund.error, /Couldn't check Paystack, try again/);
    const [row] = await Transaction.find({ campaignId: id, type: "refund" }).lean();
    charge = row.refundParts[0].chargeReference;
    assert.equal(harness.paystack.refunds(charge).length, 0, "nothing sent");
    assert.equal(row.status, "refund_pending");
    assert.equal((await retryRefund(admin, id, row._id)).status, 502, "still can't check");
    assert.equal(harness.paystack.refunds(charge).length, 0);
  } finally {
    paystack.listRefunds = originalList;
  }
  const [row] = await Transaction.find({ campaignId: id, type: "refund" }).lean();
  const retried = await retryRefund(admin, id, row._id);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.refund.state, "sent");
  assert.equal(harness.paystack.refunds(charge).length, 1);
});

test("rejected content isn't refundable while it can still be appealed; after 7 days without an appeal it is", async () => {
  const { Submission } = models();
  const admin = await finance();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 2 });
  const done = await joinAndSubmit(id);
  await approve(brand, done);
  await deliver(done);
  await patch(`/api/submissions/${done.submissionId}/confirm-receipt`, brand.token);
  const rejected = await joinAndSubmit(id);
  const reject = await patch(`/api/submissions/${rejected.submissionId}/reject`, brand.token, { reason: "Off brief" });
  assert.equal(reject.status, 200, JSON.stringify(reject.body));
  const stored = await Submission.findById(rejected.submissionId).lean();
  assert.ok(stored.appealableUntil > new Date(Date.now() + 6 * DAY));
  await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "completed" } });

  let budget = await budgetOf(admin, id);
  assert.equal(budget.inProgress, 1);
  assert.equal(budget.refundable.amount, 0);

  await Submission.updateOne({ _id: rejected.submissionId }, { $set: { appealableUntil: new Date(Date.now() - 1000) } });
  budget = await budgetOf(admin, id);
  assert.equal(budget.inProgress, 0);
  assert.equal(budget.refundable.amount, 19500);
  const late = await patch(`/api/submissions/${rejected.submissionId}/appeal`, rejected.token, { reason: "It matched" });
  assert.equal(late.status, 409, JSON.stringify(late.body));
  assert.equal(late.body.code, "APPEAL_WINDOW_CLOSED");
});

test("an appeal can't be upheld when there's no budget left to pay for it", async () => {
  const { Campaign, Submission } = models();
  const Slot = require("../../src/models/Slot");
  const { creditFixedPay } = require("../../src/utils/fixedPay");
  const admin = await finance();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 1 });
  const creator = await joinAndSubmit(id);
  await patch(`/api/submissions/${creator.submissionId}/reject`, brand.token, { reason: "Off brief" });
  const appealed = await patch(`/api/submissions/${creator.submissionId}/appeal`, creator.token, { reason: "On brief" });
  assert.equal(appealed.status, 200, JSON.stringify(appealed.body));

  // The only deliverable's budget is used by another submission (test fixture), its place still free.
  const other = await harness.registerCreator();
  const filler = await Submission.create({ campaignId: id, creatorId: other.id, creatorHandle: other.username, videoUrl: "https://x.test/v.mp4", status: "completed", completedAt: new Date() });
  assert.ok((await creditFixedPay({ submission: filler, campaign: await Campaign.findById(id), trigger: "test" })).credited);

  const upheld = await harness.api("PATCH", `/api/admin/submissions/${creator.submissionId}/appeal`, { token: admin.token, body: { decision: "approve" } });
  assert.equal(upheld.status, 409, JSON.stringify(upheld.body));
  assert.equal(upheld.body.code, "NO_BUDGET_FOR_APPEAL");
  assert.match(upheld.body.error, /budget/i);
  const after = await Submission.findById(creator.submissionId).lean();
  assert.equal(after.status, "appealed");
  assert.equal((await Slot.findOne({ campaignId: id }).lean()).status, "available");
});

test("receipts and live posts still auto-confirm after the campaign is cancelled or completed", async () => {
  const { Submission } = models();
  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
  const admin = await finance();

  const brandPage = await liveContentCampaign({ destination: "brand_page" });
  const deliverer = await joinAndSubmit(brandPage.id);
  await approve(brandPage.brand, deliverer);
  await deliver(deliverer);
  const reviewing = await joinAndSubmit(brandPage.id);
  await harness.api("PATCH", `/api/admin/campaigns/${brandPage.id}/status`, { token: admin.token, body: { status: "cancelled", note: "Brand request" } });

  const creatorPage = await liveContentCampaign({ destination: "creator_page" });
  const poster = await joinAndSubmit(creatorPage.id);
  await approve(creatorPage.brand, poster);
  await post(poster);
  await harness.api("PATCH", `/api/admin/campaigns/${creatorPage.id}/status`, { token: admin.token, body: { status: "completed" } });

  await autoApproveStaleSubmissions(new Date(Date.now() + 73 * HOUR));
  assert.equal((await Submission.findById(deliverer.submissionId).lean()).status, "completed");
  assert.equal((await Submission.findById(poster.submissionId).lean()).status, "completed");
  assert.equal((await credits(creatorPage.id)).length, 1);
  // Review of new content isn't done for a cancelled campaign.
  assert.equal((await Submission.findById(reviewing.submissionId).lean()).status, "new");
});

test("admin voids pay for approved content never delivered: reversed, back in the pool, once", async () => {
  const { AdminActivity, Campaign, Submission, Transaction } = models();
  const Notification = require("../../src/models/Notification");
  const admin = await finance();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 2 });
  const creator = await joinAndSubmit(id);
  await approve(brand, creator);
  const voidPay = () => harness.api("POST", `/api/admin/submissions/${creator.submissionId}/void-undelivered`, { token: admin.token });

  const early = await voidPay();
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.equal(early.body.code, "NOT_VOIDABLE_YET");

  await Submission.updateOne({ _id: creator.submissionId }, { $set: { reviewedAt: new Date(Date.now() - 15 * DAY), fixedPayDueAt: new Date(Date.now() - 15 * DAY) } });
  const voids = await Promise.all([voidPay(), voidPay(), voidPay()]);
  assert.ok(voids.every((r) => r.status === 200), JSON.stringify(voids.map((r) => r.body)));
  assert.equal(voids.filter((r) => r.body.voided).length, 1);

  const credit = await Transaction.findOne({ campaignId: id, type: "fixed_credit" }).lean();
  assert.equal(credit.status, "voided");
  const reversals = await Transaction.find({ campaignId: id, type: "fixed_void" }).lean();
  assert.equal(reversals.length, 1);
  assert.equal(reversals[0].amount, RATE);
  const campaign = await Campaign.findById(id).lean();
  assert.equal(campaign.fixedPay.credited, 0);
  assert.equal(campaign.fixedPay.creditedSubmissions.length, 0);
  assert.equal((await Submission.findById(creator.submissionId).lean()).status, "not_delivered");
  assert.equal(await Notification.countDocuments({ creatorId: creator.id, type: "content_not_delivered" }), 1);
  assert.equal(await AdminActivity.countDocuments({ targetId: creator.submissionId, action: "submission.fixed_pay_voided" }), 1);
  assert.equal((await walletCampaign(creator, id)).wallet.fixed.earned, 0);

  await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "cancelled", note: "Brand request" } });
  let budget = await budgetOf(admin, id);
  assert.equal(budget.refundable.deliverables, 1, "not while the creator can still appeal the void (D23)");
  await Submission.updateOne({ _id: creator.submissionId }, { $set: { voidAppealableUntil: new Date(Date.now() - 1000) } });
  budget = await budgetOf(admin, id);
  assert.equal(budget.refundable.deliverables, 2, "the voided deliverable is refundable once its appeal window has passed");
  assert.ok(budget.reconciliation.ok, JSON.stringify(budget.reconciliation.problems));

  // On a cancelled campaign there's no 14-day wait.
  const cancelled = await liveContentCampaign({ destination: "brand_page" });
  const other = await joinAndSubmit(cancelled.id);
  await approve(cancelled.brand, other);
  await harness.api("PATCH", `/api/admin/campaigns/${cancelled.id}/status`, { token: admin.token, body: { status: "cancelled", note: "Brand request" } });
  const now = await harness.api("POST", `/api/admin/submissions/${other.submissionId}/void-undelivered`, { token: admin.token });
  assert.equal(now.status, 200, JSON.stringify(now.body));
});

test("voided undelivered pay frees the creator's placement: reopened on a live campaign, closed otherwise", async () => {
  const { Campaign, Submission } = models();
  const Slot = require("../../src/models/Slot");
  const { ACTIVE_PLACEMENT_STATUSES } = require("../../src/utils/placementStatuses");
  const admin = await finance();
  const activeFor = (creator) => Slot.countDocuments({ creatorId: creator.id, status: { $in: ACTIVE_PLACEMENT_STATUSES } });
  const overdue = (submissionId) =>
    Submission.updateOne({ _id: submissionId }, { $set: { reviewedAt: new Date(Date.now() - 15 * DAY), fixedPayDueAt: new Date(Date.now() - 15 * DAY) } });
  const voidPay = (submissionId) => harness.api("POST", `/api/admin/submissions/${submissionId}/void-undelivered`, { token: admin.token });

  // Live, one deliverable: the place goes back to the campaign and another creator can take it.
  const live = await liveContentCampaign({ destination: "brand_page", deliverables: 1 });
  const first = await joinAndSubmit(live.id);
  await approve(live.brand, first);
  assert.equal(await activeFor(first), 1);
  const late = await harness.registerCreator();
  assert.equal((await harness.api("POST", `/api/campaigns/${live.id}/join`, { token: late.token })).status, 409, "full while the first creator holds it");
  await overdue(first.submissionId);
  const voided = await voidPay(first.submissionId);
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(await activeFor(first), 0, "no longer counts toward the creator's 3 active placements");
  const rejoined = await harness.api("POST", `/api/campaigns/${live.id}/join`, { token: late.token });
  assert.equal(rejoined.status, 200, JSON.stringify(rejoined.body));
  assert.equal((await voidPay(first.submissionId)).status, 200, "voiding again is harmless");
  const again = await harness.api("POST", `/api/campaigns/${live.id}/join`, { token: first.token });
  assert.equal(again.body.code, "CONTENT_NOT_DELIVERED", "the creator who didn't deliver can't take a place again");
  assert.equal(await activeFor(late), 1, "the new creator's place is untouched");
  assert.equal((await harness.api("GET", "/api/creators/dashboard", { token: first.token })).status, 200);

  // Paused: the place closes instead of reopening.
  const paused = await liveContentCampaign({ destination: "brand_page", deliverables: 1 });
  const second = await joinAndSubmit(paused.id);
  await approve(paused.brand, second);
  await Campaign.updateOne({ _id: paused.id }, { $set: { status: "paused" } });
  await overdue(second.submissionId);
  assert.equal((await voidPay(second.submissionId)).status, 200);
  assert.equal(await activeFor(second), 0);
  const closed = await Slot.findOne({ campaignId: paused.id }).lean();
  assert.equal(closed.status, "closed");
  assert.equal(closed.creatorId, null, "a closed place never keeps a creator");
  const voidedSubmission = await Submission.findById(second.submissionId).lean();
  assert.equal(String(voidedSubmission.notDeliveredBy), admin.id, "who voided is on the submission");
  assert.equal((await harness.api("GET", "/api/creators/dashboard", { token: second.token })).status, 200);
  const brandView = await harness.api("GET", `/api/campaigns/${paused.id}`, { token: paused.brand.token });
  assert.equal(brandView.body.creatorCount, 0, "closed places aren't creators");

  // Resumed: the place voided while paused comes back for another creator.
  const resumed = await harness.api("PATCH", `/api/campaigns/${paused.id}/resume`, { token: paused.brand.token });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal((await Slot.findById(closed._id).lean()).status, "available");
  const next = await harness.registerCreator();
  assert.equal((await harness.api("POST", `/api/campaigns/${paused.id}/join`, { token: next.token })).status, 200);
  assert.equal((await harness.api("GET", `/api/campaigns/${paused.id}`, { token: paused.brand.token })).body.creatorCount, 1);

  // Paused, voided, then completed instead: the place stays closed and the deliverable is refundable.
  const ended = await liveContentCampaign({ destination: "brand_page", deliverables: 2 });
  const third = await joinAndSubmit(ended.id);
  await approve(ended.brand, third);
  await Campaign.updateOne({ _id: ended.id }, { $set: { status: "paused" } });
  await overdue(third.submissionId);
  assert.equal((await voidPay(third.submissionId)).status, 200);
  assert.equal((await harness.api("POST", `/api/admin/campaigns/${ended.id}/complete`, { token: admin.token })).status, 200);
  assert.equal(await Slot.countDocuments({ campaignId: ended.id, status: "closed", creatorId: null }), 2);
  assert.equal((await harness.api("GET", `/api/campaigns/${ended.id}`, { token: ended.brand.token })).body.creatorCount, 0);
  assert.equal((await budgetOf(admin, ended.id)).refundable.deliverables, 1, "the voided one waits for its appeal window (D23)");
  await Submission.updateOne({ _id: third.submissionId }, { $set: { voidAppealableUntil: new Date(Date.now() - 1000) } });
  assert.equal((await budgetOf(admin, ended.id)).refundable.deliverables, 2);
});

test("a payout re-checks fixed pay and releases only credits delivered and past their hold", async () => {
  const { Campaign, Submission, Transaction, Withdrawal } = models();
  const { creditFixedPay } = require("../../src/utils/fixedPay");
  const admin = await finance();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 3 });
  const creator = await joinAndSubmit(id);
  await approve(brand, creator);
  await deliver(creator);
  await patch(`/api/submissions/${creator.submissionId}/confirm-receipt`, brand.token);
  await completedDaysAgo(creator.submissionId, 9);
  // A second credit for the same creator (test fixture), still in its hold.
  const second = await Submission.create({ campaignId: id, creatorId: creator.id, creatorHandle: creator.username, videoUrl: "https://x.test/2.mp4", status: "completed", completedAt: new Date(Date.now() - 2 * DAY) });
  assert.ok((await creditFixedPay({ submission: second, campaign: await Campaign.findById(id), trigger: "test" })).credited);

  // The wallet shows each unlock date with its own amount.
  let { entry } = await walletCampaign(creator, id);
  const fixedHolds = entry.onHold.filter((h) => h.pot === "fixed");
  assert.equal(fixedHolds.length, 1);
  assert.equal(fixedHolds[0].amount, RATE);
  assert.ok(new Date(fixedHolds[0].until) > new Date(Date.now() + 4 * DAY));

  await Submission.updateOne({ _id: second._id }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  const requested = await withdraw(creator, id);
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.fixedAmount, 2 * RATE);

  // Before payout the second credit stops being eligible (test seam).
  await Submission.updateOne({ _id: second._id }, { $set: { completedAt: new Date() } });
  const paid = await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const releases = await Transaction.find({ campaignId: id, type: "release", status: { $ne: "failed" } }).lean();
  assert.equal(releases.reduce((sum, r) => sum + r.amount, 0), RATE);
  const withdrawal = await Withdrawal.findById(requested.body.id).lean();
  assert.equal(withdrawal.amount, RATE);
  assert.equal(withdrawal.fixedAmount, RATE);
  assert.equal(withdrawal.status, "released");

  ({ entry } = await walletCampaign(creator, id));
  assert.equal(entry.fixedOnHold, RATE);
});

test("brand payouts show paid out, owed and refundable separately; audit views list credits and fixed amounts", async () => {
  const admin = await finance();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 3 });
  const paidCreator = await joinAndSubmit(id);
  await approve(brand, paidCreator);
  await deliver(paidCreator);
  await patch(`/api/submissions/${paidCreator.submissionId}/confirm-receipt`, brand.token);
  await completedDaysAgo(paidCreator.submissionId, 8);
  const requested = await withdraw(paidCreator, id);
  const owedCreator = await joinAndSubmit(id);
  await approve(brand, owedCreator);

  const withdrawals = await harness.api("GET", "/api/admin/withdrawals?status=pending", { token: admin.token });
  const line = withdrawals.body.withdrawals.find((w) => String(w.id) === String(requested.body.id));
  assert.equal(line.fixedAmount, RATE);
  await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
  await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: admin.token, body: { status: "completed" } });

  const payouts = await harness.api("GET", `/api/payouts/campaign/${id}`, { token: brand.token });
  assert.equal(payouts.status, 200, JSON.stringify(payouts.body));
  assert.deepEqual(payouts.body.content, {
    deliverables: 3,
    paidOut: RATE,
    owed: RATE,
    refundable: 19500,
    refunded: 0,
    refundPending: 0,
  });
  assert.equal(payouts.body.refundable, 19500, "never the owed pay or the fee on delivered work");
  assert.ok(payouts.body.ledger.some((row) => row.type === "fixed_credit" && row.status === "credited"));

  const ledger = await harness.api("GET", "/api/admin/payouts?limit=100", { token: admin.token });
  assert.ok(ledger.body.transactions.some((t) => t.type === "fixed_credit"));
});
