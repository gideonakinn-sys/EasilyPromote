// Referral tracking on the new join paths (ticket 08): a sign-up campaign hands out a referral code
// when a creator joins through Open Call or is approved through Application Required, conversions
// for either code are credited as before, and the money trail still reconciles (ticket 09).
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
const REWARD = 2500;

async function connectBrandApp(brand) {
  const BusinessProfile = require("../../src/models/BusinessProfile");
  const now = new Date();
  await BusinessProfile.updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

// A paid, live sign-up campaign and a signing key for the brand's server.
async function liveSignupCampaign(creatorAccess, objective = "signups") {
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "App launch",
      category: "Tech",
      campaignObjective: objective,
      targetViews: 100000,
      referral: { requestedBudget: 50000 },
      creatorAccess,
      brief: { summary: "Get your followers to sign up" },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  const key = await harness.api("POST", "/api/referral/keys", { token: brand.token, body: { name: "Server" } });
  assert.equal(key.status, 201, JSON.stringify(key.body));
  return { brand, id, key: { keyId: key.body.key.keyId, secret: key.body.secret } };
}

let eventCounter = 0;
function sendConversion(key, code, event = "signup") {
  const { buildSignedRequest } = require("../../src/services/conversions");
  eventCounter += 1;
  const request = buildSignedRequest({
    keyId: key.keyId,
    secret: key.secret,
    payload: { event_id: `evt_${Date.now()}_${eventCounter}`, code, event, timestamp: new Date().toISOString() },
  });
  return harness.rawPost("/api/webhooks/conversions", request);
}

async function setReward(campaignId) {
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const res = await harness.api("PATCH", `/api/admin/referrals/campaigns/${campaignId}/reward`, {
    token: admin.token,
    body: { rewardPerConversion: REWARD },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return admin;
}

async function dashboard(creator) {
  const res = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  assert.equal(res.status, 200);
  return res.body;
}

async function expectRewardCredited({ campaignId, creator, key, code, event = "signup" }) {
  const Campaign = require("../../src/models/Campaign");
  const before = await Campaign.findById(campaignId).lean();
  const sent = await sendConversion(key, code, event);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body, { status: "recorded", counted: true });

  const afterward = await Campaign.findById(campaignId).lean();
  assert.equal(afterward.referral.poolRemaining, before.referral.poolRemaining - REWARD, "reward reserved from the pool");
  assert.equal(afterward.referral.earned, before.referral.earned + REWARD);

  const { wallet } = await dashboard(creator);
  const earnings = wallet.referral.byCampaign.find((c) => String(c.id) === String(campaignId));
  assert.equal(earnings.earned, REWARD);
  assert.equal(earnings.pending, REWARD, "held for 7 days");
  const entry = wallet.withdrawCampaigns.find((c) => String(c.id) === String(campaignId));
  assert.equal(entry.referralOnHold, REWARD);
  assert.equal(entry.earnings.referral, REWARD);
  assert.equal(entry.onHold[0].pot, "referral");
  assert.ok(new Date(entry.onHold[0].until) > new Date(Date.now() + 6 * DAY));
}

test("Open Call: joining a sign-up campaign creates the code, and a signed conversion is credited as today", async () => {
  const { id, key } = await liveSignupCampaign("open_call");
  const creator = await harness.registerCreator();

  // Until admin sets the reward, the card says it's being set.
  const card = (await dashboard(creator)).marketplace.campaigns.find((c) => String(c.id) === id);
  assert.deepEqual(card.pay, { amount: null, unit: "sign-up" });

  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.ok(joined.body.referralCode, "code created on join");
  const mine = (await dashboard(creator)).campaigns.campaigns.find((c) => String(c.id) === id);
  assert.equal(mine.pay.amount, null, "the joined campaign still says the reward is being set");

  await setReward(id);
  await expectRewardCredited({ campaignId: id, creator, key, code: joined.body.referralCode });
});

test("Leads and Sales (ticket 11): a signed lead or purchase is credited at admin's reward; other events don't count", async () => {
  for (const [objective, event, unit] of [["leads", "lead", "lead"], ["sales", "purchase", "purchase"]]) {
    const { id, key } = await liveSignupCampaign("open_call", objective);
    const creator = await harness.registerCreator();
    const card = (await dashboard(creator)).marketplace.campaigns.find((c) => String(c.id) === id);
    assert.deepEqual(card.pay, { amount: null, unit }, objective);

    const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.ok(joined.body.referralCode, "code created on join");
    await setReward(id);
    const priced = (await dashboard(creator)).campaigns.campaigns.find((c) => String(c.id) === id);
    assert.deepEqual(priced.pay, { amount: REWARD, unit });

    // A sign-up isn't what this campaign pays for: recorded, not counted, nothing reserved.
    const other = await sendConversion(key, joined.body.referralCode, "signup");
    assert.deepEqual(other.body, { status: "recorded", counted: false });
    await expectRewardCredited({ campaignId: id, creator, key, code: joined.body.referralCode, event });
  }
});

test("Application Required: approving an applicant creates the code, and a signed conversion is credited as today", async () => {
  const { brand, id, key } = await liveSignupCampaign("application_required");
  const creator = await harness.registerCreator();
  const applied = await harness.api("POST", `/api/campaigns/${id}/apply`, { token: creator.token, body: {} });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const approved = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const code = approved.body.placement.referralCode;
  assert.ok(code, "code created on approval");

  // Conversions before a reward exists are recorded and paid once it's set, as today.
  const early = await sendConversion(key, code);
  assert.deepEqual(early.body, { status: "recorded", counted: true });
  await setReward(id);
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const paidLater = await ConversionEvent.findOne({ campaignId: id }).lean();
  assert.equal(paidLater.rewardAmount, REWARD);

  const Campaign = require("../../src/models/Campaign");
  const campaign = await Campaign.findById(id).lean();
  assert.equal(campaign.referral.poolRemaining, 35000 - REWARD);
  const { wallet } = await dashboard(creator);
  assert.equal(wallet.referral.byCampaign.find((c) => String(c.id) === id).pending, REWARD);
});

test("sign-ups recorded after the budget ran out are paid, oldest first, when the brand tops up; never twice", async () => {
  const Campaign = require("../../src/models/Campaign");
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const Notification = require("../../src/models/Notification");
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const { id, key } = await liveSignupCampaign("open_call");
  await setReward(id);
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));

  // ₦35,000 pool at ₦2,500 each: 14 paid, then 3 recorded unpaid.
  for (let i = 0; i < 17; i += 1) assert.equal((await sendConversion(key, joined.body.referralCode)).status, 200);
  const exhausted = await ConversionEvent.find({ campaignId: id, unpaidReason: "budget_exhausted" }).sort({ occurredAt: 1, createdAt: 1 }).lean();
  assert.equal(exhausted.length, 3);
  assert.equal((await Campaign.findById(id).lean()).referral.poolRemaining, 0);

  const topUp = (reference, amount) =>
    harness.api("POST", "/api/webhooks/paystack", {
      body: { event: "charge.success", data: { reference, amount: Math.round(amount * 100), currency: "NGN", metadata: { type: "referral_topup", campaignId: id } } },
    });

  // ₦7,142.86 less the 30% fee is ₦5,000: two of the three.
  assert.equal((await topUp(`ref_topup_${id}_1`, 7142.86)).status, 200);
  let events = await ConversionEvent.find({ _id: { $in: exhausted.map((e) => e._id) } }).lean();
  const byId = new Map(events.map((e) => [String(e._id), e]));
  assert.equal(byId.get(String(exhausted[0]._id)).rewardAmount, REWARD, "oldest paid first");
  assert.equal(byId.get(String(exhausted[1]._id)).rewardAmount, REWARD);
  assert.equal(byId.get(String(exhausted[2]._id)).rewardAmount, 0);
  assert.equal(byId.get(String(exhausted[2]._id)).unpaidReason, "budget_exhausted");
  assert.ok(new Date(byId.get(String(exhausted[0]._id)).availableAt) > new Date(Date.now() + 6 * DAY), "a fresh 7-day hold");
  assert.equal((await Campaign.findById(id).lean()).referral.poolRemaining, 0);
  const told = await Notification.find({ creatorId: creator.id, campaignId: id, type: "referral_backpay" }).lean();
  assert.equal(told.length, 1, "the creator is told once per top-up");
  assert.match(told[0].body, /2 earlier sign-ups/);

  // The same payment again (Paystack retry) pays nothing more.
  assert.equal((await topUp(`ref_topup_${id}_1`, 7142.86)).status, 200);
  assert.equal(await ConversionEvent.countDocuments({ campaignId: id, rewardAmount: { $gt: 0 } }), 16);

  // Two deliveries of the next top-up at once: the last one is paid exactly once.
  const results = await Promise.all([topUp(`ref_topup_${id}_2`, 3571.43), topUp(`ref_topup_${id}_2`, 3571.43)]);
  assert.ok(results.every((r) => r.status === 200));
  events = await ConversionEvent.find({ campaignId: id }).lean();
  assert.equal(events.filter((e) => e.rewardAmount > 0).length, 17);
  assert.equal(events.filter((e) => e.unpaidReason).length, 0);
  const campaign = await Campaign.findById(id).lean();
  assert.equal(campaign.referral.poolRemaining, 0);
  assert.equal(campaign.referral.earned, 17 * REWARD);
  const result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
});

// A live sign-up campaign at ₦10,000 per sign-up whose ₦35,000 pool paid 3 and left ₦5,000, with 3
// more sign-ups recorded unpaid (oldest first in `exhausted`).
const BIG_REWARD = 10000;
async function exhaustedSignupCampaign() {
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const { id, key } = await liveSignupCampaign("open_call");
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const reward = await harness.api("PATCH", `/api/admin/referrals/campaigns/${id}/reward`, { token: admin.token, body: { rewardPerConversion: BIG_REWARD } });
  assert.equal(reward.status, 200, JSON.stringify(reward.body));
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  for (let i = 0; i < 6; i += 1) assert.equal((await sendConversion(key, joined.body.referralCode)).status, 200);
  const exhausted = await ConversionEvent.find({ campaignId: id, unpaidReason: "budget_exhausted" }).sort({ occurredAt: 1, createdAt: 1 }).lean();
  assert.equal(exhausted.length, 3);
  return { id, key, code: joined.body.referralCode, exhausted };
}

// ₦21,428.57 less the 30% fee is ₦15,000: the pool then holds ₦20,000, two rewards.
const creditTwoRewards = (id, suffix) =>
  require("../../src/utils/referralEarnings").creditReferralTopup({ campaignId: id, reference: `ref_two_${id}_${suffix}`, amount: 21428.57 });

async function expectTwoPaidOnce(id, exhausted) {
  const Campaign = require("../../src/models/Campaign");
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const events = await ConversionEvent.find({ _id: { $in: exhausted.map((e) => e._id) } }).lean();
  const byId = new Map(events.map((e) => [String(e._id), e]));
  assert.equal(byId.get(String(exhausted[0]._id)).rewardAmount, BIG_REWARD);
  assert.equal(byId.get(String(exhausted[1]._id)).rewardAmount, BIG_REWARD);
  assert.equal(byId.get(String(exhausted[2]._id)).rewardAmount, 0);
  assert.equal(byId.get(String(exhausted[2]._id)).unpaidReason, "budget_exhausted");
  assert.ok(events.every((e) => !e.payingClaim), "no claim left behind");
  const campaign = await Campaign.findById(id).lean();
  assert.equal(campaign.referral.poolRemaining, 0, "pool decremented once per paid conversion");
  assert.equal(campaign.referral.earned, 5 * BIG_REWARD);
  assert.equal((campaign.referral.payingConversions || []).length, 0);
  const result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
}

test("back-pay that crashes after claiming a conversion pays it exactly once on the retry", async () => {
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const Campaign = require("../../src/models/Campaign");
  const earnings = require("../../src/utils/referralEarnings");
  const { id, exhausted } = await exhaustedSignupCampaign();

  earnings.backPayHooks.afterClaim = async () => {
    earnings.backPayHooks.afterClaim = null;
    throw new Error("process died after the claim");
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal((await creditTwoRewards(id, "claim")).credited, true);
  } finally {
    console.error = error;
    earnings.backPayHooks.afterClaim = null;
  }
  const claimed = await ConversionEvent.findById(exhausted[0]._id).lean();
  assert.equal(claimed.unpaidReason, "budget_exhausted", "still unpaid: nothing reserved yet");
  assert.equal(claimed.rewardAmount, 0);
  assert.ok(claimed.payingClaim);
  assert.equal((await Campaign.findById(id).lean()).referral.poolRemaining, 20000);

  // Straight away the claim is still fresh: nobody else pays past it.
  assert.equal((await earnings.payUnpaidConversions(id, new Date(), { reasons: ["budget_exhausted"] })).paid, 0);
  const retried = await earnings.payUnpaidConversions(id, new Date(Date.now() + 10 * 60 * 1000), { reasons: ["budget_exhausted"] });
  assert.equal(retried.paid, 2);
  await expectTwoPaidOnce(id, exhausted);
});

test("back-pay that crashes after reserving the reward never reserves it twice", async () => {
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const Campaign = require("../../src/models/Campaign");
  const earnings = require("../../src/utils/referralEarnings");
  const { id, exhausted } = await exhaustedSignupCampaign();

  earnings.backPayHooks.afterReserve = async () => {
    earnings.backPayHooks.afterReserve = null;
    throw new Error("process died after the reservation");
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal((await creditTwoRewards(id, "reserve")).credited, true);
  } finally {
    console.error = error;
    earnings.backPayHooks.afterReserve = null;
  }
  const claimed = await ConversionEvent.findById(exhausted[0]._id).lean();
  assert.equal(claimed.rewardAmount, 0);
  assert.equal(claimed.unpaidReason, "budget_exhausted");
  const campaign = await Campaign.findById(id).lean();
  assert.equal(campaign.referral.poolRemaining, 10000, "reserved once");
  assert.equal(campaign.referral.payingConversions.length, 1);

  // A Paystack retry of the same payment re-runs back-pay; the stale claim is taken over later.
  assert.equal((await earnings.payUnpaidConversions(id, new Date(Date.now() + 10 * 60 * 1000), { reasons: ["budget_exhausted"] })).paid, 2);
  await expectTwoPaidOnce(id, exhausted);
});

test("the 15-minute job finishes back-pay a crash stranded, with no new top-up or sign-up", async () => {
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const earnings = require("../../src/utils/referralEarnings");
  const { runScheduledOpsAlerts } = require("../../src/services/opsAlerts");
  const { id, exhausted } = await exhaustedSignupCampaign();

  earnings.backPayHooks.afterClaim = async () => {
    earnings.backPayHooks.afterClaim = null;
    throw new Error("process died after the claim");
  };
  const error = console.error;
  console.error = () => {};
  try {
    assert.equal((await creditTwoRewards(id, "job")).credited, true);
  } finally {
    console.error = error;
    earnings.backPayHooks.afterClaim = null;
  }
  assert.ok((await ConversionEvent.findById(exhausted[0]._id).lean()).payingClaim);

  // Within 5 minutes the claim is still fresh: the job leaves it.
  await runScheduledOpsAlerts({ now: new Date(Date.now() + 2 * 60 * 1000), notify: async () => {} });
  assert.equal((await ConversionEvent.findById(exhausted[0]._id).lean()).rewardAmount, 0);

  const later = new Date(Date.now() + 6 * 60 * 1000);
  const first = await runScheduledOpsAlerts({ now: later, notify: async () => {} });
  assert.equal(first.backPay.paid, 2);
  const again = await runScheduledOpsAlerts({ now: new Date(later.getTime() + 15 * 60 * 1000), notify: async () => {} });
  assert.equal(again.backPay.paid, 0, "never pays twice");
  await expectTwoPaidOnce(id, exhausted);
});

test("a sign-up arriving while a top-up is credited never jumps ahead of older unpaid sign-ups", async () => {
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const earnings = require("../../src/utils/referralEarnings");
  const { id, key, code, exhausted } = await exhaustedSignupCampaign();

  // ₦7,142.86 less the fee is ₦5,000: with the ₦5,000 left, exactly one reward.
  let live;
  earnings.backPayHooks.beforeBackPay = async () => {
    earnings.backPayHooks.beforeBackPay = null;
    live = await sendConversion(key, code);
  };
  try {
    const credited = await earnings.creditReferralTopup({ campaignId: id, reference: `ref_race_${id}`, amount: 7142.86 });
    assert.equal(credited.credited, true);
  } finally {
    earnings.backPayHooks.beforeBackPay = null;
  }
  assert.equal(live.status, 200, JSON.stringify(live.body));
  const oldest = await ConversionEvent.findById(exhausted[0]._id).lean();
  assert.equal(oldest.rewardAmount, BIG_REWARD, "the oldest unpaid sign-up is paid first");
  const newest = await ConversionEvent.findOne({ campaignId: id }).sort({ occurredAt: -1, createdAt: -1 }).lean();
  assert.equal(newest.rewardAmount, 0, "the new sign-up waits its turn");
  assert.equal(newest.unpaidReason, "budget_exhausted");
  assert.equal(await ConversionEvent.countDocuments({ campaignId: id, rewardAmount: { $gt: 0 } }), 4);
});

test("a sign-up campaign's referral payout, cancellation refunds and ledger reconcile to the kobo", async () => {
  const Campaign = require("../../src/models/Campaign");
  const ConversionEvent = require("../../src/models/ConversionEvent");
  const Transaction = require("../../src/models/Transaction");
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const { brand, id, key } = await liveSignupCampaign("open_call");
  const admin = await setReward(id);
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  await harness.api("POST", "/api/creators/bank-account", {
    token: creator.token,
    body: { accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" },
  });
  assert.equal((await sendConversion(key, joined.body.referralCode)).status, 200);

  let result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.paidIn, 480000);
  assert.equal(result.owed, REWARD);

  // The hold is over.
  await ConversionEvent.updateMany({ campaignId: id }, { $set: { availableAt: new Date(Date.now() - DAY) } });
  const requested = await harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId: id } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.referralAmount, REWARD);
  assert.equal(requested.body.fixedAmount, 0);
  const paid = await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const [release] = await Transaction.find({ campaignId: id, type: "release" }).lean();
  assert.equal(release.bucket, "referral");
  assert.equal(release.status, "released");

  const cancelled = await harness.api("PATCH", `/api/campaigns/${id}/cancel`, { token: brand.token });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const refunds = await Transaction.find({ campaignId: id, type: "refund" }).sort({ bucket: 1 }).lean();
  assert.deepEqual(refunds.map((r) => [r.bucket, r.amount]), [["referral", 46428.57], ["views", 301000]]);

  result = await reconcileCampaignById(id);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.released, REWARD);
  // Sent to Paystack, not yet confirmed.
  assert.equal(result.pendingRefunds, 347428.57);
  assert.equal(result.refunds, 0);
  assert.equal(result.left, 0);
  assert.equal(
    result.paidIn,
    Math.round((result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.pendingRefunds + result.left) * 100) / 100
  );
  assert.equal((await Campaign.findById(id).lean()).referral.poolRemaining, 0);
});
