const mongoose = require("mongoose");
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

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

// Reserves the campaign's per-conversion reward for one counted conversion. The pool
// is decremented with a conditional update, so two conversions racing for the last of
// the budget can never both be paid.
async function reserveConversionReward(campaign, counted, now = new Date()) {
  if (!counted) return { rewardAmount: 0, unpaidReason: "not_counted", availableAt: null };

  const rate = roundMoney(campaign.referral && campaign.referral.rewardPerConversion);
  if (!(rate > 0)) return { rewardAmount: 0, unpaidReason: "rate_not_set", availableAt: null };

  const reserved = await Campaign.findOneAndUpdate(
    { _id: campaign._id, "referral.poolRemaining": { $gte: rate } },
    { $inc: { "referral.poolRemaining": -rate, "referral.earned": rate } },
    { new: true, projection: { _id: 1 } }
  );
  if (reserved) {
    return { rewardAmount: rate, unpaidReason: null, availableAt: new Date(now.getTime() + REFERRAL_HOLD_MS) };
  }

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
  return { rewardAmount: 0, unpaidReason: "budget_exhausted", availableAt: null };
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

  const existing = await Transaction.findOneAndUpdate(
    { reference, type: "topup", bucket: "referral" },
    {
      $setOnInsert: {
        campaignId: campaign._id,
        type: "topup",
        bucket: "referral",
        amount,
        status: "escrow_deposit",
        reference,
        date: new Date(),
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true }
  );
  if (existing) return { credited: false, alreadyCredited: true, campaign };

  const feePercent = Number.isFinite(campaign.platformFeePercent) ? campaign.platformFeePercent : 30;
  const fee = roundMoney((amount * feePercent) / 100);
  const net = roundMoney(amount - fee);

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
  return { credited: true, campaign: updated, amount, fee, net };
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

  const { refundCampaignBucket } = require("./refunds");
  const refund = await refundCampaignBucket({
    campaignId,
    bucket: "referral",
    amount: unused,
    note: `Unused referral budget from cancelled campaign ${campaignId}`,
  });
  return refund ? unused : 0;
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
    ConversionEvent.aggregate([
      { $match: eventMatch },
      {
        $group: {
          _id: "$campaignId",
          paidConversions: { $sum: 1 },
          earned: { $sum: "$rewardAmount" },
          pending: { $sum: { $cond: [{ $gt: ["$availableAt", now] }, "$rewardAmount", 0] } },
        },
      },
    ]),
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

  const withdrawnByCampaign = new Map(withdrawals.map((w) => [String(w._id), roundMoney(w.withdrawn)]));
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

// Sign-ups recorded before admin set a reward are paid once it's set, oldest first, while
// the referral pool lasts. Each gets a fresh hold from now, so it can still be voided.
async function payUnpaidConversions(campaignId, now = new Date()) {
  const campaign = await Campaign.findById(campaignId).select("name businessId referral");
  if (!campaign || !(campaign.referral && campaign.referral.rewardPerConversion > 0)) return { paid: 0, unpaid: 0 };

  const events = await ConversionEvent.find({
    campaignId: campaign._id,
    counted: true,
    voidedAt: null,
    unpaidReason: "rate_not_set",
  })
    .sort({ occurredAt: 1, createdAt: 1 })
    .select("_id");

  let paid = 0;
  for (let i = 0; i < events.length; i += 1) {
    // Claim the event first so two admins setting the reward can't both pay it.
    const claimed = await ConversionEvent.findOneAndUpdate(
      { _id: events[i]._id, unpaidReason: "rate_not_set", voidedAt: null },
      { $set: { unpaidReason: null } }
    );
    if (!claimed) continue;

    const reward = await reserveConversionReward(campaign, true, now);
    if (!(reward.rewardAmount > 0)) {
      const rest = events.slice(i).map((event) => event._id);
      await ConversionEvent.updateMany({ _id: { $in: rest } }, { $set: { unpaidReason: "budget_exhausted" } });
      return { paid, unpaid: rest.length };
    }
    await ConversionEvent.updateOne(
      { _id: events[i]._id },
      { $set: { rewardAmount: reward.rewardAmount, availableAt: reward.availableAt } }
    );
    paid += 1;
  }
  return { paid, unpaid: 0 };
}

module.exports = {
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
  payoutStatusOf,
  voidConversion,
};
