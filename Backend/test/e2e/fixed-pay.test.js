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
    posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }],
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
  const admin = await harness.registerAdmin();
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
  const admin = await harness.registerAdmin();
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
    const admin = await harness.registerAdmin();
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

    const result = await reconcile(id);
    assert.ok(result.ok, JSON.stringify(result.problems));
    assert.equal(result.paidIn, 58500);
    assert.equal(result.released, 30000);
    assert.equal(result.owed, 0);
    assert.equal(result.refunds, 19500);
    assert.equal(result.platformFee, 9000);
    assert.equal(result.left, 0);
    assert.equal(result.paidIn, result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.left);
    assert.equal(await Transaction.countDocuments({ campaignId: id, type: "release", bucket: "fixed", status: "released" }), 2);
  });
}
