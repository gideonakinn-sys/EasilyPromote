const CreatorProfile = require("../models/CreatorProfile");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");

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

// Architecture PRD §H. brandRatings has no data source yet — its weight is
// redistributed across the available factors until ratings exist.
const WEIGHTS = {
  completion: 0.25,
  brandRatings: 0.2,
  compliance: 0.2,
  accuracy: 0.15,
  consistency: 0.1,
  quality: 0.05,
};

const DELIVERED_STATUSES = ["posted", "verifying"];
const CLEAN_SUBMISSION_STATUSES = ["approved", "awaiting_post", "posted", "verifying"];
const COMPLETED_SLOT_STATUSES = ["approved", "paid"];

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

function computeCompletion(slots, now) {
  let completed = 0;
  let abandoned = 0;
  for (const slot of slots) {
    if (COMPLETED_SLOT_STATUSES.includes(slot.status)) {
      completed += 1;
    } else if (
      slot.status === "claimed" &&
      slot.claimedAt &&
      now - slot.claimedAt.getTime() > STALE_CLAIM_MS
    ) {
      abandoned += 1;
    }
  }
  const sample = completed + abandoned;
  return { value: ratio(completed, sample), sample };
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

async function computeCreatorStanding(userId, now = Date.now()) {
  const [slots, submissions] = await Promise.all([
    Slot.find({ creatorId: userId }),
    Submission.find({ creatorId: userId }),
  ]);

  const slotsByCampaign = new Map();
  for (const slot of slots) {
    slotsByCampaign.set(String(slot.campaignId), slot);
  }

  const factors = {
    completion: computeCompletion(slots, now),
    brandRatings: { value: null, sample: 0 },
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
    factors,
  };
}

async function recalculateCreator(profile, now = Date.now()) {
  const standing = await computeCreatorStanding(profile.userId, now);
  const previousRank = profile.rank;

  profile.creatorScore = standing.creatorScore;
  profile.verifiedViews = standing.verifiedViews;
  profile.completionRate = standing.completionRate;
  profile.scoreBreakdown = standing.factors;
  profile.markModified("scoreBreakdown");
  profile.standingUpdatedAt = new Date(now);

  // An admin who sets a rank by hand owns it until they clear the override.
  if (!profile.rankOverride) {
    profile.rank = standing.rank;
  }

  await profile.save();

  return {
    userId: String(profile.userId),
    previousRank,
    rank: profile.rank,
    creatorScore: profile.creatorScore,
    verifiedViews: profile.verifiedViews,
    rankOverride: Boolean(profile.rankOverride),
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
    errors: [],
  };

  for (const profile of profiles) {
    try {
      const result = await recalculateCreator(profile, now);
      summary.updated += 1;
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
    `[Rank] Recalculated ${summary.updated}/${summary.profiles} profiles | promoted=${summary.promoted} demoted=${summary.demoted} overrides=${summary.rankOverrides} errors=${summary.errors.length}`
  );
  return summary;
}

module.exports = {
  RANK_ORDER,
  RANK_BANDS,
  WEIGHTS,
  rankForViews,
  rankAtLeast,
  computeCreatorStanding,
  recalculateCreator,
  recalculateAllCreators,
};
