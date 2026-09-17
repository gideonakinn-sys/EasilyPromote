// Loads what utils/reconciliation.js needs for one campaign, or for every campaign. Read-only.
const { toObjectId } = require("../utils/objectId");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const { reconcileCampaign } = require("../utils/reconciliation");

function groupBy(rows, field = "campaignId") {
  const map = new Map();
  for (const row of rows) {
    const key = String(row[field]);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function loadBatch(campaignIds) {
  const [campaigns, transactions, submissions, slots, conversionEvents] = await Promise.all([
    Campaign.find({ _id: { $in: campaignIds } }).lean(),
    Transaction.find({ campaignId: { $in: campaignIds } }).lean(),
    Submission.find({ campaignId: { $in: campaignIds } }).select("campaignId creatorId status completedAt appealableUntil viewsDelivered").lean(),
    Slot.find({ campaignId: { $in: campaignIds }, creatorId: { $ne: null } }).select("campaignId creatorId kind reward viewTarget").lean(),
    ConversionEvent.find({ campaignId: { $in: campaignIds }, rewardAmount: { $gt: 0 } }).select("campaignId creatorId rewardAmount voidedAt").lean(),
  ]);
  const rows = groupBy(transactions);
  const subs = groupBy(submissions);
  const places = groupBy(slots);
  const events = groupBy(conversionEvents);
  return campaigns.map((campaign) => {
    const key = String(campaign._id);
    return {
      campaign,
      transactions: rows.get(key) || [],
      submissions: subs.get(key) || [],
      slots: places.get(key) || [],
      conversionEvents: events.get(key) || [],
    };
  });
}

async function reconcileCampaignById(campaignId, now = new Date()) {
  const [input] = await loadBatch([toObjectId(campaignId)]);
  return input ? reconcileCampaign({ ...input, now }) : null;
}

// The given campaigns, a batch at a time.
async function reconcileCampaigns(campaignIds, { batchSize = 200, now = new Date() } = {}) {
  const ids = campaignIds.map(toObjectId);
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    for (const input of await loadBatch(ids.slice(i, i + batchSize))) results.push(reconcileCampaign({ ...input, now }));
  }
  return results;
}

// Every campaign that has money on record, a batch at a time.
async function reconcileAllCampaigns({ batchSize = 200, onResult = null, now = new Date() } = {}) {
  const ids = await Transaction.distinct("campaignId");
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize).map(toObjectId);
    for (const input of await loadBatch(batch)) {
      const result = reconcileCampaign({ ...input, now });
      results.push(result);
      if (onResult) onResult(result);
    }
  }
  return results;
}

module.exports = { reconcileCampaignById, reconcileCampaigns, reconcileAllCampaigns };
