const mongoose = require("mongoose");
const { toObjectId } = require("./objectId");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const ReferralCode = require("../models/ReferralCode");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const Notification = require("../models/Notification");
const { campaignEventTypes } = require("./referralCodes");

// Earnings wait this long before a creator can withdraw them, so admins can void
// fake or reversed conversions first.
const REFERRAL_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REFERRAL_TOPUP = 1000;
const MAX_REFERRAL_TOPUP = 50000000;
const MAX_REWARD_PER_CONVERSION = 1000000;

const { roundMoney } = require("./money");
const { refundCampaignBucket } = require("./refunds");

// Reasons a counted conversion earned nothing that later budget or a reward can pay.
const PAYABLE_LATER_REASONS = ["budget_exhausted", "rate_not_set"];
// A back-pay claim this old belongs to a run that died; another run may take it over.
const PAYING_CLAIM_STALE_MS = 5 * 60 * 1000;
// Seams for tests only: throw to simulate a crash at that point of back-pay, or act just before a
// credited top-up starts paying earlier conversions.
const backPayHooks = { afterClaim: null, afterReserve: null, beforeBackPay: null };

// Counted conversions still waiting for pay, oldest first.
const waitingForPay = (campaignId, reasons = PAYABLE_LATER_REASONS) => ({
  campaignId,
  counted: true,
  voidedAt: null,
  unpaidReason: { $in: reasons },
  rewardAmount: { $not: { $gt: 0 } },
});

// Reserves the campaign's per-conversion reward for one counted conversion. The pool
// is decremented with a conditional update, so two conversions racing for the last of
// the budget can never both be paid. `eventId` is the conversion being paid: while older
// conversions still wait for pay it doesn't draw on the pool and is queued behind them
// (`queued: true`; the caller runs payQueuedConversions once it's recorded).
async function reserveConversionReward(campaign, counted, now = new Date(), { eventId = null } = {}) {
  if (!counted) return { rewardAmount: 0, unpaidReason: "not_counted", availableAt: null };

  const rate = roundMoney(campaign.referral && campaign.referral.rewardPerConversion);
  if (!(rate > 0)) return { rewardAmount: 0, unpaidReason: "rate_not_set", availableAt: null };

  if (await ConversionEvent.exists({ ...waitingForPay(campaign._id), ...(eventId && { _id: { $ne: eventId } }) })) {
    return { rewardAmount: 0, unpaidReason: "budget_exhausted", availableAt: null, queued: true };
  }

  const reserved = await Campaign.findOneAndUpdate(
    { _id: campaign._id, "referral.poolRemaining": { $gte: rate } },
    { $inc: { "referral.poolRemaining": -rate, "referral.earned": rate } },
    { new: true, projection: { _id: 1 } }
  );
  if (reserved) {
    return { rewardAmount: rate, unpaidReason: null, availableAt: new Date(now.getTime() + REFERRAL_HOLD_MS) };
  }

  await noteBudgetExhausted(campaign, now);
  return { rewardAmount: 0, unpaidReason: "budget_exhausted", availableAt: null };
}

async function noteBudgetExhausted(campaign, now) {
  // Only the first unpaid conversion since the last top-up notifies the brand.
  const flagged = await Campaign.updateOne(
    { _id: campaign._id, "referral.budgetExhaustedAt": null },
    { $set: { "referral.budgetExhaustedAt": now } }
  );
  if (flagged.modifiedCount === 1) {
    await Notification.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      type: "referral_budget_exhausted",
      title: "Referral budget used up",
      body: `The referral budget for "${campaign.name}" has run out. Conversions are still recorded, but creators aren't paid for new ones until you add more budget.`,
    });
  }
}

// Credits a verified referral-budget payment exactly once, keyed on the Paystack
// reference. `amount` must come from Paystack, never from the client.
async function creditReferralTopup({ campaignId, reference, amount, fromCampaignPayment = false }) {
  if (!reference) return { credited: false, reason: "missing_reference" };
  if (!(amount > 0)) return { credited: false, reason: "invalid_amount" };

  const campaign = await Campaign.findById(campaignId).select("platformFeePercent businessId name referral");
  if (!campaign) return { credited: false, reason: "campaign_not_found" };

  // A reference already used for something else must be rejected. A campaign checkout
  // pays the views deposit and the referral budget with one reference, so that pair is allowed.
  const allowedTypes = fromCampaignPayment ? ["topup", "escrow_deposit"] : ["topup"];
  const prior = await Transaction.findOne({
    reference,
    $or: [{ type: { $nin: allowedTypes } }, { type: "topup", bucket: { $ne: "referral" } }],
  });
  if (prior) return { credited: false, reason: "reference_already_used" };

  const feePercent = Number.isFinite(campaign.platformFeePercent) ? campaign.platformFeePercent : 30;
  const fee = roundMoney((amount * feePercent) / 100);
  const net = roundMoney(amount - fee);

  const existing = await Transaction.findOneAndUpdate(
    { reference, type: "topup", bucket: "referral" },
    {
      $setOnInsert: {
        campaignId: campaign._id,
        type: "topup",
        bucket: "referral",
        amount,
        feeAmount: fee,
        status: "escrow_deposit",
        reference,
        date: new Date(),
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true }
  );
  if (existing) {
    // A repeat (webhook retry, the brand's return) finishes any back-pay an earlier call didn't.
    const backPay = await payConversionsAfterTopup(campaign._id);
    return { credited: false, alreadyCredited: true, campaign, backPay };
  }

  const updated = await Campaign.findByIdAndUpdate(
    campaign._id,
    {
      $inc: {
        "referral.budget": amount,
        "referral.platformFee": fee,
        "referral.pool": net,
        "referral.poolRemaining": net,
      },
      $set: { "referral.budgetExhaustedAt": null },
    },
    { new: true }
  );
  // Sign-ups recorded while the budget was empty are paid from the new pool first. New sign-ups
  // arriving meanwhile queue behind them (reserveConversionReward).
  if (backPayHooks.beforeBackPay) await backPayHooks.beforeBackPay({ campaignId: campaign._id });
  const backPay = await payConversionsAfterTopup(campaign._id);
  const current = backPay.paid > 0 ? await Campaign.findById(campaign._id) : updated;
  return { credited: true, campaign: current, amount, fee, net, backPay };
}

// On cancellation: stop new rewards and refund what was never promised to creators,
// including the platform fee on that unused part. Money creators already earned stays
// in escrow for them to withdraw.
async function refundUnusedReferralBudget(campaignId) {
  const alreadyRefunded = await Transaction.findOne({
    campaignId,
    type: "refund",
    bucket: "referral",
  });
  if (alreadyRefunded) return 0;

  // Atomically claim the remaining pool so concurrent cancels or rewards cannot race it
  const campaign = await Campaign.findOneAndUpdate(
    { _id: campaignId, "referral.poolRemaining": { $gt: 0 } },
    { $set: { "referral.poolRemaining": 0 } },
    { new: false }
  ).select("platformFeePercent referral");

  if (!campaign || !campaign.referral || !(campaign.referral.poolRemaining > 0)) return 0;

  const remaining = campaign.referral.poolRemaining;
  const feePercent = Number.isFinite(campaign.platformFeePercent) ? campaign.platformFeePercent : 30;
  const unused = feePercent < 100 ? roundMoney((remaining * 100) / (100 - feePercent)) : 0;
  if (unused <= 0) return 0;

  const refund = await refundCampaignBucket({
    campaignId,
    bucket: "referral",
    amount: unused,
    note: `Unused referral budget from cancelled campaign ${campaignId}`,
  });
  return refund ? unused : 0;
}

// Held rewards grouped by the Lagos day they unlock: [{ date (the latest unlock that day), amount }].
function unlocksByDay(held) {
  const days = new Map();
  for (const { at, amount } of held) {
    const day = new Date(new Date(at).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
    const entry = days.get(day) || { date: new Date(at), kobo: 0 };
    if (new Date(at) > entry.date) entry.date = new Date(at);
    entry.kobo += Math.round(amount * 100);
    days.set(day, entry);
  }
  return [...days.values()].sort((a, b) => a.date - b.date).map((d) => ({ date: d.date, amount: d.kobo / 100 }));
}

function payoutStatusOf(event, now = new Date()) {
  if (event.voidedAt) return "voided";
  if (!(event.rewardAmount > 0)) return "unpaid";
  return event.availableAt && new Date(event.availableAt) > now ? "pending" : "available";
}

// A creator's referral earnings per campaign: what they earned, what is still held,
// what they can withdraw now.
async function creatorReferralEarnings(creatorId, { campaignIds = null, now = new Date() } = {}) {
  const creator = toObjectId(creatorId);
  const eventMatch = { creatorId: creator, rewardAmount: { $gt: 0 }, voidedAt: null };
  // Referral withdrawals and the referral part of weekly campaign withdrawals.
  const withdrawalMatch = {
    creatorId: creator,
    $or: [{ kind: "referral" }, { kind: "campaign", referralAmount: { $gt: 0 } }],
    status: { $in: ["pending", "processing", "released"] },
  };
  if (campaignIds) {
    const ids = campaignIds.map(toObjectId);
    eventMatch.campaignId = { $in: ids };
    withdrawalMatch.campaignId = { $in: ids };
  }

  const [groups, withdrawals] = await Promise.all([
    ConversionEvent.aggregate(conversionEarningsPipeline(eventMatch, now)),
    Withdrawal.aggregate([
      { $match: withdrawalMatch },
      {
        $group: {
          _id: "$campaignId",
          withdrawn: { $sum: { $cond: [{ $eq: ["$kind", "campaign"] }, { $ifNull: ["$referralAmount", 0] }, "$amount"] } },
        },
      },
    ]),
  ]);

  return referralEarningsFrom({ groups, withdrawnByCampaign: new Map(withdrawals.map((w) => [String(w._id), w.withdrawn])) });
}

// Paid conversions per campaign for one creator, with what's still held at `now`.
function conversionEarningsPipeline(eventMatch, now) {
  return [
    { $match: eventMatch },
    {
      $group: {
        _id: "$campaignId",
        paidConversions: { $sum: 1 },
        earned: { $sum: "$rewardAmount" },
        pending: { $sum: { $cond: [{ $gt: ["$availableAt", now] }, "$rewardAmount", 0] } },
        // When the next held reward becomes available ($min skips the nulls).
        nextAvailableAt: { $min: { $cond: [{ $gt: ["$availableAt", now] }, "$availableAt", null] } },
        held: { $push: { $cond: [{ $gt: ["$availableAt", now] }, { at: "$availableAt", amount: "$rewardAmount" }, "$$REMOVE"] } },
      },
    },
  ];
}

// Every paid conversion group for a creator (the aggregation creatorReferralEarnings runs).
function creatorConversionGroups(creatorId, now = new Date()) {
  return ConversionEvent.aggregate(conversionEarningsPipeline({ creatorId: toObjectId(creatorId), rewardAmount: { $gt: 0 }, voidedAt: null }, now));
}

// The same result as creatorReferralEarnings, from the conversion groups and the referral part of
// requested or paid withdrawals per campaign.
function referralEarningsFrom({ groups, withdrawnByCampaign: rawWithdrawn }) {
  const withdrawnByCampaign = new Map([...rawWithdrawn].map(([key, withdrawn]) => [key, roundMoney(withdrawn)]));
  const byCampaign = new Map();
  for (const group of groups) {
    const key = String(group._id);
    const earned = roundMoney(group.earned);
    const pending = roundMoney(group.pending);
    const available = roundMoney(earned - pending);
    const withdrawn = withdrawnByCampaign.get(key) || 0;
    byCampaign.set(key, {
      campaignId: group._id,
      paidConversions: group.paidConversions,
      earned,
      pending,
      available,
      withdrawn,
      availableToWithdraw: Math.max(roundMoney(available - withdrawn), 0),
      nextAvailableAt: group.nextAvailableAt || null,
      unlocks: unlocksByDay(group.held || []),
    });
  }
  for (const [key, withdrawn] of withdrawnByCampaign) {
    if (!byCampaign.has(key)) {
      byCampaign.set(key, { campaignId: key, paidConversions: 0, earned: 0, pending: 0, available: 0, withdrawn, availableToWithdraw: 0 });
    }
  }
  return byCampaign;
}

// Voids a conversion during its hold: the reward goes back to the campaign's pool and
// the conversion stops counting. Once earnings are available they may already have
// been withdrawn, so they can't be voided.
async function voidConversion(eventId, { reason, voidedBy, now = new Date() }) {
  const event = await ConversionEvent.findById(eventId);
  if (!event) return { ok: false, status: 404, error: "Conversion not found" };
  if (event.voidedAt) return { ok: false, status: 409, error: "This conversion is already voided" };
  if (event.rewardAmount > 0 && event.availableAt && event.availableAt <= now) {
    return { ok: false, status: 409, error: "The hold has ended and the creator can already withdraw these earnings, so it can't be voided" };
  }

  const previous = await ConversionEvent.findOneAndUpdate(
    {
      _id: event._id,
      voidedAt: null,
      $or: [{ rewardAmount: { $not: { $gt: 0 } } }, { availableAt: { $gt: now } }],
    },
    { $set: { voidedAt: now, voidedReason: reason, voidedBy } },
    { new: false }
  );
  if (!previous) return { ok: false, status: 409, error: "This conversion changed while you were voiding it. Refresh and try again." };

  const campaign = await Campaign.findById(previous.campaignId).select("name referral businessId");
  const counted =
    typeof previous.counted === "boolean"
      ? previous.counted
      : Boolean(campaign && campaign.referral && campaignEventTypes(campaign).includes(previous.eventType));
  const updates = [];
  if (previous.rewardAmount > 0) {
    updates.push(
      Campaign.updateOne(
        { _id: previous.campaignId },
        { $inc: { "referral.poolRemaining": previous.rewardAmount, "referral.earned": -previous.rewardAmount } }
      )
    );
  }
  if (counted) {
    updates.push(ReferralCode.updateOne({ _id: previous.referralCodeId, conversions: { $gt: 0 } }, { $inc: { conversions: -1 } }));
    updates.push(Campaign.updateOne({ _id: previous.campaignId, "referral.conversions": { $gt: 0 } }, { $inc: { "referral.conversions": -1 } }));
  }
  await Promise.all(updates);

  return { ok: true, event: previous, campaign, refundedToPool: previous.rewardAmount > 0 ? previous.rewardAmount : 0 };
}

// Counted conversions that earned nothing are paid, oldest first, while the referral pool lasts:
// sign-ups recorded before admin set a reward once it's set, and (with `reasons` including
// budget_exhausted) sign-ups recorded after the budget ran out once the brand tops up. Each gets a
// fresh hold from now, so it can still be voided.
//
// Crash safety, per conversion: (1) claim it (payingClaim with an attempt id and the reward), leaving
// unpaidReason as it is; (2) reserve the reward from the pool together with a
// referral.payingConversions entry for that conversion, so a retry finds the reservation instead of
// reserving again; (3) record the reward and clear the claim, only if the claim is still this
// attempt's; (4) drop the entry. A run that dies leaves a claim; after PAYING_CLAIM_STALE_MS another
// run takes it over and reuses any reservation. A run whose claim was taken over gives back a
// reservation it made itself. A fresh claim on the oldest waiting conversion stops other runs, so
// conversions are always paid strictly oldest first.
// Returns { paid, unpaid, byCreator: Map(creatorId -> { count, amount }) }.
async function payUnpaidConversions(campaignId, now = new Date(), { reasons = ["rate_not_set"] } = {}) {
  const byCreator = new Map();
  const campaign = await Campaign.findById(campaignId).select("name businessId referral");
  if (!campaign || !(campaign.referral && campaign.referral.rewardPerConversion > 0)) return { paid: 0, unpaid: 0, byCreator };
  const waiting = waitingForPay(campaign._id, reasons);
  const unpaidCount = () => ConversionEvent.countDocuments(waiting);

  // Entries left by a run that recorded the reward but died before dropping them.
  const entries = (campaign.referral.payingConversions || []).map((e) => e.conversionId);
  if (entries.length) {
    const done = await ConversionEvent.distinct("_id", { _id: { $in: entries }, rewardAmount: { $gt: 0 }, payingClaim: null });
    if (done.length) await Campaign.updateOne({ _id: campaign._id }, { $pull: { "referral.payingConversions": { conversionId: { $in: done } } } });
  }

  let paid = 0;
  for (;;) {
    const next = await ConversionEvent.findOne(waiting).sort({ occurredAt: 1, createdAt: 1, _id: 1 }).select("_id payingClaim").lean();
    if (!next) return { paid, unpaid: 0, byCreator };
    const previous = next.payingClaim && next.payingClaim.attemptId ? next.payingClaim : null;
    if (previous && now.getTime() - new Date(previous.at).getTime() < PAYING_CLAIM_STALE_MS) {
      // Another run is paying the oldest; it carries on in order.
      return { paid, unpaid: await unpaidCount(), byCreator };
    }

    const attemptId = new mongoose.Types.ObjectId();
    const amount = previous && previous.amount > 0 ? previous.amount : roundMoney(campaign.referral.rewardPerConversion);
    const claimed = await ConversionEvent.findOneAndUpdate(
      { ...waiting, _id: next._id, ...(previous ? { "payingClaim.attemptId": previous.attemptId } : { payingClaim: null }) },
      { $set: { payingClaim: { attemptId, at: now, amount } } },
      { new: true }
    ).lean();
    if (!claimed) continue;
    if (backPayHooks.afterClaim) await backPayHooks.afterClaim({ conversionId: claimed._id });

    const reserved = await Campaign.findOneAndUpdate(
      { _id: campaign._id, "referral.poolRemaining": { $gte: amount }, "referral.payingConversions.conversionId": { $ne: claimed._id } },
      {
        $inc: { "referral.poolRemaining": -amount, "referral.earned": amount },
        $push: { "referral.payingConversions": { conversionId: claimed._id, attemptId } },
      },
      { projection: { _id: 1 } }
    );
    if (!reserved && !(await Campaign.exists({ _id: campaign._id, "referral.payingConversions.conversionId": claimed._id }))) {
      // The pool can't cover it: let go of the claim; it and everything newer keep waiting.
      await ConversionEvent.updateOne({ _id: claimed._id, "payingClaim.attemptId": attemptId }, { $set: { payingClaim: null, unpaidReason: "budget_exhausted" } });
      await ConversionEvent.updateMany({ ...waiting, payingClaim: null }, { $set: { unpaidReason: "budget_exhausted" } });
      await noteBudgetExhausted(campaign, now);
      return { paid, unpaid: await ConversionEvent.countDocuments(waitingForPay(campaign._id)), byCreator };
    }
    if (backPayHooks.afterReserve) await backPayHooks.afterReserve({ conversionId: claimed._id });

    const recorded = await ConversionEvent.findOneAndUpdate(
      { _id: claimed._id, "payingClaim.attemptId": attemptId },
      { $set: { rewardAmount: amount, availableAt: new Date(now.getTime() + REFERRAL_HOLD_MS), unpaidReason: null, payingClaim: null } }
    );
    if (!recorded) {
      // Another run took the claim over; give back a reservation this attempt made (if it's still there).
      await Campaign.updateOne(
        { _id: campaign._id, "referral.payingConversions": { $elemMatch: { conversionId: claimed._id, attemptId } } },
        {
          $pull: { "referral.payingConversions": { conversionId: claimed._id, attemptId } },
          $inc: { "referral.poolRemaining": amount, "referral.earned": -amount },
        }
      );
      continue;
    }
    await Campaign.updateOne({ _id: campaign._id }, { $pull: { "referral.payingConversions": { conversionId: claimed._id } } });

    paid += 1;
    const key = String(claimed.creatorId);
    const entry = byCreator.get(key) || { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = roundMoney(entry.amount + amount);
    byCreator.set(key, entry);
  }
}

// Pays waiting conversions and tells each creator paid. Never throws: whatever triggered it (a
// credited top-up, a recorded conversion) has already happened; a later run finishes the rest.
async function payWaitingConversions(campaignId, { now = new Date(), cause }) {
  try {
    const result = await payUnpaidConversions(campaignId, now, { reasons: PAYABLE_LATER_REASONS });
    if (result.paid > 0) {
      const campaign = await Campaign.findById(campaignId).select("name").lean();
      const name = campaign ? campaign.name : "a campaign";
      await Notification.insertMany(
        [...result.byCreator.entries()].map(([creatorId, { count, amount }]) => ({
          creatorId,
          campaignId,
          type: "referral_backpay",
          title: "Earlier sign-ups paid",
          body: `${cause === "topup" ? `The brand added budget to "${name}", so ` : `On "${name}", `}${count} earlier sign-up${count === 1 ? "" : "s"} with your code now earn ₦${amount.toLocaleString()}. It's on hold for 7 days.`,
        }))
      );
    }
    return result;
  } catch (error) {
    console.error(`[Referral] Paying waiting conversions on ${campaignId} failed:`, error.message);
    return { paid: 0, unpaid: 0, byCreator: new Map(), error };
  }
}

// Scheduled recovery (run by the 15-minute ops alerts job): back-pay a crash left stranded or that no
// new top-up or sign-up triggered. Retries every campaign with conversions waiting for pay whose
// reward is set and whose pool can cover one, or that has a claim older than PAYING_CLAIM_STALE_MS.
// Uses the same claim / reserve path, so it never pays twice. Returns { campaigns, paid }.
async function retryStrandedBackPay(now = new Date()) {
  const campaignIds = await ConversionEvent.distinct("campaignId", {
    counted: true,
    voidedAt: null,
    unpaidReason: { $in: PAYABLE_LATER_REASONS },
    rewardAmount: { $not: { $gt: 0 } },
  });
  if (campaignIds.length === 0) return { campaigns: 0, paid: 0 };
  const staleBefore = new Date(now.getTime() - PAYING_CLAIM_STALE_MS);
  const [campaigns, withStaleClaims] = await Promise.all([
    Campaign.find({ _id: { $in: campaignIds }, "referral.rewardPerConversion": { $gt: 0 } }).select("referral.rewardPerConversion referral.poolRemaining").lean(),
    ConversionEvent.distinct("campaignId", { campaignId: { $in: campaignIds }, "payingClaim.at": { $lte: staleBefore } }),
  ]);
  const stale = new Set(withStaleClaims.map(String));
  let paid = 0;
  let retried = 0;
  for (const campaign of campaigns) {
    const coverable = (campaign.referral.poolRemaining || 0) >= campaign.referral.rewardPerConversion;
    if (!coverable && !stale.has(String(campaign._id))) continue;
    retried += 1;
    paid += (await payQueuedConversions(campaign._id, now)).paid;
  }
  return { campaigns: retried, paid };
}

// After a referral top-up: pays sign-ups the empty budget left unpaid (only once a reward is set).
const payConversionsAfterTopup = (campaignId, now = new Date()) => payWaitingConversions(campaignId, { now, cause: "topup" });
// After a conversion queued behind older unpaid ones is recorded.
const payQueuedConversions = (campaignId, now = new Date()) => payWaitingConversions(campaignId, { now, cause: "queued" });

module.exports = {
  backPayHooks,
  payQueuedConversions,
  retryStrandedBackPay,
  payUnpaidConversions,
  REFERRAL_HOLD_MS,
  MIN_REFERRAL_TOPUP,
  MAX_REFERRAL_TOPUP,
  MAX_REWARD_PER_CONVERSION,
  roundMoney,
  reserveConversionReward,
  creditReferralTopup,
  refundUnusedReferralBudget,
  creatorReferralEarnings,
  creatorConversionGroups,
  referralEarningsFrom,
  payoutStatusOf,
  voidConversion,
};
