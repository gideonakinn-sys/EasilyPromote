// The applicant snapshot (ticket 06): the brand-safe profile a creator applies with, frozen
// at apply time, and the order a brand reviews it in for one campaign. Pure: no database.
const { brandSafeProfile } = require("../utils/creatorProfile");
const { campaignTerms } = require("../utils/campaignPay");

const DEFAULT_ORDER = ["platforms", "categories", "audience", "performance", "portfolio", "badges"];

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const largest = (entries) =>
  (entries || []).reduce((best, e) => (!best || (e.percentage || 0) > (best.percentage || 0) ? e : best), null);

// Built from the brand-safe projection, so nothing private (legal name, phone, email, bank,
// audience proof) can reach a brand through an application.
function buildApplicantSnapshot(profile, user) {
  const safe = brandSafeProfile(profile, user);
  if (!safe) return null;
  return {
    name: safe.displayName,
    username: safe.username,
    photo: safe.avatar,
    verified: safe.verified,
    location: safe.location,
    platforms: [...safe.socialAccounts]
      .sort((a, b) => (b.followers || 0) - (a.followers || 0))
      .map((s) => ({ platform: s.platform, handle: s.handle || null, followers: s.followers })),
    categories: safe.categories,
    audience: safe.audience
      ? { locations: safe.audience.locations, ages: safe.audience.ages, genders: safe.audience.genders, source: safe.audience.source }
      : null,
    stats: {
      avgViews: safe.stats.avgViews,
      engagementRate: safe.stats.engagementRate,
      pastCampaigns: safe.stats.pastCampaigns,
      totalCampaignViews: safe.stats.totalCampaignViews,
    },
    portfolio: safe.portfolio.map((p) => ({
      url: p.url,
      thumbnailUrl: p.thumbnailUrl,
      platform: p.platform,
      title: p.title,
      views: p.views,
      category: p.category,
    })),
    badges: safe.badges,
    rating: safe.rating,
    completionRate: safe.completionRate || 0,
    rank: safe.rank || null,
  };
}

// Sections in the order the brand should read them for this campaign:
//   location-targeted → share of audience in those locations first;
//   performance campaign → performance stats first;
//   categories required → portfolio items in those categories first.
// Returns { sections: [{ key, emphasis, data }] }; the UI renders them in this order.
function orderSnapshot(campaign, snapshot) {
  const targeting = (campaign && campaign.audienceTargeting) || {};
  const targetLocations = targeting.locations || [];
  // Required categories, or the campaign's own category when the brand set none.
  const required = ((campaign && campaign.creatorEligibility) || {}).categories || [];
  const targetCategories = required.length ? required : campaign && campaign.category ? [campaign.category] : [];
  const performance = campaignTerms(campaign || {}).campaignModel === "performance";

  const audience = (snapshot && snapshot.audience) || {};
  const inTarget = (name) => targetLocations.some((t) => sameName(t, name));
  const locations = [...(audience.locations || [])].sort((a, b) => {
    if (inTarget(a.name) !== inTarget(b.name)) return inTarget(a.name) ? -1 : 1;
    return (b.percentage || 0) - (a.percentage || 0);
  });
  const inCategory = (item) => Boolean(item.category) && targetCategories.includes(item.category);
  const items = ((snapshot && snapshot.portfolio) || [])
    .map((item) => ({ ...item, matchesCampaign: inCategory(item) }))
    .sort((a, b) => Number(b.matchesCampaign) - Number(a.matchesCampaign));

  const sections = {
    platforms: { accounts: (snapshot && snapshot.platforms) || [] },
    categories: {
      categories: (snapshot && snapshot.categories) || [],
      matching: ((snapshot && snapshot.categories) || []).filter((c) => targetCategories.includes(c)),
    },
    audience: {
      targetedLocations: targetLocations,
      targetedShare: locations.filter((l) => inTarget(l.name)).reduce((sum, l) => sum + (l.percentage || 0), 0),
      locations,
      topLocation: largest(audience.locations) ? { name: largest(audience.locations).name, percentage: largest(audience.locations).percentage } : null,
      topAge: largest(audience.ages) ? { range: largest(audience.ages).range, percentage: largest(audience.ages).percentage } : null,
      genders: audience.genders || null,
      source: audience.source || null,
      // M8 batch 7: age/gender hard filter context (SPEC D8 amended).
      targetedAgeRanges: targeting.ageRanges || [],
      targetedAgeShare: (audience.ages || [])
        .filter((e) => (targeting.ageRanges || []).some((t) => sameName(e.range, t)))
        .reduce((sum, e) => sum + (e.percentage || 0), 0),
      requireAgeMatch: Boolean(targeting.requireAgeMatch),
      targetedGenders: (targeting.genders || []).filter((g) => g !== "all"),
      targetedGenderShare: ((targeting.genders || []).filter((g) => g !== "all"))
        .reduce((sum, g) => sum + ((audience.genders || {})[g] || 0), 0),
      requireGenderMatch: Boolean(targeting.requireGenderMatch),
    },
    performance: { ...((snapshot && snapshot.stats) || {}) },
    portfolio: { categories: targetCategories, items },
    badges: {
      badges: (snapshot && snapshot.badges) || [],
      rating: (snapshot && snapshot.rating) || { average: null, count: 0 },
      completionRate: (snapshot && snapshot.completionRate) || 0,
    },
  };

  const first = [
    targetLocations.length > 0 && "audience",
    performance && "performance",
    targetCategories.length > 0 && "portfolio",
  ].filter(Boolean);
  const order = [...first, ...DEFAULT_ORDER.filter((key) => !first.includes(key))];

  return { sections: order.map((key) => ({ key, emphasis: first.includes(key), data: sections[key] })) };
}

module.exports = { buildApplicantSnapshot, orderSnapshot };
