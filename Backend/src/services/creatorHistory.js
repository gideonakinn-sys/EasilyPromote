// A creator's own campaign record, as Recommended for You v2 reads it (M8, SPEC D26): the campaigns
// they finished (what each was: objective, category, platforms, pay shape) and, per objective, how
// many they finished or abandoned and the verified results on the finished ones. Finished and
// abandoned are exactly what completion rate counts (services/creatorScore.js). Only ever loaded for
// the creator themself; nothing here is shown to anyone else.
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const { completionSets, PAID_CONVERSION, DELIVERED_STATUSES } = require("./creatorScore");
const { campaignTerms } = require("../utils/campaignPay");
const { campaignShape } = require("./recommendations");

const HISTORY_CAMPAIGN_FIELDS =
  "category platforms audienceTargeting.platforms campaignObjective campaignModel payShape creatorAccess objective referral.eventType referral.eventTypes";

// Pure. `slots` and `submissions` are the creator's; `conversions` is Map<campaignId, paid conversions>;
// `campaigns` is Map<campaignId, campaign> with HISTORY_CAMPAIGN_FIELDS.
function summarizeHistory({ slots, submissions, conversions, campaigns, now = Date.now() }) {
  const { finished, abandoned } = completionSets(slots, now, submissions, [...conversions.keys()]);
  const views = new Map();
  for (const submission of submissions) {
    if (!DELIVERED_STATUSES.includes(submission.status)) continue;
    const key = String(submission.campaignId);
    views.set(key, (views.get(key) || 0) + (submission.viewsDelivered || 0));
  }

  const history = { finished: [], byObjective: {} };
  const recordFor = (objective) => {
    if (!history.byObjective[objective]) history.byObjective[objective] = { finished: 0, abandoned: 0, views: 0, conversions: 0 };
    return history.byObjective[objective];
  };
  for (const id of finished) {
    const campaign = campaigns.get(id);
    if (!campaign) continue;
    const shape = campaignShape(campaign, campaignTerms(campaign));
    history.finished.push(shape);
    const record = recordFor(shape.objective);
    record.finished += 1;
    record.views += views.get(id) || 0;
    record.conversions += conversions.get(id) || 0;
  }
  for (const id of abandoned) {
    const campaign = campaigns.get(id);
    if (!campaign) continue;
    recordFor(campaignTerms(campaign).objective).abandoned += 1;
  }
  return history;
}

// Loads and summarises the record of `creatorId`. `slots` are the creator's placements, already loaded
// by the caller. Three small queries, bounded by the creator's own work.
async function loadCreatorHistory(creatorId, slots, now = Date.now()) {
  const [submissions, conversionRows] = await Promise.all([
    Submission.find({ creatorId }).select("campaignId slotId status viewsDelivered").lean(),
    ConversionEvent.aggregate([
      { $match: { creatorId, ...PAID_CONVERSION } },
      { $group: { _id: "$campaignId", count: { $sum: 1 } } },
    ]),
  ]);
  const conversions = new Map(conversionRows.filter((r) => r._id).map((r) => [String(r._id), r.count]));
  const ids = new Set([...slots.map((s) => String(s.campaignId)), ...submissions.map((s) => String(s.campaignId)), ...conversions.keys()]);
  if (ids.size === 0) return summarizeHistory({ slots, submissions, conversions, campaigns: new Map(), now });
  const rows = await Campaign.find({ _id: { $in: [...ids] } }).select(HISTORY_CAMPAIGN_FIELDS).lean();
  const campaigns = new Map(rows.map((c) => [String(c._id), c]));
  return summarizeHistory({ slots, submissions, conversions, campaigns, now });
}

// What the record reads from a campaign (objective, category, platforms, pay shape) is fixed once the
// campaign is paid for, so it's kept per API instance: CAMPAIGN_CACHE_SIZE campaigns, least recently
// loaded dropped first, each at most CAMPAIGN_MAX_AGE_MS old.
const CAMPAIGN_CACHE_SIZE = 20000;
const CAMPAIGN_MAX_AGE_MS = 10 * 60 * 1000;
let campaignCache = new Map();

async function historyCampaigns(ids, now) {
  const campaigns = new Map();
  const missing = [];
  for (const id of ids) {
    const cached = campaignCache.get(id);
    if (cached && now - cached.loadedAt < CAMPAIGN_MAX_AGE_MS) campaigns.set(id, cached.campaign);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const rows = await Campaign.find({ _id: { $in: missing } }).select(HISTORY_CAMPAIGN_FIELDS).lean();
    for (const campaign of rows) {
      const id = String(campaign._id);
      campaigns.set(id, campaign);
      campaignCache.delete(id);
      campaignCache.set(id, { campaign, loadedAt: now });
    }
    while (campaignCache.size > CAMPAIGN_CACHE_SIZE) campaignCache.delete(campaignCache.keys().next().value);
  }
  return campaigns;
}

function resetHistoryCache() {
  campaignCache = new Map();
}

// The creator's placements, submissions and paid conversions per campaign, as $unionWith sources for
// loadCreatorAccounts, so the paged marketplace (M8) reads them in the same round trip as the profile.
function creatorRecordUnions(creatorId) {
  return {
    recordSlots: { coll: Slot.collection.name, pipeline: [{ $match: { creatorId } }, { $project: { _id: 0, campaignId: 1, status: 1, claimedAt: 1 } }] },
    recordSubmissions: {
      coll: Submission.collection.name,
      pipeline: [{ $match: { creatorId } }, { $project: { _id: 0, campaignId: 1, slotId: 1, status: 1, viewsDelivered: 1 } }],
    },
    recordConversions: {
      coll: ConversionEvent.collection.name,
      pipeline: [
        { $match: { creatorId, ...PAID_CONVERSION } },
        { $group: { _id: "$campaignId", count: { $sum: 1 } } },
        { $project: { _id: 0, campaignId: "$_id", count: 1 } },
      ],
    },
  };
}

// { slots, history } from creatorRecordUnions' rows, with the campaigns they're on (mostly from the cache).
async function creatorRecordFrom(extra, now = Date.now()) {
  const slots = (extra.recordSlots || []).filter((row) => row.campaignId);
  const submissions = (extra.recordSubmissions || []).filter((row) => row.campaignId);
  const conversions = new Map((extra.recordConversions || []).filter((row) => row.campaignId).map((row) => [String(row.campaignId), row.count]));
  const ids = new Set([...slots.map((s) => String(s.campaignId)), ...submissions.map((s) => String(s.campaignId)), ...conversions.keys()]);
  const campaigns = ids.size > 0 ? await historyCampaigns([...ids], now) : new Map();
  return { slots, history: summarizeHistory({ slots, submissions, conversions, campaigns, now }) };
}

module.exports = { summarizeHistory, loadCreatorHistory, creatorRecordUnions, creatorRecordFrom, resetHistoryCache };
