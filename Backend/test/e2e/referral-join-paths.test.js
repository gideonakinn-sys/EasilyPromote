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
async function liveSignupCampaign(creatorAccess) {
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "App launch",
      category: "Tech",
      campaignObjective: "signups",
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
function sendConversion(key, code) {
  const { buildSignedRequest } = require("../../src/services/conversions");
  eventCounter += 1;
  const request = buildSignedRequest({
    keyId: key.keyId,
    secret: key.secret,
    payload: { event_id: `evt_${Date.now()}_${eventCounter}`, code, event: "signup", timestamp: new Date().toISOString() },
  });
  return harness.rawPost("/api/webhooks/conversions", request);
}

async function setReward(campaignId) {
  const admin = await harness.registerAdmin();
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

async function expectRewardCredited({ campaignId, creator, key, code }) {
  const Campaign = require("../../src/models/Campaign");
  const before = await Campaign.findById(campaignId).lean();
  const sent = await sendConversion(key, code);
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
  assert.equal(result.refunds, 347428.57);
  assert.equal(result.left, 0);
  assert.equal(result.paidIn, Math.round((result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.left) * 100) / 100);
  assert.equal((await Campaign.findById(id).lean()).referral.poolRemaining, 0);
});
