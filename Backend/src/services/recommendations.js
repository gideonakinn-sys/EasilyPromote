// Recommended for You. A campaign is recommended when the creator can join it and either
// it targets an audience the creator's audience suits (Match Score 50+), or it targets no
// audience and shares the creator's categories or niches. Pure.
const RECOMMENDED_MIN_SCORE = 50;

const lower = (list) => (Array.isArray(list) ? list : []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);

// The dimensions the Match Score measures; platforms are a requirement, not audience fit.
function hasAudienceTargeting(campaign) {
  const targeting = (campaign && campaign.audienceTargeting) || {};
  return Boolean(
    (targeting.locations && targeting.locations.length) ||
      (targeting.ageRanges && targeting.ageRanges.length) ||
      (targeting.genders || []).some((g) => g !== "all")
  );
}

function nicheOverlapFor(profile, campaign) {
  const mine = new Set([...lower(profile && profile.niches), ...lower(profile && profile.categories)]);
  const theirs = new Set([...lower([campaign.category]), ...lower(campaign.niches)]);
  return [...theirs].filter((n) => mine.has(n)).length;
}

// `check` is { eligible, matchScore } from the shared join check.
function recommendation(profile, campaign, check) {
  const nicheOverlap = nicheOverlapFor(profile, campaign);
  const suits = hasAudienceTargeting(campaign) ? check.matchScore >= RECOMMENDED_MIN_SCORE : nicheOverlap > 0;
  return { recommended: Boolean(check.eligible && suits), nicheOverlap };
}

function sortRecommended(a, b) {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  return b.nicheOverlap - a.nicheOverlap;
}

module.exports = { recommendation, sortRecommended, hasAudienceTargeting, RECOMMENDED_MIN_SCORE };
