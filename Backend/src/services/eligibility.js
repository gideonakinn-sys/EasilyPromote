// Creator Eligibility: whether a creator may join or apply to a campaign, every rule they
// miss in plain words, and a Match Score for ordering recommendations and applicants.
// Audience location, platform and verification (plus the brand's creator eligibility
// rules) are hard requirements; age, gender and interests only affect the score (D8 in docs/campaign-engine/SPEC.md).
const { rankAtLeast } = require("./creatorScore");

const PLATFORM_NAMES = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", twitter: "X", facebook: "Facebook" };
const BADGE_NAMES = {
  top_creator: "Top Creator",
  high_performer: "High Performer",
  reliable_creator: "Reliable Creator",
  campaign_pro: "Campaign Pro",
};
const SCORE_WEIGHTS = { location: 0.6, age: 0.25, gender: 0.15 };

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const listWithOr = (items) => items.join(" or ");
const rankName = (rank) => (rank === "elite" ? "Elite" : `rank ${String(rank).replace("rank", "")}`);

function shareIn(entries, key, targets) {
  return (entries || []).filter((e) => targets.some((t) => sameName(e[key], t))).reduce((sum, e) => sum + (e.percentage || 0), 0);
}

function locationShare(profile, targeting) {
  return shareIn(profile.audience && profile.audience.locations, "name", targeting.locations);
}

function evaluateEligibility(profile, campaign) {
  const targeting = (campaign && campaign.audienceTargeting) || {};
  const rules = (campaign && campaign.creatorEligibility) || {};
  const failures = [];
  const fail = (criterion, message) => failures.push({ criterion, message });

  const accounts = profile.socialAccounts || [];
  const targetPlatforms = (targeting.platforms || []).map((p) => String(p).toLowerCase());
  const accountsOnTarget = targetPlatforms.length
    ? accounts.filter((a) => targetPlatforms.includes(String(a.platform).toLowerCase()))
    : accounts;
  const platformNames = targetPlatforms.map((p) => PLATFORM_NAMES[p] || p);

  const targetLocations = targeting.locations || [];
  const hasLocationData = Boolean(profile.audience && profile.audience.locations && profile.audience.locations.length);
  // With no minimum share, targeted locations only rank creators.
  if (targetLocations.length && targeting.minLocationShare > 0) {
    const minShare = targeting.minLocationShare;
    const share = locationShare(profile, targeting);
    if (!hasLocationData) {
      fail("audienceLocation", `Add your audience locations to join campaigns targeting ${listWithOr(targetLocations)}`);
    } else if (share < minShare) {
      fail("audienceLocation", `Needs at least ${minShare}% of your audience in ${listWithOr(targetLocations)} (you have ${share}%)`);
    }
  }

  if (targetPlatforms.length && accountsOnTarget.length === 0) {
    fail("platform", `Needs a connected ${listWithOr(platformNames)} account`);
  }

  if (rules.verifiedOnly && !profile.verifiedAt) {
    fail("verified", "Only verified creators can take part");
  }

  if (rules.minFollowers) {
    const best = accountsOnTarget.reduce((max, a) => Math.max(max, a.followers || 0), 0);
    const uncounted = accountsOnTarget.filter((a) => a.followers === undefined || a.followers === null);
    if (best < rules.minFollowers && uncounted.length > 0) {
      const names = [...new Set(uncounted.map((a) => PLATFORM_NAMES[String(a.platform).toLowerCase()] || a.platform))];
      fail("minFollowers", `Add your follower count on ${listWithOr(names)} to join`);
    } else if (best < rules.minFollowers) {
      const where = platformNames.length ? `on ${listWithOr(platformNames)}` : "on one account";
      fail("minFollowers", `Needs ${rules.minFollowers.toLocaleString("en-US")}+ followers ${where}`);
    }
  }

  if (rules.minEngagementRate) {
    const rate = profile.stats ? profile.stats.engagementRate : null;
    if (rate === null || rate === undefined) {
      fail("minEngagementRate", `Needs an engagement rate of ${rules.minEngagementRate}% or more (no campaign results yet)`);
    } else if (rate < rules.minEngagementRate) {
      fail("minEngagementRate", `Needs an engagement rate of ${rules.minEngagementRate}% or more (you have ${rate}%)`);
    }
  }

  if (rules.categories && rules.categories.length) {
    const mine = profile.categories || [];
    if (!rules.categories.some((c) => mine.includes(c))) {
      fail("categories", `Needs a creator in ${listWithOr(rules.categories)}`);
    }
  }

  if (rules.minRank && !rankAtLeast(profile.rank, rules.minRank)) {
    fail("minRank", `Needs ${rankName(rules.minRank)} or higher`);
  }

  const missingBadges = (rules.requiredBadges || []).filter((b) => !(profile.badges || []).includes(b));
  if (missingBadges.length) {
    const names = missingBadges.map((b) => BADGE_NAMES[b] || b);
    fail("requiredBadges", `Needs the ${names.join(" and ")} badge${names.length > 1 ? "s" : ""}`);
  }
  // M8 batch 7: opt-in hard filters for age and gender (SPEC D8 amended).
  // When the brand opts in, age and gender become hard requirements instead of ranking-only.
  const targetAgeRanges = targeting.ageRanges || [];
  if (targeting.requireAgeMatch && targetAgeRanges.length) {
    const minShare = targeting.minAgeShare || 50;
    const hasAgeData = Boolean(profile.audience && profile.audience.ages && profile.audience.ages.length);
    if (!hasAgeData) {
      fail("audienceAge", `Add your audience age breakdown to join campaigns targeting ${listWithOr(targetAgeRanges)}`);
    } else {
      const share = shareIn(profile.audience.ages, "range", targetAgeRanges);
      if (share < minShare) {
        fail("audienceAge", `Needs at least ${minShare}% of your audience aged ${listWithOr(targetAgeRanges)} (you have ${share}%)`);
      }
    }
  }

  const targetGenders = (targeting.genders || []).filter((g) => g !== "all");
  if (targeting.requireGenderMatch && targetGenders.length) {
    const minShare = targeting.minGenderShare || 50;
    const hasGenderData = Boolean(profile.audience && profile.audience.genders);
    if (!hasGenderData) {
      fail("audienceGender", `Add your audience gender breakdown to join campaigns targeting ${listWithOr(targetGenders)}`);
    } else {
      const split = profile.audience.genders || {};
      const share = targetGenders.reduce((sum, g) => sum + (split[g] || 0), 0);
      if (share < minShare) {
        fail("audienceGender", `Needs at least ${minShare}% of your audience ${listWithOr(targetGenders)} (you have ${share}%)`);
      }
    }
  }

  return { eligible: failures.length === 0, failures, matchScore: matchScore(profile, targeting) };
}

// 0–100: the share of the creator's audience inside what the brand targeted, weighted
// towards location. Dimensions the brand didn't target are left out; no targeting at all
// means every creator matches equally.
function matchScore(profile, targeting) {
  const audience = profile.audience || {};
  const parts = [];

  if (targeting.locations && targeting.locations.length) {
    parts.push([SCORE_WEIGHTS.location, Math.min(100, locationShare(profile, targeting))]);
  }
  if (targeting.ageRanges && targeting.ageRanges.length) {
    parts.push([SCORE_WEIGHTS.age, Math.min(100, shareIn(audience.ages, "range", targeting.ageRanges))]);
  }
  const genders = (targeting.genders || []).filter((g) => g !== "all");
  if (genders.length) {
    const split = audience.genders || {};
    parts.push([SCORE_WEIGHTS.gender, Math.min(100, genders.reduce((sum, g) => sum + (split[g] || 0), 0))]);
  }

  if (parts.length === 0) return 100;
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  return Math.round(parts.reduce((sum, [w, value]) => sum + w * value, 0) / weight);
}

module.exports = { evaluateEligibility, locationShare, matchScore };
