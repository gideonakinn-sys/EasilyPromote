const CreatorProfile = require("../models/CreatorProfile");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const ConversionEvent = require("../models/ConversionEvent");
const { applyBadgeEvaluation, badgeMetrics } = require("./creatorBadges");

const RANK_ORDER = ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"];

// Architecture PRD §H — bands are lifetime verified views, highest first.
const RANK_BANDS = [
  { rank: "elite", minViews: 100000 },
  { rank: "rank5", minViews: 50000 },
  { rank: "rank4", minViews: 25000 },
  { rank: "rank3", minViews: 10000 },
  { rank: "rank2", minViews: 5000 },
  { rank: "rank1", minViews: 0 },
];

// Architecture PRD §H. A factor with no data (for example brandRatings before a creator has 3
// visible brand ratings, M8) has its weight redistributed across the available factors.
const WEIGHTS = {
  completion: 0.25,
  brandRatings: 0.2,
  compliance: 0.2,
  accuracy: 0.15,
  consistency: 0.1,
  quality: 0.05,
};

const DELIVERED_STATUSES = ["posted", "verifying"];
// Campaign engine: content approval (ticket 07) adds the content delivery statuses and completed.
const CLEAN_SUBMISSION_STATUSES = ["approved", "awaiting_post", "posted", "verifying", "awaiting_delivery", "awaiting_receipt", "completed"];
const COMPLETED_SLOT_STATUSES = ["approved", "paid"];
// Brand ratings count towards the score from this many visible ratings, like the public average.
const RATINGS_FACTOR_MIN = 3;
// A conversion that verifiably earned the creator something (M8 badges: verified results).
const PAID_CONVERSION = {
  isTest: { $ne: true },
  voidedAt: null,
  $or: [{ rewardAmount: { $gt: 0 } }, { bonusAmount: { $gt: 0 } }],
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_CLAIM_MS = 14 * 24 * 60 * 60 * 1000;
const CONSISTENCY_WINDOW_WEEKS = 8;
const CONSISTENCY_TARGET_WEEKS = 4;

function rankForViews(views) {
  const band = RANK_BANDS.find((b) => views >= b.minViews);
  return band ? band.rank : "rank1";
}

function rankAtLeast(creatorRank, requiredRank) {
  if (!requiredRank) return true;
  const have = RANK_ORDER.indexOf(creatorRank);
  const need = RANK_ORDER.indexOf(requiredRank);
  if (have === -1 || need === -1) return true;
  return have >= need;
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

// Campaigns the creator finished: content completed (delivery or live post confirmed), a views
// post delivering verified views, a paid conversion, or a placement marked approved / paid (M8).
function finishedCampaignIds(slots, submissions, conversionCampaignIds = []) {
  const finished = new Set(conversionCampaignIds.map(String));
  for (const slot of slots) {
    if (COMPLETED_SLOT_STATUSES.includes(slot.status)) finished.add(String(slot.campaignId));
  }
  for (const submission of submissions) {
    const viewsDelivered = !submission.slotId && DELIVERED_STATUSES.includes(submission.status) && (submission.viewsDelivered || 0) > 0;
    if (submission.status === "completed" || viewsDelivered) finished.add(String(submission.campaignId));
  }
  return finished;
}

// Finished and abandoned campaigns (sets of campaign id strings). Finished: see finishedCampaignIds.
// Abandoned: a placement claimed more than 14 days ago with nothing sent, or content voided as never
// delivered, on a campaign the creator didn't finish. Recommended for You (M8) reads the same sets.
function completionSets(slots, now, submissions = [], conversionCampaignIds = []) {
  const finished = finishedCampaignIds(slots, submissions, conversionCampaignIds);
  const abandoned = new Set();
  for (const slot of slots) {
    if (
      slot.status === "claimed" &&
      slot.claimedAt &&
      now - new Date(slot.claimedAt).getTime() > STALE_CLAIM_MS &&
      !finished.has(String(slot.campaignId))
    ) {
      abandoned.add(String(slot.campaignId));
    }
  }
  for (const submission of submissions) {
    if (submission.status === "not_delivered" && !finished.has(String(submission.campaignId))) {
      abandoned.add(String(submission.campaignId));
    }
  }
  return { finished, abandoned };
}

// Completed: every finished campaign, out of finished and abandoned ones.
function computeCompletion(slots, now, submissions = [], conversionCampaignIds = []) {
  const { finished, abandoned } = completionSets(slots, now, submissions, conversionCampaignIds);
  const sample = finished.size + abandoned.size;
  return { value: ratio(finished.size, sample), sample };
}

// Visible brand ratings as a 0–1 factor: 1 star is 0, 5 stars is 1.
function computeBrandRatings(rating) {
  const count = (rating && rating.count) || 0;
  if (count < RATINGS_FACTOR_MIN || typeof rating.average !== "number") return { value: null, sample: count };
  return { value: ratio(rating.average - 1, 4), sample: count };
}

function computeCompliance(submissions) {
  let clean = 0;
  let rejected = 0;
  for (const submission of submissions) {
    if (submission.status === "rejected") rejected += 1;
    else if (CLEAN_SUBMISSION_STATUSES.includes(submission.status)) clean += 1;
  }
  const sample = clean + rejected;
  return { value: ratio(clean, sample), sample };
}

function computeAccuracy(submissions, slotsByCampaign) {
  let delivered = 0;
  let target = 0;
  let sample = 0;
  for (const submission of submissions) {
    if (!DELIVERED_STATUSES.includes(submission.status)) continue;
    const slot = slotsByCampaign.get(String(submission.campaignId));
    if (!slot || !slot.viewTarget) continue;
    delivered += Math.min(submission.viewsDelivered || 0, slot.viewTarget);
    target += slot.viewTarget;
    sample += 1;
  }
  return { value: ratio(delivered, target), sample };
}

function computeConsistency(submissions, now) {
  if (submissions.length === 0) return { value: null, sample: 0 };
  const windowStart = now - CONSISTENCY_WINDOW_WEEKS * WEEK_MS;
  const weeks = new Set();
  for (const submission of submissions) {
    const at = submission.submittedAt ? submission.submittedAt.getTime() : null;
    if (!at || at < windowStart) continue;
    weeks.add(Math.floor((at - windowStart) / WEEK_MS));
  }
  return { value: ratio(weeks.size, CONSISTENCY_TARGET_WEEKS), sample: weeks.size };
}

function computeQuality(submissions) {
  const scored = submissions.filter(
    (s) => DELIVERED_STATUSES.includes(s.status) && typeof s.confidenceScore === "number"
  );
  const total = scored.reduce((sum, s) => sum + s.confidenceScore, 0);
  return { value: ratio(total, scored.length * 100), sample: scored.length };
}

function scoreFromFactors(factors) {
  let weighted = 0;
  let availableWeight = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const factor = factors[key];
    if (!factor || factor.value === null) continue;
    weighted += weight * factor.value;
    availableWeight += weight;
  }
  if (availableWeight === 0) return 0;
  return Math.round((weighted / availableWeight) * 100);
}

// Performance a brand sees on a creator's profile, from submissions that were posted.
function computeCampaignStats(submissions) {
  const delivered = submissions.filter((s) => DELIVERED_STATUSES.includes(s.status));
  const totalCampaignViews = delivered.reduce((sum, s) => sum + (s.viewsDelivered || 0), 0);

  let platformViews = 0;
  let interactions = 0;
  for (const s of delivered) {
    for (const p of s.postedPlatforms || []) {
      platformViews += p.views || 0;
      interactions += (p.likes || 0) + (p.comments || 0);
    }
  }

  return {
    avgViews: delivered.length ? Math.round(totalCampaignViews / delivered.length) : 0,
    engagementRate: platformViews > 0 ? Math.round((interactions / platformViews) * 1000) / 10 : null,
    pastCampaigns: new Set(delivered.map((s) => String(s.campaignId))).size,
    totalCampaignViews,
  };
}

// `rating` is the creator's visible brand rating summary (CreatorProfile.brandRating).
async function computeCreatorStanding(userId, now = Date.now(), rating = null) {
  const [slots, submissions, conversionCampaignIds, verifiedConversions] = await Promise.all([
    Slot.find({ creatorId: userId }),
    Submission.find({ creatorId: userId }),
    ConversionEvent.distinct("campaignId", { creatorId: userId, ...PAID_CONVERSION }),
    ConversionEvent.countDocuments({ creatorId: userId, ...PAID_CONVERSION }),
  ]);

  const slotsByCampaign = new Map();
  for (const slot of slots) {
    slotsByCampaign.set(String(slot.campaignId), slot);
  }

  const factors = {
    completion: computeCompletion(slots, now, submissions, conversionCampaignIds),
    brandRatings: computeBrandRatings(rating),
    compliance: computeCompliance(submissions),
    accuracy: computeAccuracy(submissions, slotsByCampaign),
    consistency: computeConsistency(submissions, now),
    quality: computeQuality(submissions),
  };

  const verifiedViews = submissions
    .filter((s) => DELIVERED_STATUSES.includes(s.status))
    .reduce((sum, s) => sum + (s.viewsDelivered || 0), 0);

  const completion = factors.completion.value;

  return {
    creatorScore: scoreFromFactors(factors),
    rank: rankForViews(verifiedViews),
    verifiedViews,
    completionRate: completion === null ? 0 : Math.round(completion * 100),
    stats: computeCampaignStats(submissions),
    finishedCampaigns: finishedCampaignIds(slots, submissions, conversionCampaignIds).size,
    verifiedConversions,
    factors,
  };
}

async function recalculateCreator(profile, now = Date.now()) {
  const standing = await computeCreatorStanding(profile.userId, now, profile.brandRating);
  const previousRank = profile.rank;

  profile.creatorScore = standing.creatorScore;
  profile.verifiedViews = standing.verifiedViews;
  profile.completionRate = standing.completionRate;
  profile.stats = { ...standing.stats, updatedAt: new Date(now) };
  profile.scoreBreakdown = standing.factors;
  profile.markModified("scoreBreakdown");
  profile.standingUpdatedAt = new Date(now);

  // An admin who sets a rank by hand owns it until they clear the override.
  if (!profile.rankOverride) {
    profile.rank = standing.rank;
  }

  await profile.save();

  // Badges follow the standing just saved (M8). Stored with their own guarded write, so a badge
  // override an admin makes meanwhile isn't overwritten by this save.
  const badges = await applyBadgeEvaluation(profile._id, badgeMetrics(standing, profile.brandRating), new Date(now));

  return {
    userId: String(profile.userId),
    previousRank,
    rank: profile.rank,
    creatorScore: profile.creatorScore,
    verifiedViews: profile.verifiedViews,
    rankOverride: Boolean(profile.rankOverride),
    badgesGained: badges ? badges.gained : [],
    badgesLost: badges ? badges.lost : [],
  };
}

async function recalculateAllCreators() {
  const now = Date.now();
  const profiles = await CreatorProfile.find();
  const summary = {
    profiles: profiles.length,
    updated: 0,
    promoted: 0,
    demoted: 0,
    rankOverrides: 0,
    badgesGained: 0,
    badgesLost: 0,
    errors: [],
  };

  for (const profile of profiles) {
    try {
      const result = await recalculateCreator(profile, now);
      summary.updated += 1;
      summary.badgesGained += result.badgesGained.length;
      summary.badgesLost += result.badgesLost.length;
      if (result.rankOverride) {
        summary.rankOverrides += 1;
      } else if (result.rank !== result.previousRank) {
        const moved = RANK_ORDER.indexOf(result.rank) - RANK_ORDER.indexOf(result.previousRank);
        if (moved > 0) summary.promoted += 1;
        else summary.demoted += 1;
        console.log(
          `[Rank] ${result.userId} ${result.previousRank} → ${result.rank} | views=${result.verifiedViews} score=${result.creatorScore}`
        );
      }
    } catch (error) {
      console.error("[Rank] Failed for profile", String(profile._id), error.message);
      summary.errors.push(`${profile._id}: ${error.message}`);
    }
  }

  console.log(
    `[Rank] Recalculated ${summary.updated}/${summary.profiles} profiles | promoted=${summary.promoted} demoted=${summary.demoted} overrides=${summary.rankOverrides} badgesGained=${summary.badgesGained} badgesLost=${summary.badgesLost} errors=${summary.errors.length}`
  );
  return summary;
}

module.exports = {
  RANK_ORDER,
  RANK_BANDS,
  WEIGHTS,
  rankForViews,
  rankAtLeast,
  computeCompletion,
  completionSets,
  finishedCampaignIds,
  PAID_CONVERSION,
  DELIVERED_STATUSES,
  computeBrandRatings,
  computeCreatorStanding,
  recalculateCreator,
  recalculateAllCreators,
};
