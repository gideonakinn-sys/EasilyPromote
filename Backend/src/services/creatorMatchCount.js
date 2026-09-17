// The brand wizard's live "about N creators match" count (ticket 11). While a brand sets audience
// targeting and creator eligibility, it counts the active creators who could join a campaign with
// those settings, through the same check joining uses (services/joinRules → services/eligibility):
// audience location share, platform, verification and the brand's eligibility rules are hard
// requirements; age, gender and interests only rank (D8), so they never change the count. A creator
// also needs a connected social account and niches to join, as on the join route.
//
// Only a rounded count leaves this module: never a creator, a list or an exact small number, so
// narrowing the settings can't single anyone out.
const CreatorProfile = require("../models/CreatorProfile");
const MetaConnection = require("../models/MetaConnection");
const TikTokConnection = require("../models/TikTokConnection");
const User = require("../models/User");
const { joinEligibility } = require("./joinRules");

// The creators counted against are loaded once and reused for this long, so typing in the wizard
// doesn't read every profile on every change.
const POOL_TTL_MS = 5 * 60 * 1000;
// Below this, the exact number isn't shown.
const SMALL_COUNT = 10;
const PROFILE_FIELDS = "userId socialAccounts niches categories audience.locations audience.ages audience.genders verifiedAt stats.engagementRate rank badges";

let cached = null; // { loadedAt, creators, loading }

async function loadPool() {
  const [users, profiles, tiktok, meta] = await Promise.all([
    User.find({ role: "creator", isActive: { $ne: false } }).select("_id").lean(),
    CreatorProfile.find().select(PROFILE_FIELDS).lean(),
    TikTokConnection.find().select("userId").lean(),
    MetaConnection.find().select("userId provider").lean(),
  ]);
  const active = new Set(users.map((u) => String(u._id)));
  const connected = new Map();
  const add = (userId, platform) => {
    const key = String(userId);
    if (!connected.has(key)) connected.set(key, []);
    connected.get(key).push(platform);
  };
  tiktok.forEach((c) => add(c.userId, "tiktok"));
  meta.forEach((c) => c.provider && add(c.userId, c.provider));
  return profiles
    .filter((p) => active.has(String(p.userId)))
    .map((profile) => ({ profile, connectedPlatforms: connected.get(String(profile.userId)) || [] }));
}

async function creatorPool(now = Date.now()) {
  if (cached && cached.creators && now - cached.loadedAt < POOL_TTL_MS) return cached.creators;
  if (cached && cached.loading) return cached.loading;
  const loading = loadPool();
  cached = { ...(cached || {}), loading };
  try {
    const creators = await loading;
    cached = { loadedAt: Date.now(), creators, loading: null };
    return creators;
  } catch (error) {
    cached = null;
    throw error;
  }
}

function clearCreatorPool() {
  cached = null;
}

// Pure. How many of `creators` ({ profile, connectedPlatforms }) could join a campaign with these settings.
function countEligible(creators, { audienceTargeting = {}, creatorEligibility = {} } = {}) {
  const campaign = { audienceTargeting, creatorEligibility };
  let count = 0;
  for (const { profile, connectedPlatforms } of creators) {
    // As on the join route: a connected TikTok or Meta account.
    const hasSocial = connectedPlatforms.length > 0;
    const check = joinEligibility({ profile, connectedPlatforms, hasSocial, activeSlots: 0, campaign, availableSlots: [] });
    if (check.eligible) count += 1;
  }
  return count;
}

// Pure. What the brand sees: { count, fewerThan, label }. Zero is exact; 1–9 is "fewer than 10";
// larger counts round to the nearest 10 (under 1,000), 100 (under 10,000) or 1,000.
function roundMatchCount(exact) {
  const n = Math.max(0, Math.floor(Number(exact) || 0));
  if (n === 0) return { count: 0, fewerThan: false, label: "No creators match yet" };
  if (n < SMALL_COUNT) return { count: SMALL_COUNT, fewerThan: true, label: `Fewer than ${SMALL_COUNT} creators match` };
  const step = n < 1000 ? 10 : n < 10000 ? 100 : 1000;
  const count = Math.max(SMALL_COUNT, Math.round(n / step) * step);
  return { count, fewerThan: false, label: `About ${count.toLocaleString("en-US")} creators match` };
}

async function matchCount(settings) {
  return roundMatchCount(countEligible(await creatorPool(), settings));
}

module.exports = { matchCount, countEligible, roundMatchCount, clearCreatorPool, POOL_TTL_MS, SMALL_COUNT };
