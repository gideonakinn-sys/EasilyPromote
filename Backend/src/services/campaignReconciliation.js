// Loads what utils/reconciliation.js needs for one campaign, or for every campaign. Read-only.
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const Transaction = require("../models/Transaction");
const { reconcileCampaign } = require("../utils/reconciliation");

async function referralEarnedByCampaign(campaignIds) {
  const groups = await ConversionEvent.aggregate([
    { $match: { campaignId: { $in: campaignIds }, rewardAmount: { $gt: 0 }, voidedAt: null } },
    { $group: { _id: "$campaignId", earned: { $sum: "$rewardAmount" } } },
  ]);
  return new Map(groups.map((g) => [String(g._id), g.earned]));
}

async function reconcileCampaignById(campaignId) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) return null;
  const [transactions, earned] = await Promise.all([
    Transaction.find({ campaignId: campaign._id }).lean(),
    referralEarnedByCampaign([campaign._id]),
  ]);
  return reconcileCampaign({ campaign, transactions, referralEarned: earned.get(String(campaign._id)) || 0 });
}

// Every campaign that has money on record, a batch at a time.
async function reconcileAllCampaigns({ batchSize = 200, onResult = null } = {}) {
  const ids = await Transaction.distinct("campaignId");
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize).map((id) => new mongoose.Types.ObjectId(String(id)));
    const [campaigns, transactions, earned] = await Promise.all([
      Campaign.find({ _id: { $in: batch } }).lean(),
      Transaction.find({ campaignId: { $in: batch } }).lean(),
      referralEarnedByCampaign(batch),
    ]);
    const rowsByCampaign = new Map();
    for (const row of transactions) {
      const key = String(row.campaignId);
      if (!rowsByCampaign.has(key)) rowsByCampaign.set(key, []);
      rowsByCampaign.get(key).push(row);
    }
    for (const campaign of campaigns) {
      const key = String(campaign._id);
      const result = reconcileCampaign({ campaign, transactions: rowsByCampaign.get(key) || [], referralEarned: earned.get(key) || 0 });
      results.push(result);
      if (onResult) onResult(result);
    }
  }
  return results;
}

module.exports = { reconcileCampaignById, reconcileAllCampaigns };
