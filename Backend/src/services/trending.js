// Trending on the creator marketplace (ticket 11): the open campaigns the most creators joined or
// applied to in the last 72 hours. A creator who both applied and was then given a place counts once.
// Only campaigns the creator sees in the marketplace and could join or apply to are candidates
// (the marketplace passes those in); Recommended for You keeps its own cards, so Trending never
// repeats one.
const CampaignApplication = require("../models/CampaignApplication");
const Slot = require("../models/Slot");

const TRENDING_WINDOW_MS = 72 * 60 * 60 * 1000;
const TRENDING_LIMIT = 6;
// One creator joining isn't a trend.
const TRENDING_MIN_CREATORS = 2;

// Map of campaignId string → how many different creators joined or applied since `now - 72h`.
// Served by Slot { claimedAt, campaignId, creatorId } (partial, claimed only) and
// CampaignApplication { appliedAt, campaign, creator }; both halves are covered by their index.
async function recentInterest(campaignIds, now = new Date()) {
  const counts = new Map();
  if (!campaignIds || campaignIds.length === 0) return counts;
  const since = new Date(now.getTime() - TRENDING_WINDOW_MS);
  const rows = await Slot.aggregate([
    { $match: { claimedAt: { $type: "date", $gte: since }, campaignId: { $in: campaignIds } } },
    { $project: { _id: 0, campaignId: 1, creatorId: 1 } },
    {
      $unionWith: {
        coll: CampaignApplication.collection.name,
        pipeline: [
          { $match: { appliedAt: { $gte: since }, campaign: { $in: campaignIds } } },
          { $project: { _id: 0, campaignId: "$campaign", creatorId: "$creator" } },
        ],
      },
    },
    { $match: { creatorId: { $type: "objectId" } } },
    { $group: { _id: { campaignId: "$campaignId", creatorId: "$creatorId" } } },
    { $group: { _id: "$_id.campaignId", creators: { $sum: 1 } } },
  ]);
  for (const row of rows) counts.set(String(row._id), row.creators);
  return counts;
}

// Pure. The trending cards: eligible, not recommended, at least TRENDING_MIN_CREATORS recent
// creators, most first (newest campaign breaks a tie), at most TRENDING_LIMIT.
function pickTrending(cards, { limit = TRENDING_LIMIT, minCreators = TRENDING_MIN_CREATORS } = {}) {
  return cards
    .filter((c) => c.eligible && !c.recommended && (c.recentCreators || 0) >= minCreators)
    .sort((a, b) => b.recentCreators - a.recentCreators || new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, limit);
}

module.exports = { recentInterest, pickTrending, TRENDING_WINDOW_MS, TRENDING_LIMIT, TRENDING_MIN_CREATORS };
