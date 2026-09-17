// Trending on the creator marketplace (v1 ticket 11, v2 M8 SPEC D27): the open campaigns filling
// fastest and drawing the most creators lately.
//
// For each campaign, from the last 72 hours (or since launch, if it launched more recently):
//   fill share   = places taken in the window / all places (open or held)
//   fill speed   = fill share / window hours (the window is at least 24 hours, so a campaign an hour
//                  old can't look fast from a few joins), scaled so filling every place in 72 hours = 1
//   size weight  = min(1, all places / 10), so a campaign with few places can't top Trending by
//                  filling them
//   interest     = different creators who joined or applied in the window, as creators / (creators + 5)
//   trend score  = 100 × (0.6 × min(1, fill speed) × size weight + 0.4 × interest)
// A campaign trends when the viewer can join or apply to it, it isn't in their Recommended for You,
// it has at least 4 places and at least 3 different creators joined or applied in the window. At
// most 12 per marketplace tab, highest score first (newer campaign, then id, breaks a tie). A creator
// who applied and was then given a place counts once. Cards show counts only, never who.
const CampaignApplication = require("../models/CampaignApplication");
const Slot = require("../models/Slot");

const TRENDING_WINDOW_MS = 72 * 60 * 60 * 1000;
const WINDOW_HOURS = 72;
const MIN_WINDOW_HOURS = 24;
const TRENDING_LIMIT = 12;
const TRENDING_MIN_CREATORS = 3;
const TRENDING_MIN_PLACES = 4;
const SIZE_FULL_WEIGHT_PLACES = 10;
const INTEREST_HALF = 5;
const TREND_WEIGHTS = { speed: 0.6, interest: 0.4 };
const HOUR_MS = 60 * 60 * 1000;

// Map of campaignId string → { creators, fills } since `now - 72h`: different creators who joined or
// applied, and places taken (each creator holds at most one place per campaign). Served by Slot
// { claimedAt, campaignId, creatorId } (partial, claimed only) and CampaignApplication
// { appliedAt, campaign, creator }; both halves are covered by their index.
async function recentInterest(campaignIds, now = new Date()) {
  const counts = new Map();
  if (!campaignIds || campaignIds.length === 0) return counts;
  const since = new Date(now.getTime() - TRENDING_WINDOW_MS);
  const rows = await Slot.aggregate([
    { $match: { claimedAt: { $type: "date", $gte: since }, campaignId: { $in: campaignIds } } },
    { $project: { _id: 0, campaignId: 1, creatorId: 1, fill: { $literal: 1 } } },
    {
      $unionWith: {
        coll: CampaignApplication.collection.name,
        pipeline: [
          { $match: { appliedAt: { $gte: since }, campaign: { $in: campaignIds } } },
          { $project: { _id: 0, campaignId: "$campaign", creatorId: "$creator", fill: { $literal: 0 } } },
        ],
      },
    },
    { $match: { creatorId: { $type: "objectId" } } },
    { $group: { _id: { campaignId: "$campaignId", creatorId: "$creatorId" }, fill: { $max: "$fill" } } },
    { $group: { _id: "$_id.campaignId", creators: { $sum: 1 }, fills: { $sum: "$fill" } } },
  ]);
  for (const row of rows) counts.set(String(row._id), { creators: row.creators, fills: row.fills });
  return counts;
}

const toMs = (value) => (typeof value === "number" ? value : new Date(value).getTime());

// Pure. { score, fillShare, recentCreators } for one campaign. `launchedAt` (a date or ms) is when its
// places were made (it went live); `totalPlaces` counts open and held places.
function trendScore({ recentCreators = 0, recentFills = 0, totalPlaces = 0, launchedAt = null, now = Date.now() }) {
  const liveHours = launchedAt ? (toMs(now) - toMs(launchedAt)) / HOUR_MS : WINDOW_HOURS;
  const windowHours = Math.max(MIN_WINDOW_HOURS, Math.min(WINDOW_HOURS, liveHours));
  const fillShare = totalPlaces > 0 ? Math.min(1, recentFills / totalPlaces) : 0;
  const speed = Math.min(1, (fillShare / windowHours) * WINDOW_HOURS);
  const sizeWeight = Math.min(1, totalPlaces / SIZE_FULL_WEIGHT_PLACES);
  const interest = recentCreators / (recentCreators + INTEREST_HALF);
  const score = Math.round(1000 * (TREND_WEIGHTS.speed * speed * sizeWeight + TREND_WEIGHTS.interest * interest)) / 10;
  return { score, fillShare, recentCreators };
}

// Pure. Whether a card may trend at all (before the per-tab limit).
function canTrend(card, { minCreators = TRENDING_MIN_CREATORS, minPlaces = TRENDING_MIN_PLACES } = {}) {
  return Boolean(card.eligible && !card.recommended && (card.recentCreators || 0) >= minCreators && (card.totalPlaces || 0) >= minPlaces);
}

const time = (entry) => (entry.publishedAtMs !== undefined ? entry.publishedAtMs : entry.publishedAt ? new Date(entry.publishedAt).getTime() : 0);

// Highest trend score first, then the newer campaign, then the higher id.
function sortTrending(a, b) {
  if ((b.trendScore || 0) !== (a.trendScore || 0)) return (b.trendScore || 0) - (a.trendScore || 0);
  if (time(b) !== time(a)) return time(b) - time(a);
  return String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0;
}

// Pure. The trending cards among `cards` (each with eligible, recommended, recentCreators,
// totalPlaces, trendScore, publishedAt, id), best first, at most `limit`.
function pickTrending(cards, { limit = TRENDING_LIMIT, minCreators, minPlaces } = {}) {
  return cards.filter((c) => canTrend(c, { minCreators, minPlaces })).sort(sortTrending).slice(0, limit);
}

module.exports = {
  recentInterest,
  trendScore,
  canTrend,
  sortTrending,
  pickTrending,
  TRENDING_WINDOW_MS,
  TRENDING_LIMIT,
  TRENDING_MIN_CREATORS,
  TRENDING_MIN_PLACES,
  TREND_WEIGHTS,
};
