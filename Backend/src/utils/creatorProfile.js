const { z } = require("zod");

const AGE_RANGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55+"];
const CATEGORIES = [
  "Fashion",
  "Beauty",
  "Music",
  "Comedy",
  "Lifestyle",
  "Finance",
  "Gaming",
  "Food",
  "Sports",
  "Tech",
  "Education",
  "Business",
  "Other",
];
const PLATFORMS = ["instagram", "tiktok", "youtube", "twitter", "facebook"];
const MAX_AUDIENCE_LOCATIONS = 5;
const MAX_PORTFOLIO_ITEMS = 12;

const percentage = z.number().min(0).max(100);
const totalAtMost100 = (items) => items.reduce((sum, i) => sum + i.percentage, 0) <= 100;

const audienceSchema = z.object({
  locations: z
    .array(z.object({ name: z.string().trim().min(1).max(60), percentage }))
    .max(MAX_AUDIENCE_LOCATIONS, `Add up to ${MAX_AUDIENCE_LOCATIONS} audience locations`)
    .refine(totalAtMost100, "Audience locations can't add up to more than 100%")
    .optional(),
  ages: z
    .array(z.object({ range: z.enum(AGE_RANGES), percentage }))
    .refine(totalAtMost100, "Age groups can't add up to more than 100%")
    .optional(),
  genders: z
    .object({ female: percentage, male: percentage, other: percentage.default(0) })
    .refine((g) => g.female + g.male + g.other <= 100, "Gender split can't add up to more than 100%")
    .optional(),
  proofUrl: z.string().url().max(500).optional(),
});

const categoriesSchema = z.array(z.enum(CATEGORIES)).max(CATEGORIES.length);

const portfolioSchema = z.object({
  items: z
    .array(
      z.object({
        url: z.string().url().max(500),
        thumbnailUrl: z.string().url().max(500).optional(),
        platform: z.enum(PLATFORMS),
        title: z.string().trim().max(120).optional(),
        views: z.number().int().min(0).optional(),
        category: z.enum(CATEGORIES).optional(),
      })
    )
    .max(MAX_PORTFOLIO_ITEMS, `Add up to ${MAX_PORTFOLIO_ITEMS} portfolio items`),
});

function publicPortfolio(portfolio) {
  return (portfolio || []).map((p) => ({
    url: p.url,
    thumbnailUrl: p.thumbnailUrl || null,
    platform: p.platform,
    title: p.title || "",
    views: p.views || 0,
    category: p.category || null,
  }));
}

function publicStats(profile) {
  const stats = profile.stats || {};
  return {
    followers: (profile.socialAccounts || []).reduce((sum, s) => sum + (s.followers || 0), 0),
    avgViews: stats.avgViews || 0,
    engagementRate: stats.engagementRate !== undefined ? stats.engagementRate : null,
    pastCampaigns: stats.pastCampaigns || 0,
    totalCampaignViews: stats.totalCampaignViews || 0,
    updatedAt: stats.updatedAt || null,
  };
}

function publicAudience(audience) {
  if (!audience || !audience.source) return null;
  return {
    locations: (audience.locations || []).map((l) => ({ name: l.name, percentage: l.percentage })),
    ages: (audience.ages || []).map((a) => ({ range: a.range, percentage: a.percentage })),
    genders: audience.genders && audience.genders.female !== undefined
      ? { female: audience.genders.female, male: audience.genders.male, other: audience.genders.other || 0 }
      : null,
    source: audience.source,
    updatedAt: audience.updatedAt || null,
  };
}

// What brands and the public may see of a creator. Built from an explicit list so a new
// private field (legal name, phone, email, bank details) can never leak by default.
function brandSafeProfile(profile, user) {
  if (!profile) return null;
  return {
    id: String(profile._id),
    userId: String(profile.userId && profile.userId._id ? profile.userId._id : profile.userId),
    username: profile.username,
    displayName: profile.displayName || (user && user.name) || profile.username,
    avatar: (user && user.avatar) || null,
    bio: profile.bio || "",
    location: {
      city: profile.city || "",
      state: profile.state || "",
      country: profile.country || "",
    },
    socialAccounts: (profile.socialAccounts || []).map((s) => ({
      platform: s.platform,
      handle: s.handle,
      verified: Boolean(s.verified),
      followers: s.followers !== undefined && s.followers !== null ? s.followers : null,
    })),
    niches: profile.niches || [],
    categories: profile.categories || [],
    portfolio: publicPortfolio(profile.portfolio),
    audience: publicAudience(profile.audience),
    verified: Boolean(profile.verifiedAt),
    badges: profile.badges || [],
    stats: publicStats(profile),
    rank: profile.rank,
    creatorScore: profile.creatorScore,
    verifiedViews: profile.verifiedViews,
    completionRate: profile.completionRate,
  };
}

module.exports = {
  AGE_RANGES,
  CATEGORIES,
  audienceSchema,
  categoriesSchema,
  portfolioSchema,
  publicAudience,
  publicPortfolio,
  publicStats,
  brandSafeProfile,
};
