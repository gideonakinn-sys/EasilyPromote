// Hybrid pay (ticket 10): a content campaign pays a base per approved deliverable plus a bonus from a
// pool the brand funds at checkout. Checkout charges base + pool + the fee on top of each; the base
// is credited on the fixed-pay trigger (D1); the bonus is reserved from the pool as views or
// conversions are verified, up to the per-creator cap, never overdrawing the pool; the wallet shows
// base and bonus apart; finance admins refund the unused pool; and the books reconcile to the kobo.
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
const BASE = 5000;
const REWARD = 2500;
// The price table's first tier, less the 30% fee, per 1,000 views.
const VIEWS_RATE = 3010;

const brief = { summary: "Show the serum in your morning routine", hashtags: ["#GlowDrop"] };
const model = (name) => require(`../../src/models/${name}`);
const bonusService = () => require("../../src/utils/hybridBonus");

async function connectBrandApp(brand) {
  const now = new Date();
  await model("BusinessProfile").updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

function hybridBody({ metric = "views", pool = 20000, capPerCreator = 8000, deliverables = 3, destination = "creator_page" } = {}) {
  return {
    name: `Glow ${metric} hybrid`,
    category: "Beauty",
    campaignObjective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: BASE, deliverables },
    hybridBonus: { metric, pool, capPerCreator },
    contentDestination: destination,
    creatorAccess: "open_call",
    brief,
  };
}

// A paid, live hybrid campaign; conversion bonuses also get a signing key for the brand's server.
async function liveHybridCampaign(options = {}) {
  const brand = await harness.registerBrand();
  if (options.metric && options.metric !== "views") await connectBrandApp(brand);
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: hybridBody(options) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  let key = null;
  if (options.metric && options.metric !== "views") {
    const res = await harness.api("POST", "/api/referral/keys", { token: brand.token, body: { name: "Server" } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    key = { keyId: res.body.key.keyId, secret: res.body.secret };
  }
  return { brand, id, key, reference: checkout.body.reference, quote: created.body.quote };
}

const patch = (path, token, body) => harness.api("PATCH", path, { token, body });

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
    body: { campaignId, videoUrl: "https://drive.example.com/glow.mp4", caption: "Morning glow #GlowDrop" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { ...creator, submissionId: submitted.body.id, referralCode: joined.body.referralCode || null };
}

// Approved, posted and the live post verified: the base is due (D1, creator page).
async function approveAndVerifyPost(brand, creator) {
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/approve`, brand.token)).status, 200);
  const posted = await patch(`/api/submissions/${creator.submissionId}/mark-posted`, creator.token, {
    posts: [{ platform: "tiktok", postUrl: `https://www.tiktok.com/@c/video/${Date.now()}${Math.floor(Math.random() * 1e6)}` }],
    caption: "#GlowDrop",
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/confirm-post`, brand.token)).status, 200);
}

const setViews = (creator, views) => model("Submission").updateOne({ _id: creator.submissionId }, { $set: { viewsDelivered: views } });
const bonusCredits = (campaignId, creatorId) =>
  model("Transaction").find({ campaignId, type: "bonus_credit", status: "credited", ...(creatorId && { creatorId }) }).lean();
const sumAmounts = (rows) => Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
const campaignDoc = (id) => model("Campaign").findById(id).lean();

async function reconcile(campaignId) {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  return reconcileCampaignById(campaignId);
}

async function assertBalanced(campaignId) {
  const result = await reconcile(campaignId);
  assert.ok(result.ok, JSON.stringify(result.problems));
  assert.equal(result.paidIn, result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.pendingRefunds + result.left);
  return result;
}

let eventCounter = 0;
function sendConversion(key, code, event = "signup") {
  const { buildSignedRequest } = require("../../src/services/conversions");
  eventCounter += 1;
  const request = buildSignedRequest({
    keyId: key.keyId,
    secret: key.secret,
    payload: { event_id: `hyb_${Date.now()}_${eventCounter}`, code, event, timestamp: new Date().toISOString() },
  });
  return harness.rawPost("/api/webhooks/conversions", request);
}

async function wallet(creator) {
  const res = await harness.api("GET", "/api/creators/wallet", { token: creator.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

// ── Setup and checkout ──────────────────────────────────────────────────────

test("checkout charges base + bonus pool + the fee on top of each, booked to the fixed and bonus pots", async () => {
  const { brand, id, reference, quote } = await liveHybridCampaign({ metric: "views", pool: 20000, capPerCreator: 8000, deliverables: 3 });
  // 3 × ₦5,000 base (fee ₦4,500) + ₦20,000 pool (fee ₦6,000).
  assert.deepEqual(quote, { creatorBudget: 15000, performanceBudget: 0, bonusPool: 20000, bonusFee: 6000, platformFee: 10500, total: 45500 });

  const campaign = await campaignDoc(id);
  assert.equal(campaign.paymentAmount, 45500);
  assert.equal(campaign.budget, 19500);
  assert.equal(campaign.creatorPool, 15000);
  assert.equal(campaign.platformFee, 4500);
  assert.equal(campaign.hybridBonus.pool, 20000);
  assert.equal(campaign.hybridBonus.poolRemaining, 20000);
  assert.equal(campaign.hybridBonus.platformFee, 6000);
  assert.equal(campaign.hybridBonus.ratePerThousandViews, VIEWS_RATE);
  assert.equal(harness.paystack.charged(reference), 45500);

  const deposits = await model("Transaction").find({ campaignId: id, status: "escrow_deposit" }).sort({ bucket: 1 }).lean();
  assert.deepEqual(
    deposits.map((d) => [d.bucket, d.type, d.amount, d.reference]),
    [
      ["bonus", "topup", 26000, reference],
      ["fixed", "escrow_deposit", 19500, reference],
    ]
  );
  // A second confirmation of the same payment books nothing more.
  const again = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.equal(again.status, 200);
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, status: "escrow_deposit" }), 2);

  const result = await assertBalanced(id);
  assert.equal(result.paidIn, 45500);
  assert.equal(result.platformFee, 10500);
  assert.equal(result.left, 35000);
});

test("hybrid setup: the brand sets base, pool and cap but never a bonus rate; views bonuses need the creator's own post", async () => {
  const brand = await harness.registerBrand();
  const rate = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { ...hybridBody(), hybridBonus: { metric: "views", pool: 20000, capPerCreator: 8000, ratePerThousandViews: 9000 } },
  });
  assert.equal(rate.status, 400);
  assert.equal(rate.body.code, "RATE_NOT_BRAND_SET");

  const brandPageViews = await harness.api("POST", "/api/campaigns", { token: brand.token, body: hybridBody({ destination: "brand_page" }) });
  assert.equal(brandPageViews.status, 400);
  assert.match(brandPageViews.body.error, /own page/);

  const overCap = await harness.api("POST", "/api/campaigns", { token: brand.token, body: hybridBody({ pool: 5000, capPerCreator: 6000 }) });
  assert.equal(overCap.status, 400);

  // The wizard's quote is the same calculator.
  const quoted = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: hybridBody({ pool: 10000, capPerCreator: 2000, deliverables: 2 }) });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.equal(quoted.body.quote.total, 26000);

  // A draft saved before the bonus is set can't be paid for; editing the bonus reprices it.
  const draft = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { ...hybridBody(), hybridBonus: undefined },
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const refused = await harness.api("POST", `/api/campaigns/${draft.body.id}/pay`, { token: brand.token });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, "HYBRID_BONUS_REQUIRED");
  const edited = await patch(`/api/campaigns/${draft.body.id}`, brand.token, { hybridBonus: { metric: "signups", pool: 10000, capPerCreator: 4000 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  let stored = await campaignDoc(draft.body.id);
  assert.equal(stored.hybridBonus.metric, "signups");
  assert.equal(stored.hybridBonus.platformFee, 3000);
  assert.equal(stored.referral.enabled, true, "sign-up bonuses are tracked with referral codes");
  assert.deepEqual(stored.referral.eventTypes, ["signup"]);

  // A sign-up bonus needs the brand's app connected before paying, as referral campaigns do.
  const unconnected = await harness.api("POST", `/api/campaigns/${draft.body.id}/pay`, { token: brand.token });
  assert.equal(unconnected.status, 409);
  assert.equal(unconnected.body.code, "INTEGRATION_REQUIRED");

  // Switching back to fixed pay drops the bonus and its tracking.
  const fixed = await patch(`/api/campaigns/${draft.body.id}`, brand.token, { payShape: "fixed" });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  stored = await campaignDoc(draft.body.id);
  assert.equal(stored.hybridBonus, undefined);
  assert.equal(stored.referral.enabled, false);
  assert.equal(stored.budget, 19500);
});

test("a new bonus pool during an open checkout is a new price: the campaign goes back to draft", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: hybridBody() });
  const id = created.body.id;
  assert.equal((await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token })).status, 200);
  assert.equal((await campaignDoc(id)).status, "pending_payment");
  const edited = await patch(`/api/campaigns/${id}`, brand.token, { hybridBonus: { metric: "views", pool: 30000, capPerCreator: 8000 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const campaign = await campaignDoc(id);
  assert.equal(campaign.status, "draft");
  assert.equal(campaign.paymentAmount, 0);
  assert.equal(campaign.hybridBonus.pool, 30000);
});

// ── Base and views bonus ────────────────────────────────────────────────────

test("base is credited when the post is verified; the views bonus accrues from verified views up to the cap", async () => {
  const { brand, id } = await liveHybridCampaign({ metric: "views", pool: 20000, capPerCreator: 8000, deliverables: 3 });
  const creator = await joinAndSubmit(id);

  // Marketplace card and campaign page read "₦5,000 + bonus".
  const other = await harness.registerCreator();
  const dash = await harness.api("GET", "/api/creators/dashboard", { token: other.token });
  const card = dash.body.marketplace.campaigns.find((c) => String(c.id) === id);
  assert.equal(card.payShape, "hybrid");
  assert.deepEqual(card.pay, { amount: BASE, unit: "approved deliverable", bonus: { metric: "views", amount: VIEWS_RATE, unit: "1,000 views", capPerCreator: 8000, available: true } });

  // Views before the post is verified earn nothing.
  await setViews(creator, 1000);
  await bonusService().accrueViewsBonus(id);
  assert.equal((await bonusCredits(id)).length, 0);

  await approveAndVerifyPost(brand, creator);
  const [base] = await model("Transaction").find({ campaignId: id, type: "fixed_credit" }).lean();
  assert.equal(base.amount, BASE, "base credited on the fixed-pay trigger");

  // 1,234 verified views × ₦3.01 = ₦3,714.34.
  await setViews(creator, 1234);
  assert.equal((await bonusService().accrueViewsBonus(id)).amount, 3714.34);
  // Running again with no new views credits nothing; racing runs never credit twice.
  await Promise.all([1, 2, 3].map(() => bonusService().accrueViewsBonus(id)));
  assert.equal(sumAmounts(await bonusCredits(id)), 3714.34);

  // More views credit only the difference, and stop at the ₦8,000 cap.
  await setViews(creator, 2000);
  await bonusService().accrueViewsBonus(id);
  assert.equal(sumAmounts(await bonusCredits(id)), 6020);
  await setViews(creator, 1000000);
  await bonusService().accrueViewsBonus(id);
  const credits = await bonusCredits(id);
  assert.equal(sumAmounts(credits), 8000);
  assert.equal(credits.length, 3);
  assert.ok(credits.every((c) => c.bucket === "bonus" && String(c.creatorId) === creator.id));

  const campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 12000);
  assert.equal(campaign.hybridBonus.reserved, 8000);
  assert.equal((campaign.hybridBonus.pending || []).length, 0);
  await assertBalanced(id);
});

test("the views bonus never overdraws the pool, even when creators accrue at the same moment", async () => {
  const { brand, id } = await liveHybridCampaign({ metric: "views", pool: 10000, capPerCreator: 6000, deliverables: 3 });
  const creators = [];
  for (let i = 0; i < 3; i += 1) {
    const creator = await joinAndSubmit(id);
    await approveAndVerifyPost(brand, creator);
    await setViews(creator, 1000000);
    creators.push(creator);
  }
  await Promise.all([bonusService().accrueViewsBonus(id), bonusService().accrueViewsBonus(id), bonusService().accrueAllViewsBonuses()]);

  const credits = await bonusCredits(id);
  assert.equal(sumAmounts(credits), 10000, "the whole pool, not a kobo more");
  const perCreator = creators.map((c) => sumAmounts(credits.filter((r) => String(r.creatorId) === c.id)));
  assert.ok(perCreator.every((amount) => amount <= 6000), JSON.stringify(perCreator));
  const campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 0);
  assert.equal(campaign.hybridBonus.reserved, 10000);
  await assertBalanced(id);

  // A views bonus stops accruing once the campaign isn't live.
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  assert.equal((await patch(`/api/admin/campaigns/${id}/status`, admin.token, { status: "completed" })).status, 200);
  assert.deepEqual(await bonusService().accrueViewsBonus(id), { credited: 0, amount: 0 });
});

test("a reservation interrupted before its ledger row is settled once, by the next run", async () => {
  const { brand, id } = await liveHybridCampaign({ metric: "views", pool: 20000, capPerCreator: 8000 });
  const creator = await joinAndSubmit(id);
  await approveAndVerifyPost(brand, creator);

  // A crash after the reservation: the pool is spent and the entry pending, but no ledger row.
  const { Campaign } = { Campaign: model("Campaign") };
  await Campaign.updateOne(
    { _id: id },
    {
      $set: { "hybridBonus.poolRemaining": 19000, "hybridBonus.reserved": 1000 },
      $push: {
        "hybridBonus.creators": { creatorId: creator.id, earned: 1000 },
        "hybridBonus.pending": { ref: `bonus_views_${id}_${creator.id}_100000`, creatorId: creator.id, amount: 1000, at: new Date() },
      },
    }
  );
  assert.match((await reconcile(id)).problems.join("\n"), /haven't been written to the ledger yet|hasn't been written to the ledger yet/);

  await setViews(creator, 1000);
  await Promise.all([bonusService().accrueViewsBonus(id), bonusService().accrueAllViewsBonuses()]);
  const credits = await bonusCredits(id);
  // ₦1,000 settled from the interrupted reservation, plus ₦2,010 more for 1,000 views (₦3,010 due).
  assert.equal(sumAmounts(credits), 3010);
  assert.equal(credits.filter((c) => c.amount === 1000).length, 1);
  await assertBalanced(id);
});

// ── Conversion bonus ────────────────────────────────────────────────────────

test("sign-up bonus: paid from the pool once admin sets the reward, capped per creator, never beyond the pool, voidable in its hold", async () => {
  const { brand, id, key } = await liveHybridCampaign({ metric: "signups", pool: 10000, capPerCreator: 6000, deliverables: 2, destination: "brand_page" });
  const first = await joinAndSubmit(id);
  const second = await joinAndSubmit(id);
  assert.ok(first.referralCode && second.referralCode, "codes created on join");

  // The base is credited on approval for brand-page content.
  assert.equal((await patch(`/api/submissions/${first.submissionId}/approve`, brand.token)).status, 200);
  assert.equal((await model("Transaction").find({ campaignId: id, type: "fixed_credit" }).lean()).length, 1);

  // Before admin sets the reward, sign-ups are recorded but earn nothing yet.
  const early = await sendConversion(key, first.referralCode);
  assert.deepEqual(early.body, { status: "recorded", counted: true });
  const [waiting] = await model("ConversionEvent").find({ campaignId: id }).lean();
  assert.equal(waiting.unpaidReason, "bonus_rate_not_set");
  assert.equal(waiting.rewardAmount, 0);

  // Admin sets it: the earlier sign-up is paid from the bonus pool, not a referral budget.
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const reward = await patch(`/api/admin/referrals/campaigns/${id}/reward`, admin.token, { rewardPerConversion: REWARD });
  assert.equal(reward.status, 200, JSON.stringify(reward.body));
  assert.equal(reward.body.paidEarlierConversions, 1);
  let campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 7500);
  assert.equal(campaign.referral.poolRemaining, 0, "the referral budget is untouched");

  // ₦2,500 each up to the ₦6,000 cap: the third pays the ₦1,000 left of it, the fourth nothing.
  for (let i = 0; i < 3; i += 1) assert.equal((await sendConversion(key, first.referralCode)).status, 200);
  const firstCredits = await bonusCredits(id, first.id);
  assert.deepEqual(firstCredits.map((c) => c.amount).sort((a, b) => a - b), [1000, 2500, 2500]);
  const capped = await model("ConversionEvent").findOne({ campaignId: id, creatorId: first.id, unpaidReason: "bonus_cap_reached" }).lean();
  assert.ok(capped, "a conversion past the cap is recorded unpaid");

  // The other creator's sign-ups, all at once, use up what's left of the pool (₦4,000) and no more.
  const sent = await Promise.all([1, 2, 3].map(() => sendConversion(key, second.referralCode)));
  assert.ok(sent.every((r) => r.status === 200));
  assert.equal(sumAmounts(await bonusCredits(id, second.id)), 4000);
  campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 0);
  assert.equal(await model("ConversionEvent").countDocuments({ campaignId: id, unpaidReason: "bonus_pool_exhausted" }), 1);
  await assertBalanced(id);

  // Voiding a conversion in its hold gives its bonus back to the pool.
  const paidEvent = await model("ConversionEvent").findOne({ campaignId: id, creatorId: second.id, bonusAmount: 2500 }).lean();
  const voided = await harness.api("POST", `/api/admin/referrals/conversions/${paidEvent._id}/void`, { token: admin.token, body: { note: "Duplicate sign-up" } });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 2500);
  assert.equal(sumAmounts(await bonusCredits(id, second.id)), 1500);
  await assertBalanced(id);

  // The creator's wallet never counts a bonus as referral earnings.
  const referral = (await wallet(second)).referral.byCampaign.find((c) => String(c.id) === id);
  assert.equal(referral ? referral.earned : 0, 0);
});

test("a sign-up bonus void interrupted by a crash is returned to the pool once by the ops job", async () => {
  const { runScheduledOpsAlerts } = require("../../src/services/opsAlerts");
  const { id, key } = await liveHybridCampaign({ metric: "signups", pool: 10000, capPerCreator: 10000, deliverables: 1, destination: "brand_page" });
  const creator = await joinAndSubmit(id);
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  assert.equal((await patch(`/api/admin/referrals/campaigns/${id}/reward`, admin.token, { rewardPerConversion: REWARD })).status, 200);
  assert.equal((await sendConversion(key, creator.referralCode)).status, 200);
  assert.equal((await sendConversion(key, creator.referralCode)).status, 200);
  assert.equal((await campaignDoc(id)).hybridBonus.poolRemaining, 5000);
  const [firstEvent, secondEvent] = await model("ConversionEvent").find({ campaignId: id, bonusAmount: REWARD }).sort({ createdAt: 1 }).lean();

  // The API dies after the credit is voided, before the bonus goes back to the pool.
  const hooks = bonusService().voidHooks;
  hooks.afterCreditVoided = async () => {
    throw new Error("simulated crash");
  };
  try {
    const crashed = await harness.api("POST", `/api/admin/referrals/conversions/${firstEvent._id}/void`, { token: admin.token, body: { note: "Fake sign-up" } });
    assert.equal(crashed.status, 500);
  } finally {
    hooks.afterCreditVoided = null;
  }
  assert.equal((await campaignDoc(id)).hybridBonus.poolRemaining, 5000, "the pool is short until it's repaired");
  const short = await reconcile(id);
  assert.ok(!short.ok);
  assert.ok(short.problems.some((p) => /voided bonus hasn't gone back to the pool/.test(p)), JSON.stringify(short.problems));

  // A crash after the give-back but before the marker is cleared: returning it again changes nothing.
  hooks.afterCreditVoided = null;
  await runScheduledOpsAlerts({ notify: async () => {} });
  let campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 7500);
  assert.equal(campaign.hybridBonus.reserved, 2500);
  await model("Transaction").updateOne({ reference: `bonus_conv_${firstEvent._id}` }, { $set: { bonusGiveBack: "pending" } });
  assert.equal(await bonusService().repairVoidedBonuses(), 1);
  await runScheduledOpsAlerts({ notify: async () => {} });
  campaign = await campaignDoc(id);
  assert.equal(campaign.hybridBonus.poolRemaining, 7500, "never returned twice");
  assert.equal((await model("Transaction").findOne({ reference: `bonus_conv_${firstEvent._id}` }).lean()).bonusGiveBack, "done");
  await assertBalanced(id);

  // A void that isn't interrupted returns its bonus at once.
  const voided = await harness.api("POST", `/api/admin/referrals/conversions/${secondEvent._id}/void`, { token: admin.token, body: { note: "Fake sign-up" } });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal((await campaignDoc(id)).hybridBonus.poolRemaining, 10000);
  await assertBalanced(id);
});

// ── Wallet, withdrawal, refund, reconciliation ──────────────────────────────

test("end to end: wallet shows base and bonus apart, both are withdrawn and paid, the unused pool is refunded, and it reconciles", async () => {
  const { payoutWeekStart } = require("../../src/utils/payoutSchedule");
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const { brand, id } = await liveHybridCampaign({ metric: "views", pool: 20000, capPerCreator: 8000, deliverables: 3 });
  const creator = await joinAndSubmit(id);
  await approveAndVerifyPost(brand, creator);
  await setViews(creator, 2000);
  await bonusService().accrueViewsBonus(id);

  // Right away: base and bonus both earned, both held, shown apart.
  let entry = (await wallet(creator)).withdrawCampaigns.find((c) => String(c.id) === id);
  assert.equal(entry.payShape, "hybrid");
  assert.deepEqual(entry.earnings, { fixed: BASE, performance: 0, referral: 0, bonus: 6020 });
  assert.equal(entry.fixedOnHold, BASE);
  assert.equal(entry.bonusOnHold, 6020);
  assert.equal(entry.total, 0);
  assert.deepEqual(entry.onHold.map((h) => h.pot).sort(), ["bonus", "fixed"]);
  let body = await wallet(creator);
  assert.equal(body.bonus.earned, 6020);
  assert.equal(body.fixed.earned, BASE);

  // A withdrawal before the holds end is refused and names the bonus hold or the base hold.
  assert.equal((await harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId: id } })).status, 400);

  // 8 days later both are available and go out in one withdrawal, each part from its own pot.
  const eightDaysAgo = new Date(Date.now() - 8 * DAY);
  await model("Submission").updateOne({ _id: creator.submissionId }, { $set: { completedAt: eightDaysAgo } });
  await model("Transaction").updateMany({ campaignId: id, type: "bonus_credit" }, { $set: { date: eightDaysAgo } });
  body = await wallet(creator);
  entry = body.withdrawCampaigns.find((c) => String(c.id) === id);
  assert.equal(entry.fixedAvailable, BASE);
  assert.equal(entry.bonusAvailable, 6020);
  assert.equal(entry.total, 11020);
  assert.equal(body.bonus.availableToWithdraw, 6020);

  const requested = await harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId: id } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.fixedAmount, BASE);
  assert.equal(requested.body.bonusAmount, 6020);
  await model("Withdrawal").updateOne({ _id: requested.body.id }, { $set: { requestedAt: new Date(payoutWeekStart(new Date()).getTime() - DAY) } });
  const run = await harness.api("GET", "/api/admin/payout-run", { token: admin.token });
  const line = run.body.groups.find((g) => String(g.campaignId) === id).lines[0];
  assert.equal(line.bonusAmount, 6020);
  assert.equal(line.fixedAmount, BASE);
  const paid = await harness.api("POST", "/api/admin/payout-run/approve", { token: admin.token, body: { withdrawalIds: [requested.body.id] } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const releases = await model("Transaction").find({ campaignId: id, type: "release", status: "released" }).lean();
  assert.deepEqual(releases.map((r) => [r.bucket, r.amount]).sort(), [["bonus", 6020], ["fixed", BASE]]);
  entry = (await wallet(creator)).withdrawCampaigns.find((c) => String(c.id) === id);
  assert.ok(!entry || entry.bonusAvailable === 0, "withdrawn bonus isn't offered again");
  await assertBalanced(id);

  // The unused pool can't be refunded while the campaign is live, nor by roles that don't move money.
  const refundBonus = (who, expectedAmount) => harness.api("POST", `/api/admin/campaigns/${id}/refund-unused-bonus`, { token: who.token, body: { expectedAmount } });
  const early = await refundBonus(admin, 1);
  assert.equal(early.status, 400);
  assert.equal(early.body.code, "CAMPAIGN_NOT_FINISHED");
  assert.equal((await patch(`/api/admin/campaigns/${id}/status`, admin.token, { status: "completed" })).status, 200);
  for (const role of ["support", "admin"]) {
    assert.equal((await refundBonus(await harness.registerAdmin({ role }), 18174)).status, 403, role);
  }

  // Admin sees base and bonus figures side by side.
  const budget = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: admin.token });
  assert.equal(budget.status, 200, JSON.stringify(budget.body));
  assert.equal(budget.body.payShape, "hybrid");
  assert.equal(budget.body.refundable.amount, 13000, "2 unused deliverables × ₦5,000 + ₦3,000 fee");
  assert.equal(budget.body.bonus.paidOut, 6020);
  assert.equal(budget.body.bonus.poolRemaining, 13980);
  // ₦13,980 unused pool + ₦4,194 of the ₦6,000 fee.
  assert.deepEqual(budget.body.bonus.refundable, { pool: 13980, platformFee: 4194, amount: 18174 });

  const stale = await refundBonus(admin, 18000);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "REFUND_CHANGED");
  const refunded = await refundBonus(admin, 18174);
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  assert.equal(refunded.body.refund.amount, 18174);
  assert.equal(refunded.body.bonus.poolRemaining, 0);
  const again = await refundBonus(admin, 18174);
  assert.equal(again.status, 400);
  assert.equal(again.body.code, "NOTHING_TO_REFUND");

  // The unused base is refunded as for fixed pay (D5 amended).
  const baseRefund = await harness.api("POST", `/api/admin/campaigns/${id}/refund-unused`, { token: admin.token, body: { expectedAmount: 13000 } });
  assert.equal(baseRefund.status, 200, JSON.stringify(baseRefund.body));

  const result = await assertBalanced(id);
  assert.equal(result.paidIn, 45500);
  assert.equal(result.released, 11020);
  assert.equal(result.pendingRefunds, 31174);
  assert.equal(result.left, 0);
  // Fee kept: ₦1,500 on the delivered base + ₦1,806 on the bonus paid.
  assert.equal(result.platformFee, 3306);
  assert.deepEqual(result.pots.bonus, { paidIn: 26000, released: 6020, inFlight: 0, owed: 0, platformFee: 1806, refunds: 0, pendingRefunds: 18174, left: 0 });

  // Every hybrid campaign in this run reconciles, with the rest of the ledger.
  const { reconcileAllCampaigns } = require("../../src/services/campaignReconciliation");
  const failing = (await reconcileAllCampaigns()).filter((r) => !r.ok);
  assert.deepEqual(failing.map((r) => ({ name: r.name, problems: r.problems })), []);
});

test("a sign-up bonus pool is refundable 7 days after completion, when conversions stop counting", async () => {
  const admin = await harness.registerAdmin({ role: "super_admin" });
  const { id } = await liveHybridCampaign({ metric: "downloads", pool: 5000, capPerCreator: 5000, deliverables: 1, destination: "brand_page" });
  assert.deepEqual((await campaignDoc(id)).referral.eventTypes, ["install"]);
  assert.equal((await patch(`/api/admin/campaigns/${id}/status`, admin.token, { status: "completed" })).status, 200);

  const refund = (expectedAmount) => harness.api("POST", `/api/admin/campaigns/${id}/refund-unused-bonus`, { token: admin.token, body: { expectedAmount } });
  const tooSoon = await refund(6500);
  assert.equal(tooSoon.status, 400);
  assert.match(tooSoon.body.error, /7 days after the campaign completes/);

  await model("Campaign").updateOne({ _id: id }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  const refunded = await refund(6500);
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  await assertBalanced(id);
});
