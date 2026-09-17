const mongoose = require("mongoose");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Withdrawal = require("../models/Withdrawal");
const Transaction = require("../models/Transaction");

// Campaign statuses whose views earnings a creator can withdraw.
const WITHDRAWABLE_CAMPAIGN_STATUSES = ["live", "paused", "completed"];
// Requested or paid withdrawals are spent entitlement; rejected ones never left.
const COMMITTED_WITHDRAWAL_STATUSES = ["pending", "processing", "released"];

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

// Never round money up: rounding down by a kobo can't overpay a creator.
function floorKobo(value) {
  return Math.floor((Number(value) || 0) * 100) / 100;
}

// A slot's reward is the creator's share after the platform fee for delivering its
// view target. Earnings accrue evenly per view at reward / viewTarget and stop at the
// reward, so a creator is paid for what they deliver and never more than their slot.
function viewsEarned(slot, views) {
  const target = Number(slot && slot.viewTarget) || 0;
  const reward = Number(slot && slot.reward) || 0;
  if (target <= 0 || reward <= 0) return 0;
  const counted = Math.min(Math.max(Number(views) || 0, 0), target);
  return floorKobo((counted * reward) / target);
}

// Views earnings per campaign for one creator: views across all their submissions,
// what that earned, what they've already requested or been paid, and what's left.
// This is the single source for the withdrawal route, the wallet and sync-stats.
async function creatorViewsEarnings(creatorId, { campaignIds = null } = {}) {
  const creator = toObjectId(creatorId);
  // Deliverable placements pay a fixed rate, never per view.
  const slotFilter = { creatorId: creator, kind: { $ne: "deliverable" } };
  if (campaignIds) slotFilter.campaignId = { $in: campaignIds.map(toObjectId) };

  const slots = await Slot.find(slotFilter)
    .populate({ path: "campaignId", select: "name status businessId" })
    .sort({ claimedAt: -1, createdAt: -1 })
    .lean();

  const slotByCampaign = latestSlotPerCampaign(slots);
  const ids = [...slotByCampaign.values()].map((slot) => slot.campaignId._id);
  if (ids.length === 0) return new Map();

  const [viewGroups, withdrawalGroups] = await Promise.all([
    Submission.aggregate([
      { $match: { creatorId: creator, campaignId: { $in: ids } } },
      { $group: { _id: "$campaignId", views: { $sum: { $ifNull: ["$viewsDelivered", 0] } } } },
    ]),
    Withdrawal.aggregate([
      {
        $match: {
          creatorId: creator,
          campaignId: { $in: ids },
          kind: { $ne: "referral" },
          status: { $in: COMMITTED_WITHDRAWAL_STATUSES },
        },
      },
      {
        $group: {
          _id: "$campaignId",
          // Weekly campaign withdrawals carry views and referral parts; only the views part counts here.
          withdrawn: { $sum: { $cond: [{ $eq: ["$kind", "campaign"] }, { $ifNull: ["$viewsAmount", 0] }, "$amount"] } },
        },
      },
    ]),
  ]);
  return viewsEarningsFrom({
    slotByCampaign,
    viewsByCampaign: new Map(viewGroups.map((group) => [String(group._id), group.views])),
    withdrawnByCampaign: new Map(withdrawalGroups.map((group) => [String(group._id), group.withdrawn])),
  });
}

// One slot per campaign; if a creator somehow holds two, the most recent claim wins. `slots` are
// views placements with their campaign populated, most recent claim first.
function latestSlotPerCampaign(slots) {
  const slotByCampaign = new Map();
  for (const slot of slots) {
    if (!slot.campaignId) continue;
    const key = String(slot.campaignId._id);
    if (!slotByCampaign.has(key)) slotByCampaign.set(key, slot);
  }
  return slotByCampaign;
}

// The same result as creatorViewsEarnings, from rows already loaded: views delivered per campaign
// and views-part withdrawals (requested or paid) per campaign.
function viewsEarningsFrom({ slotByCampaign, viewsByCampaign, withdrawnByCampaign }) {
  const result = new Map();
  for (const [key, slot] of slotByCampaign) {
    const campaign = slot.campaignId;
    const views = viewsByCampaign.get(key) || 0;
    const earned = viewsEarned(slot, views);
    const withdrawn = floorKobo(withdrawnByCampaign.get(key) || 0);
    result.set(key, {
      campaignId: campaign._id,
      title: campaign.name,
      status: campaign.status,
      businessId: campaign.businessId,
      slotId: slot._id,
      views,
      viewTarget: slot.viewTarget || 0,
      reward: slot.reward || 0,
      earned,
      withdrawn,
      availableToWithdraw: Math.max(floorKobo(earned - withdrawn), 0),
      withdrawable: WITHDRAWABLE_CAMPAIGN_STATUSES.includes(campaign.status),
    });
  }
  return result;
}

// Settled views payouts from the ledger. Submissions never stored payout amounts, so
// this is the only reliable "paid" figure. Referral payouts are excluded.
async function releasedViewsTotal(match) {
  const [group] = await Transaction.aggregate([
    { $match: { ...match, type: "release", status: "released", bucket: { $nin: ["referral", "fixed"] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return group ? group.total : 0;
}

module.exports = {
  WITHDRAWABLE_CAMPAIGN_STATUSES,
  COMMITTED_WITHDRAWAL_STATUSES,
  floorKobo,
  viewsEarned,
  creatorViewsEarnings,
  latestSlotPerCampaign,
  viewsEarningsFrom,
  releasedViewsTotal,
};
