// Recommended for You (v1 ticket 04, v2 M8). Pure: callers load the creator's history
// (services/creatorHistory.js) and run the join check.
//
// Which campaigns are recommended. The creator must be able to join or apply (the join check), and
// either
//   - the campaign targets an audience the creator's audience suits (Match Score 50+), or
//   - it targets no audience and shares the creator's categories or niches, or
//   - (v2) it targets no audience, and the creator has a track record on campaigns like it:
//     similarity to their finished campaigns 0.6+ and track record on its objective 0.6+.
// A targeted campaign the creator's audience doesn't suit is never recommended, whatever their
// history (audience location, not creator history, drives targeting).
//
// How they're ordered: a score from 0 to 100 (SPEC D26).
//   cold start (no finished or abandoned campaign yet):  100 × audience
//   with a history:  100 × (0.5 × audience + 0.3 × similarity + 0.2 × track) + standout (0–5)
// then the newer campaign, then the campaign id. Every part reads only the viewing creator's own
// record and the campaign; never another creator's.
const { locationShare } = require("./eligibility");

const RECOMMENDED_MIN_SCORE = 50;

const WEIGHTS = { audience: 0.5, similarity: 0.3, track: 0.2 };
// How alike two campaigns are, 0–1.
const SIMILARITY_WEIGHTS = { objective: 0.4, category: 0.25, platform: 0.2, payShape: 0.15 };
// Similarity is the mean of the best 3 matches among finished campaigns (fewer count as 0), so one
// finished campaign can't reshape a creator's recommendations.
const SIMILARITY_SAMPLE = 3;
// A creator's untargeted campaigns with no niche overlap are recommended from these.
const HISTORY_MIN_SIMILARITY = 0.6;
const HISTORY_MIN_TRACK = 0.6;
// Track record on an objective with no attempts yet.
const TRACK_NEUTRAL = 0.5;
// Verified results per finished placement that count as a full 1 for track record.
const VIEWS_BENCHMARK = 10000;
const CONVERSIONS_BENCHMARK = 20;
const STANDOUT_MAX_POINTS = 5;
const CONVERSION_OBJECTIVES = ["signups", "downloads", "leads", "sales", "other"];
const OBJECTIVE_LABELS = {
  content: "content",
  views: "views",
  signups: "sign-up",
  downloads: "download",
  leads: "lead",
  sales: "sales",
  engagement: "engagement",
  other: "referral",
};
const BADGE_NAMES = {
  top_creator: "Top Creator",
  high_performer: "High Performer",
  reliable_creator: "Reliable Creator",
  campaign_pro: "Campaign Pro",
};

const lower = (list) => (Array.isArray(list) ? list : []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
const round1 = (value) => Math.round(value * 10) / 10;
const titleCase = (value) => String(value).replace(/\b\w/g, (c) => c.toUpperCase());

// The dimensions the Match Score measures; platforms are a requirement, not audience fit.
function hasAudienceTargeting(campaign) {
  const targeting = (campaign && campaign.audienceTargeting) || {};
  return Boolean(
    (targeting.locations && targeting.locations.length) ||
      (targeting.ageRanges && targeting.ageRanges.length) ||
      (targeting.genders || []).some((g) => g !== "all")
  );
}

// The marketplace scores every live campaign for every request, and live campaigns and the request's
// profile are reused objects, so what's derived from each alone is worked out once.
const campaignFactsCache = new WeakMap();
function campaignFacts(campaign) {
  let facts = campaignFactsCache.get(campaign);
  if (!facts) {
    facts = { theirs: [...new Set([...lower([campaign.category]), ...lower(campaign.niches)])], targeted: hasAudienceTargeting(campaign), shape: null, shapeTerms: null };
    campaignFactsCache.set(campaign, facts);
  }
  return facts;
}
const profileNichesCache = new WeakMap();
function profileNiches(profile) {
  if (!profile) return new Set();
  let mine = profileNichesCache.get(profile);
  if (!mine) {
    mine = new Set([...lower(profile.niches), ...lower(profile.categories)]);
    profileNichesCache.set(profile, mine);
  }
  return mine;
}

function overlapFor(profile, campaign) {
  const mine = profileNiches(profile);
  return campaignFacts(campaign).theirs.filter((n) => mine.has(n));
}

function nicheOverlapFor(profile, campaign) {
  return overlapFor(profile, campaign).length;
}

// What a campaign is, for comparing it with the creator's finished campaigns. `objective` and
// `payShape` come from campaignTerms (utils/campaignPay.js).
function campaignShape(campaign, terms) {
  const targeting = campaign.audienceTargeting || {};
  const platforms = lower(targeting.platforms && targeting.platforms.length ? targeting.platforms : campaign.platforms);
  return {
    objective: terms.objective,
    payShape: terms.payShape,
    category: campaign.category ? String(campaign.category).trim().toLowerCase() : null,
    platforms,
  };
}

// 0–1: how alike two campaign shapes are.
function shapeSimilarity(a, b) {
  const platformMatch = a.platforms.length && b.platforms.length ? a.platforms.some((p) => b.platforms.includes(p)) : false;
  return (
    SIMILARITY_WEIGHTS.objective * (a.objective === b.objective ? 1 : 0) +
    SIMILARITY_WEIGHTS.category * (a.category && a.category === b.category ? 1 : 0) +
    SIMILARITY_WEIGHTS.platform * (platformMatch ? 1 : 0) +
    SIMILARITY_WEIGHTS.payShape * (a.payShape === b.payShape ? 1 : 0)
  );
}

// 0–1: mean of the best SIMILARITY_SAMPLE matches among the creator's finished campaigns. Kept per
// history object and campaign shape: many campaigns share a shape.
const similarityCache = new WeakMap();
const shapeKeys = new WeakMap();
function shapeKey(shape) {
  let key = shapeKeys.get(shape);
  if (key === undefined) {
    key = `${shape.objective}|${shape.payShape}|${shape.category}|${shape.platforms.join(",")}`;
    shapeKeys.set(shape, key);
  }
  return key;
}
function similarityTo(shape, history) {
  const finished = (history && history.finished) || [];
  if (finished.length === 0) return 0;
  let memo = similarityCache.get(history);
  if (!memo) {
    memo = new Map();
    similarityCache.set(history, memo);
  }
  const key = shapeKey(shape);
  let value = memo.get(key);
  if (value === undefined) {
    const best = finished.map((past) => shapeSimilarity(shape, past)).sort((x, y) => y - x).slice(0, SIMILARITY_SAMPLE);
    value = best.reduce((sum, v) => sum + v, 0) / SIMILARITY_SAMPLE;
    memo.set(key, value);
  }
  return value;
}

// { value 0–1 or null with no attempts, finished, success }: how the creator did on this objective.
// Success is smoothed ((finished + 1) / (attempts + 2)); verified results per finished placement
// count half where the objective has them (views, conversions).
function trackRecord(objective, history) {
  const record = history && history.byObjective ? history.byObjective[objective] : null;
  const attempts = record ? record.finished + record.abandoned : 0;
  if (!record || attempts === 0) return { value: null, finished: 0, success: null };
  const success = (record.finished + 1) / (attempts + 2);
  let performance = null;
  if (record.finished > 0 && objective === "views") performance = Math.min(1, record.views / record.finished / VIEWS_BENCHMARK);
  if (record.finished > 0 && CONVERSION_OBJECTIVES.includes(objective)) {
    performance = Math.min(1, record.conversions / record.finished / CONVERSIONS_BENCHMARK);
  }
  const value = performance === null ? success : 0.5 * success + 0.5 * performance;
  return { value, finished: record.finished, success };
}

// 0–STANDOUT_MAX_POINTS on campaigns where the brand picks or gates creators: the creator's visible
// brand rating (from 3 ratings) and badges. `rating` is publicRating's { average, count }.
function standoutFor(profile, campaign, terms, rating) {
  const rules = campaign.creatorEligibility || {};
  const required = rules.requiredBadges || [];
  const gated = terms.creatorAccess === "application_required" || required.length > 0 || Boolean(rules.minRank) || Boolean(rules.verifiedOnly);
  if (!gated) return { points: 0, reason: null };
  const badges = (profile && profile.badges) || [];
  const parts = [];
  let reason = null;
  if (rating && typeof rating.average === "number") {
    parts.push(Math.max(0, Math.min(1, (rating.average - 1) / 4)));
    if (rating.average >= 4) reason = `Brands rate your work ${rating.average.toFixed(1)}`;
  }
  if (required.length > 0 && required.every((b) => badges.includes(b))) {
    parts.push(1);
    reason = `Your ${BADGE_NAMES[required[0]] || required[0]} badge qualifies you`;
  } else if (badges.length > 0) {
    parts.push(Math.min(1, badges.length / 2));
  }
  if (parts.length === 0) return { points: 0, reason: null };
  return { points: (STANDOUT_MAX_POINTS * parts.reduce((s, v) => s + v, 0)) / parts.length, reason };
}

function isExperienced(history) {
  if (!history) return false;
  return (history.finished || []).length > 0 || Object.values(history.byObjective || {}).some((r) => r.abandoned > 0);
}

// `check` is { eligible, matchScore } from the shared join check. `terms` is campaignTerms(campaign).
// `history` is summarizeHistory's result (null: cold start). `rating` is the creator's public rating.
// Returns { recommended, nicheOverlap, score, why } where `why` is up to 2 short reasons.
// `explain: false` skips writing the reasons (the marketplace scores every campaign but shows only some).
function recommendation(profile, campaign, check, { terms, history = null, rating = null, explain = true } = {}) {
  terms = terms || { objective: null, payShape: null, creatorAccess: campaign.creatorAccess || "open_call" };
  const facts = campaignFacts(campaign);
  const overlap = overlapFor(profile, campaign);
  const nicheOverlap = overlap.length;
  const targeted = facts.targeted;
  const audience = targeted ? check.matchScore / 100 : nicheOverlap > 0 ? Math.min(1, 0.8 + 0.1 * nicheOverlap) : 0;

  const reasons = [];
  const targeting = campaign.audienceTargeting || {};
  if (!explain) {
    // Reasons aren't needed.
  } else if (targeted && check.matchScore >= RECOMMENDED_MIN_SCORE) {
    const share = targeting.locations && targeting.locations.length && profile ? Math.min(100, locationShare(profile, targeting)) : 0;
    reasons.push(
      share > 0
        ? `${Math.round(share)}% of your audience is in ${targeting.locations.join(" or ")}`
        : `Your audience matches ${check.matchScore}% of its targeting`
    );
  } else if (!targeted && nicheOverlap > 0) {
    reasons.push(`Fits your ${titleCase(overlap[0])} niche`);
  }

  const experienced = isExperienced(history);
  let score;
  let fromHistory = false;
  if (!experienced) {
    score = 100 * audience;
  } else {
    if (!facts.shape || facts.shapeTerms !== terms) {
      facts.shape = campaignShape(campaign, terms);
      facts.shapeTerms = terms;
    }
    const shape = facts.shape;
    const similarity = similarityTo(shape, history);
    const track = trackRecord(terms.objective, history);
    const standout = standoutFor(profile, campaign, terms, rating);
    score = Math.min(
      100,
      100 * (WEIGHTS.audience * audience + WEIGHTS.similarity * similarity + WEIGHTS.track * (track.value === null ? TRACK_NEUTRAL : track.value)) +
        standout.points
    );
    fromHistory = !targeted && nicheOverlap === 0 && similarity >= HISTORY_MIN_SIMILARITY && track.value !== null && track.value >= HISTORY_MIN_TRACK;
    if (!explain) {
      // Reasons aren't needed.
    } else if (track.finished >= 2 && track.success >= 0.6) {
      reasons.push(`You did well on ${OBJECTIVE_LABELS[terms.objective] || terms.objective} campaigns`);
    } else if (similarity >= 0.5) {
      reasons.push("Similar to campaigns you finished");
    }
    if (explain && standout.reason) reasons.push(standout.reason);
  }

  const suits = targeted ? check.matchScore >= RECOMMENDED_MIN_SCORE : nicheOverlap > 0 || fromHistory;
  return { recommended: Boolean(check.eligible && suits), nicheOverlap, score: round1(score), why: reasons.slice(0, 2) };
}

// An entry's publish time in ms (the marketplace works it out once per campaign as publishedAtMs).
const time = (entry) => (entry.publishedAtMs !== undefined ? entry.publishedAtMs : entry.publishedAt ? new Date(entry.publishedAt).getTime() : 0);

// Highest score first, then the newer campaign, then the higher id (a total order, so paging is stable).
function sortRecommended(a, b) {
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  if (time(b) !== time(a)) return time(b) - time(a);
  return String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0;
}

module.exports = {
  recommendation,
  sortRecommended,
  hasAudienceTargeting,
  campaignShape,
  shapeSimilarity,
  similarityTo,
  trackRecord,
  entryTime: time,
  RECOMMENDED_MIN_SCORE,
  WEIGHTS,
  SIMILARITY_WEIGHTS,
  VIEWS_BENCHMARK,
  CONVERSIONS_BENCHMARK,
  STANDOUT_MAX_POINTS,
};
