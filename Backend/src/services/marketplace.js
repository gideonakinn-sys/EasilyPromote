// The creator marketplace: live campaigns as cards, Recommended for You, Trending and New (tickets 04 and
// 11; server-side sections and paging, M8 SPEC D28).
//
// Two ways to read it:
//   - buildMarketplaceSections: the sections a creator's marketplace tab shows, each a page of `limit`
//     cards with a cursor for the next page (GET /api/creators/marketplace/sections[/:section]).
//   - the whole list at once (creatorDashboard.buildMarketplace, GET /api/creators/marketplace and the
//     dashboard), kept for web clients from before paging.
// Both put the same campaign in the same section in the same order; cards are built by the same code.
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const User = require("../models/User");
const { toObjectId } = require("../utils/objectId");
const { rankAtLeast } = require("./creatorScore");
const { campaignTerms, payPerUnit, briefSummary } = require("../utils/campaignPay");
const { campaignEventTypes } = require("../utils/referralCodes");
const { joinEligibility, campaignFailures } = require("./joinRules");
const { matchScore } = require("./eligibility");
const { recommendation, sortRecommended, entryTime } = require("./recommendations");
const { recentInterest, trendScore, canTrend, sortTrending, TRENDING_LIMIT, TRENDING_MIN_CREATORS } = require("./trending");
const { creatorRecordUnions, creatorRecordFrom, resetHistoryCache } = require("./creatorHistory");
const { publicRating } = require("../utils/creatorProfile");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS } = require("../utils/placementStatuses");

// What a marketplace card, the join check, Recommended for You and Trending read from a live campaign
// (load test, ticket 11): every live campaign is loaded, so only these fields are.
const MARKETPLACE_CAMPAIGN_FIELDS = [
  "businessId",
  "name",
  "category",
  "niches",
  "platforms",
  "coverImageUrl",
  "contentBrief",
  "keyMessageCta",
  "brief.summary",
  "targetViews",
  "costPerView",
  "creatorPool",
  "endDate",
  "status",
  "createdAt",
  "objective",
  "campaignObjective",
  "campaignModel",
  "payShape",
  "creatorAccess",
  "contentPay",
  "audienceTargeting",
  "creatorEligibility",
  "referral.enabled",
  "referral.eventType",
  "referral.eventTypes",
  "referral.rewardPerConversion",
  "referral.poolRemaining",
  "hybridBonus.metric",
  "hybridBonus.ratePerThousandViews",
  "hybridBonus.capPerCreator",
  "hybridBonus.poolRemaining",
  "contentDestination",
  "destinationUrl",
  "usageRights",
].join(" ");

// ── Shared, per API process ─────────────────────────────────────────────────────────────────────

// Every live campaign, as the marketplace reads it, kept in this API process while no live campaign
// changed (load test, ticket 11). Each request checks one summary row, how many campaigns are live and
// when one last changed, and reloads the list only when that moved, so a campaign that goes live,
// pauses, ends or changes shows on the next request. It's reloaded at least every 30 seconds anyway,
// in case API instances' clocks disagree about "last changed". The list is shared between requests:
// never modify it.
const LIVE_CAMPAIGN_CACHE_MAX_AGE_MS = 30 * 1000;
let liveCampaignCache = { version: null, loadedAt: 0, checkedAt: 0, campaigns: [], loading: null };

// `checkEveryMs`: the paged marketplace (M8) checks the summary row at most this often per API instance,
// so a change shows within that time rather than on the very next request.
async function liveMarketplaceCampaigns({ checkEveryMs = 0 } = {}) {
  if (checkEveryMs > 0 && liveCampaignCache.version !== null && Date.now() - liveCampaignCache.checkedAt < checkEveryMs) {
    return liveCampaignCache.campaigns;
  }
  const checkedAt = Date.now();
  // Covered by the { status, updatedAt } index (M8).
  const [summary] = await Campaign.aggregate([
    { $match: { status: "live" } },
    { $project: { _id: 0, updatedAt: 1 } },
    { $group: { _id: null, count: { $sum: 1 }, latest: { $max: "$updatedAt" } } },
  ]);
  const version = summary ? `${summary.count}:${new Date(summary.latest).getTime()}` : "0:0";
  const fresh = Date.now() - liveCampaignCache.loadedAt < LIVE_CAMPAIGN_CACHE_MAX_AGE_MS;
  if (liveCampaignCache.version === version && fresh) {
    liveCampaignCache.checkedAt = checkedAt;
    return liveCampaignCache.campaigns;
  }
  if (liveCampaignCache.loading && liveCampaignCache.loading.version === version) return liveCampaignCache.loading.promise;
  const loadedAt = Date.now();
  const promise = Campaign.find({ status: "live" })
    .select(MARKETPLACE_CAMPAIGN_FIELDS)
    .sort({ createdAt: -1 })
    .lean()
    .then((campaigns) => {
      liveCampaignCache = { version, loadedAt, checkedAt, campaigns, loading: null };
      return campaigns;
    })
    .catch((error) => {
      liveCampaignCache.loading = null;
      throw error;
    });
  liveCampaignCache.loading = { version, promise };
  return promise;
}

// Campaign and brand ids as strings, worked out once per campaign object: the marketplace looks each
// live campaign up several times per request, and the cached list is reused across requests.
// Its terms (campaignTerms), publish time and signatures are kept the same way. The join signature is
// everything the campaign-specific join check reads (audience targeting and creator eligibility; the
// open places' ranks are added per request); the fit signature is everything Recommended for You reads.
// Campaigns with the same signature get the same answer for a creator, so each is worked out once per
// request (classifyCampaign).
const campaignKeys = new WeakMap();
function keysOf(campaign) {
  let keys = campaignKeys.get(campaign);
  if (!keys) {
    const terms = campaignTerms(campaign);
    const targeting = campaign.audienceTargeting || {};
    const rules = campaign.creatorEligibility || {};
    const join = JSON.stringify([targeting.locations, targeting.minLocationShare, targeting.platforms, rules]);
    keys = {
      id: String(campaign._id),
      brand: campaign.businessId ? String(campaign.businessId) : null,
      terms,
      publishedAtMs: campaign.createdAt ? new Date(campaign.createdAt).getTime() : 0,
      joinSignature: join,
      fitSignature: JSON.stringify([
        campaign.category,
        campaign.niches,
        campaign.platforms,
        targeting,
        terms.objective,
        terms.payShape,
        terms.creatorAccess,
        rules.requiredBadges,
        rules.minRank,
        rules.verifiedOnly,
      ]),
    };
    campaignKeys.set(campaign, keys);
  }
  return keys;
}

// The ranks the open places need, as part of the join signature ("" when none needs a rank).
function openRanksKey(open) {
  let key = "";
  for (const slot of open.slots) if (slot.rankRequired) key += `${slot.rankRequired},`;
  return key;
}

// The open places of the given campaigns, summarised in the database (load test, ticket 11): for each
// campaign and each rank requirement, how many places are open and the first one in join order.
// That's all a card and the join check need: the place a creator would get is the first one their
// rank allows, which is always the first of its rank group. Returns Map<campaignId, { count, slots }>
// with slots in join order.
async function openPlacesByCampaign(campaignIds) {
  const rows = await Slot.aggregate([
    { $match: { campaignId: { $in: campaignIds }, status: "available" } },
    { $sort: { campaignId: 1, createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: { campaignId: "$campaignId", rankRequired: "$rankRequired" },
        count: { $sum: 1 },
        slot: { $first: { _id: "$_id", campaignId: "$campaignId", reward: "$reward", viewTarget: "$viewTarget", rankRequired: "$rankRequired", createdAt: "$createdAt" } },
      },
    },
  ]);
  const byCampaign = new Map();
  for (const row of rows) {
    const key = String(row._id.campaignId);
    const entry = byCampaign.get(key) || { count: 0, slots: [] };
    entry.count += row.count;
    entry.slots.push(row.slot);
    byCampaign.set(key, entry);
  }
  for (const entry of byCampaign.values()) {
    entry.slots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (String(a._id) < String(b._id) ? -1 : 1));
  }
  return byCampaign;
}

// Trending v2 (M8): every place of each campaign that's open or held, and when its places were made
// (it went live). Covered by the Slot { campaignId, status, createdAt } index. Map<campaignId,
// { total, launchedAt (ms) }>.
async function placeTotalsByCampaign(campaignIds) {
  const rows = await Slot.aggregate([
    { $match: { campaignId: { $in: campaignIds }, status: { $in: ["available", ...HELD_PLACEMENT_STATUSES] } } },
    { $group: { _id: "$campaignId", total: { $sum: 1 }, launchedAt: { $min: "$createdAt" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), { total: row.total, launchedAt: row.launchedAt ? row.launchedAt.getTime() : null }]));
}

// Sections (M8): which campaigns go in which section is worked out from open places and totals read at
// most PLACES_SNAPSHOT_MAX_AGE_MS ago (PLACES_SNAPSHOT_MIN_AGE_MS once the live campaigns changed),
// shared by every creator on this API instance; recent joins and applications at most
// INTEREST_MAX_AGE_MS ago. The cards on a page always carry places counted for that request, and a
// campaign that has filled since is left off its page; a campaign that went live since the snapshot
// shows once it's reloaded.
const PLACES_SNAPSHOT_MAX_AGE_MS = 5 * 1000;
const PLACES_SNAPSHOT_MIN_AGE_MS = 1000;
const INTEREST_MAX_AGE_MS = 60 * 1000;
let placesSnapshot = { campaigns: null, loadedAt: 0, open: new Map(), totals: new Map(), loading: null };
let interestSnapshot = { loadedAt: 0, counts: new Map(), loading: null };
// Brand names and avatars on cards, kept BRAND_MAX_AGE_MS per brand (at most BRAND_CACHE_SIZE brands).
const BRAND_MAX_AGE_MS = 60 * 1000;
const BRAND_CACHE_SIZE = 5000;
let brandCache = new Map();

async function brandsById(ids, now = Date.now()) {
  const byId = new Map();
  const missing = [];
  for (const id of ids) {
    const cached = brandCache.get(id);
    if (cached && now - cached.loadedAt < BRAND_MAX_AGE_MS) byId.set(id, cached.brand);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const rows = await User.find({ _id: { $in: missing.map(toObjectId) } }).select("name avatar").lean();
    for (const row of rows) {
      const id = String(row._id);
      const brand = { name: row.name, avatar: row.avatar };
      byId.set(id, brand);
      brandCache.delete(id);
      brandCache.set(id, { brand, loadedAt: now });
    }
    while (brandCache.size > BRAND_CACHE_SIZE) brandCache.delete(brandCache.keys().next().value);
  }
  return byId;
}

async function sharedPlaces(campaigns) {
  const age = Date.now() - placesSnapshot.loadedAt;
  if (placesSnapshot.campaigns && age < (placesSnapshot.campaigns === campaigns ? PLACES_SNAPSHOT_MAX_AGE_MS : PLACES_SNAPSHOT_MIN_AGE_MS)) {
    return placesSnapshot;
  }
  if (placesSnapshot.loading) return placesSnapshot.loading.promise;
  const loadedAt = Date.now();
  const ids = campaigns.map((c) => c._id);
  const promise = Promise.all([openPlacesByCampaign(ids), placeTotalsByCampaign(ids)])
    .then(([open, totals]) => {
      placesSnapshot = { campaigns, loadedAt, open, totals, loading: null };
      return placesSnapshot;
    })
    .catch((error) => {
      placesSnapshot.loading = null;
      throw error;
    });
  placesSnapshot.loading = { campaigns, promise };
  return promise;
}

async function sharedInterest(campaigns, now) {
  if (Date.now() - interestSnapshot.loadedAt < INTEREST_MAX_AGE_MS) return interestSnapshot.counts;
  if (interestSnapshot.loading) return interestSnapshot.loading;
  const loadedAt = Date.now();
  const promise = recentInterest(campaigns.map((c) => c._id), now)
    .then((counts) => {
      interestSnapshot = { loadedAt, counts, loading: null };
      return counts;
    })
    .catch((error) => {
      interestSnapshot.loading = null;
      throw error;
    });
  interestSnapshot.loading = promise;
  return promise;
}

// Tests change places and joins directly in the database.
function resetMarketplaceCaches() {
  liveCampaignCache = { version: null, loadedAt: 0, checkedAt: 0, campaigns: [], loading: null };
  brandCache = new Map();
  resetHistoryCache();
  placesSnapshot = { campaigns: null, loadedAt: 0, open: new Map(), totals: new Map(), loading: null };
  interestSnapshot = { loadedAt: 0, counts: new Map(), loading: null };
}

// ── Scoring and cards ───────────────────────────────────────────────────────────────────────────

function normalizeNiches(list) {
  return (Array.isArray(list) ? list : [])
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean);
}

// Everything the marketplace knows about one creator for this request.
// `ctx` is creatorDashboard.loadContext's; `slots` are the creator's placements.
function viewerOf(ctx, slots, history) {
  const profile = ctx.profile;
  return {
    ctx,
    profile,
    rank: profile ? profile.rank : "rank1",
    rating: profile ? publicRating(profile.brandRating) : null,
    activeSlots: slots.filter((s) => ACTIVE_PLACEMENT_STATUSES.includes(s.status)).length,
    held: new Set(slots.filter((s) => HELD_PLACEMENT_STATUSES.includes(s.status)).map((s) => String(s.campaignId))),
    history,
  };
}

// One campaign scored for one creator: the join check, Recommended for You and Trending. `open` is the
// campaign's open places ({ count, slots }), `totals` its { total, launchedAt }, `interest` its recent
// { creators, fills }. Null when it has no open place.
// `explain: false` leaves out the reasons for recommending it (worked out for the cards shown).
function scoreCampaign(viewer, campaign, { open, totals, interest, now, explain = true }) {
  if (!open || open.count === 0) return null;
  const { id, terms, publishedAtMs } = keysOf(campaign);
  const check = joinEligibility({
    profile: viewer.profile,
    connectedPlatforms: viewer.ctx.connectedPlatforms,
    hasSocial: viewer.ctx.hasSocial,
    activeSlots: viewer.activeSlots,
    campaign,
    availableSlots: open.slots,
  });
  const reasons = campaignFailures(check.failures).map((f) => f.message);
  const eligible = reasons.length === 0;
  const rec = recommendation(viewer.profile, campaign, { eligible, matchScore: check.matchScore }, { terms, history: viewer.history, rating: viewer.rating, explain });
  const totalPlaces = totals ? totals.total : open.count;
  const recentCreators = interest ? interest.creators : 0;
  // Only a campaign enough creators want can trend; a card shown still gets its score.
  const trend =
    recentCreators >= TRENDING_MIN_CREATORS || (explain && recentCreators > 0)
      ? trendScore({ recentCreators, recentFills: interest.fills, totalPlaces, launchedAt: totals ? totals.launchedAt : publishedAtMs, now })
      : { score: 0, fillShare: 0 };
  return {
    campaign,
    open,
    id,
    terms,
    publishedAt: campaign.createdAt,
    publishedAtMs,
    eligible,
    reasons,
    matchScore: check.matchScore,
    nicheOverlap: rec.nicheOverlap,
    recommended: rec.recommended,
    score: rec.score,
    why: rec.why,
    recentCreators,
    totalPlaces,
    trendScore: trend.score,
    fillShare: trend.fillShare,
  };
}

// The board (M8 load test): every open live campaign with what doesn't depend on the creator worked out
// once per live campaign list, places snapshot and recent-interest snapshot: its places, whether it
// could trend and its trend score, and small numbers standing for its join and fit signatures (keysOf).
// Newest first. Shared by every request: never modify it or its rows.
function boardOf(live, places, interest, nowMs) {
  if (places.board && places.board.interest === interest && places.board.live === live) return places.board;
  const intern = (ids, key) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const fitIds = new Map();
  const joinIds = new Map();
  const rows = [];
  for (const campaign of live) {
    const keys = keysOf(campaign);
    const open = places.open.get(keys.id);
    if (!open || open.count === 0) continue;
    const totals = places.totals.get(keys.id);
    const counts = interest.get(keys.id);
    const totalPlaces = totals ? totals.total : open.count;
    const recentCreators = counts ? counts.creators : 0;
    const mayTrend = canTrend({ eligible: true, recommended: false, recentCreators, totalPlaces });
    rows.push({
      campaign,
      open,
      id: keys.id,
      terms: keys.terms,
      publishedAtMs: keys.publishedAtMs,
      totalPlaces,
      recentCreators,
      mayTrend,
      trendScore: mayTrend
        ? trendScore({ recentCreators, recentFills: counts.fills, totalPlaces, launchedAt: totals ? totals.launchedAt : keys.publishedAtMs, now: nowMs }).score
        : 0,
      fitId: intern(fitIds, keys.fitSignature),
      joinId: intern(joinIds, `${keys.joinSignature}|${openRanksKey(open)}`),
      eligible: null,
      recommended: false,
      score: 0,
    });
  }
  rows.sort(newestFirst);
  places.board = { live, interest, rows, fitCount: fitIds.size, joinCount: joinIds.size };
  return places.board;
}

// Which section each board campaign goes in for one creator, doing only the work that decides it: the
// same recommended, score and trend score as scoreCampaign. Recommended for You is worked out once per
// fit signature and the join check once per join signature, and the join check only for a campaign
// that would be recommended or could trend, since New takes every other campaign whether the creator
// can join it or not. The cards shown are scored in full (scoreCampaign). Returns entries newest first.
function classifyBoard(viewer, board) {
  const fits = new Array(board.fitCount);
  const joins = new Array(board.joinCount);
  const scored = [];
  for (const row of board.rows) {
    if (viewer.held.size > 0 && viewer.held.has(row.id)) continue;
    let fit = fits[row.fitId];
    if (fit === undefined) {
      const match = viewer.profile ? matchScore(viewer.profile, row.campaign.audienceTargeting || {}) : 100;
      fit = recommendation(viewer.profile, row.campaign, { eligible: true, matchScore: match }, {
        terms: row.terms,
        history: viewer.history,
        rating: viewer.rating,
        explain: false,
      });
      fits[row.fitId] = fit;
    }
    if (!fit.recommended && !row.mayTrend) {
      scored.push(row);
      continue;
    }
    let eligible = joins[row.joinId];
    if (eligible === undefined) {
      const check = joinEligibility({
        profile: viewer.profile,
        connectedPlatforms: viewer.ctx.connectedPlatforms,
        hasSocial: viewer.ctx.hasSocial,
        activeSlots: viewer.activeSlots,
        campaign: row.campaign,
        availableSlots: row.open.slots,
      });
      eligible = campaignFailures(check.failures).length === 0;
      joins[row.joinId] = eligible;
    }
    if (!eligible) {
      scored.push(row);
      continue;
    }
    scored.push({ ...row, eligible: true, recommended: fit.recommended, score: fit.score });
  }
  return scored;
}

// The hostname a clicks campaign sends people to, or null.
function destinationDomainOf(campaign) {
  if (!campaign.destinationUrl) return null;
  try {
    return new URL(campaign.destinationUrl).hostname.replace(/^www\./, "");
  } catch (error) {
    return null;
  }
}

function creatorTermsOf(campaign, terms) {
  const rights = campaign.usageRights;
  return {
    campaignObjective: terms.objective,
    contentDestination: campaign.contentDestination || null,
    destinationDomain: terms.objective === "clicks" ? destinationDomainOf(campaign) : null,
    usageRights: rights && rights.type ? { type: rights.type, version: rights.version || 1, terms: rights.terms || {} } : null,
  };
}

// A marketplace card for a scored campaign. `brand` is { name, avatar } or null.
function cardOf(viewer, scored, brand, { trending = false } = {}) {
  const { campaign, open, terms } = scored;
  const slots = open.slots;
  const eligibleSlot = slots.find((s) => rankAtLeast(viewer.rank, s.rankRequired));
  const matchingSlot = eligibleSlot || slots[0];
  const daysLeft = campaign.endDate ? Math.max(Math.ceil((campaign.endDate - Date.now()) / (1000 * 60 * 60 * 24)), 1) : 7;
  const targeting = campaign.audienceTargeting || {};
  return {
    id: scored.id,
    title: campaign.name,
    category: campaign.category,
    niches: normalizeNiches(campaign.niches),
    reward: matchingSlot.reward,
    creatorPool: campaign.creatorPool,
    viewTarget: matchingSlot.viewTarget,
    slotId: matchingSlot._id,
    rankRequired: matchingSlot.rankRequired,
    rankLocked: !eligibleSlot,
    slotsLeft: open.count,
    targetViews: campaign.targetViews,
    coverImageUrl: campaign.coverImageUrl,
    contentBrief: campaign.contentBrief,
    keyMessageCta: campaign.keyMessageCta,
    platforms: campaign.platforms,
    description: campaign.contentBrief || "",
    minViews: 1000,
    // A referrals-only place (SPEC D31) has no view target to commit to.
    maxViews: matchingSlot.viewTarget > 0 ? matchingSlot.viewTarget : undefined,
    costPerView: campaign.costPerView,
    daysLeft,
    brandName: brand ? brand.name || "Brand" : "Brand",
    brandAvatar: brand ? brand.avatar || null : null,
    // Campaign engine: creator marketplace v2 (tickets 04/05)
    campaignModel: terms.campaignModel,
    payShape: terms.payShape,
    creatorAccess: terms.creatorAccess,
    pay: payPerUnit(campaign, matchingSlot),
    targetPlatforms: targeting.platforms && targeting.platforms.length ? targeting.platforms : campaign.platforms || [],
    targetLocations: targeting.locations || [],
    placesLeft: open.count,
    briefSummary: briefSummary(campaign),
    publishedAt: campaign.createdAt,
    eligible: scored.eligible,
    ineligibleReasons: scored.reasons,
    matchScore: scored.matchScore,
    nicheOverlap: scored.nicheOverlap,
    recommended: scored.recommended,
    // Recommended for You v2 (M8): the score it's ordered by and up to 2 reasons, from the creator's
    // own audience and record only.
    recommendationScore: scored.score,
    why: scored.recommended ? scored.why : [],
    // Trending (ticket 11, v2 M8): different creators who joined or applied in the last 72 hours, and
    // the share of places taken in that time. Counts only, never who.
    recentCreators: scored.recentCreators,
    recentFillShare: Math.round(scored.fillShare * 100) / 100,
    trendScore: scored.trendScore,
    trending,
    // Shown before claiming, so creators know a campaign also pays per referral.
    referralReward:
      campaign.referral &&
      campaign.referral.enabled &&
      campaign.referral.rewardPerConversion > 0 &&
      campaign.referral.poolRemaining >= campaign.referral.rewardPerConversion
        ? { amount: campaign.referral.rewardPerConversion, eventType: campaign.referral.eventType, eventTypes: campaignEventTypes(campaign) }
        : null,
    // M8 batch 7 (SPEC D29, D30): what the objective is, where a clicks link lands (domain only) and
    // the usage terms a creator accepts before joining or applying.
    ...creatorTermsOf(campaign, terms),
  };
}

const PAY_TABS = ["all", "fixed", "performance", "hybrid"];
const SECTIONS = ["recommended", "trending", "new"];

const time = entryTime;
function newestFirst(a, b) {
  if (time(b) !== time(a)) return time(b) - time(a);
  return String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0;
}
const ORDER = { recommended: sortRecommended, trending: sortTrending, new: newestFirst };

// Pure. Scored campaigns → { recommended, trending, new }, each in its order. Trending takes at most
// TRENDING_LIMIT of the eligible, not recommended campaigns (canTrend); New is everything else.
// `newestFirst: true` when `scored` is already newest first.
function sectionsOf(scored, tab = "all", { newestFirst: presorted = false } = {}) {
  const inTab = tab === "all" ? scored : scored.filter((s) => s.terms.payShape === tab);
  const recommended = inTab.filter((s) => s.recommended).sort(sortRecommended);
  const trending = inTab
    .filter((s) => canTrend(s))
    .sort(sortTrending)
    .slice(0, TRENDING_LIMIT);
  const trendingIds = new Set(trending.map((s) => s.id));
  const rest = inTab.filter((s) => !s.recommended && !trendingIds.has(s.id));
  return { recommended, trending, new: presorted ? rest : rest.sort(newestFirst) };
}

// ── Paging ──────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

class MarketplaceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// A cursor is the sort position of the last card on a page, so a campaign that goes live, fills or
// moves never repeats or skips the cards after it: the next page starts after that position in the
// section's current order.
function encodeCursor(section, tab, entry) {
  const position = { s: section, t: tab, p: time(entry), i: entry.id };
  if (section === "recommended") position.r = entry.score;
  if (section === "trending") position.r = entry.trendScore;
  return Buffer.from(JSON.stringify(position)).toString("base64url");
}

function decodeCursor(cursor, section, tab) {
  let position;
  try {
    position = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
  } catch {
    throw new MarketplaceError(400, "INVALID_CURSOR", "This page link has expired. Reload the marketplace.");
  }
  if (!position || position.s !== section || position.t !== tab || typeof position.i !== "string" || typeof position.p !== "number") {
    throw new MarketplaceError(400, "INVALID_CURSOR", "This page link has expired. Reload the marketplace.");
  }
  const at = { id: position.i, publishedAtMs: position.p };
  if (section === "recommended") at.score = Number(position.r) || 0;
  if (section === "trending") at.trendScore = Number(position.r) || 0;
  return at;
}

// Pure. The page of `list` (already in the section's order) after `after` (a decoded cursor or null).
function pageOf(list, section, after, limit) {
  const order = ORDER[section];
  const start = after ? list.findIndex((entry) => order(after, entry) < 0) : 0;
  const from = start === -1 ? list.length : start;
  const items = list.slice(from, from + limit);
  const more = from + limit < list.length;
  return { items, more };
}

function parsePaging({ tab, limit }) {
  const cleanTab = tab === undefined || tab === "" ? "all" : String(tab);
  if (!PAY_TABS.includes(cleanTab)) throw new MarketplaceError(400, "INVALID_TAB", `Tab must be one of ${PAY_TABS.join(", ")}`);
  const size = limit === undefined || limit === "" ? DEFAULT_PAGE_SIZE : Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new MarketplaceError(400, "INVALID_LIMIT", `Limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`);
  }
  return { tab: cleanTab, limit: size };
}

// Scores every open live campaign for the creator. Membership reads the shared snapshots.
// Live campaigns are checked for changes at most once a second per API instance on this path.
const LIVE_CHECK_EVERY_MS = 1000;
// The profile fields the join check, Recommended for You and the page meta read.
const MARKETPLACE_PROFILE_FIELDS = "userId username niches categories audience socialAccounts verifiedAt stats rank badges brandRating";

async function scoreForCreator(userId) {
  // Loaded here, not at the top: creatorDashboard.js requires this file.
  const { loadContext } = require("./creatorDashboard");
  const now = new Date();
  const nowMs = now.getTime();
  const creatorId = toObjectId(userId);
  const [ctx, live] = await Promise.all([
    loadContext(userId, { profileFields: MARKETPLACE_PROFILE_FIELDS, unions: creatorRecordUnions(creatorId) }),
    liveMarketplaceCampaigns({ checkEveryMs: LIVE_CHECK_EVERY_MS }),
  ]);
  const [{ slots, history }, places, interest] = await Promise.all([creatorRecordFrom(ctx.extra, nowMs), sharedPlaces(live), sharedInterest(live, now)]);
  const viewer = viewerOf(ctx, slots, history);
  const scored = classifyBoard(viewer, boardOf(live, places, interest, nowMs));
  return { viewer, scored, places, interest, now: nowMs };
}

// Pages of cards, with places counted now (one query for every page asked for). A campaign that filled
// since the snapshot is left off its page. `pages` is [{ section, tab, list, items, more }].
async function cardPages(state, pages) {
  const all = pages.flatMap((page) => page.items);
  let open = new Map();
  let brandById = new Map();
  if (all.length > 0) {
    const brandIds = [...new Set(all.map((s) => keysOf(s.campaign).brand).filter(Boolean))];
    [open, brandById] = await Promise.all([openPlacesByCampaign(all.map((s) => s.campaign._id)), brandsById(brandIds)]);
  }
  return pages.map(({ section, tab, list, items, more }) => {
    const campaigns = [];
    for (const item of items) {
      const fresh = scoreCampaign(state.viewer, item.campaign, {
        open: open.get(item.id),
        totals: state.places.totals.get(item.id),
        interest: state.interest.get(item.id),
        now: state.now,
      });
      if (!fresh) continue;
      // The card keeps the section and score it was placed with for this page.
      const brand = brandById.get(keysOf(item.campaign).brand) || null;
      campaigns.push(cardOf(state.viewer, { ...fresh, recommended: item.recommended, score: item.score }, brand, { trending: section === "trending" }));
    }
    return {
      campaigns,
      nextCursor: more && items.length ? encodeCursor(section, tab, items[items.length - 1]) : null,
      total: list.length,
    };
  });
}

function pageRequest(lists, section, tab, after, limit) {
  const list = lists[section];
  return { section, tab, list, ...pageOf(list, section, after, limit) };
}

function metaOf(viewer) {
  const ctx = viewer.ctx;
  return {
    activeSlots: viewer.activeSlots,
    maxSlots: MAX_ACTIVE_PLACEMENTS,
    canClaim: ctx.locked ? false : viewer.activeSlots < MAX_ACTIVE_PLACEMENTS,
    locked: ctx.locked,
    lockReason: ctx.lockReason,
  };
}

// The first page of every section for a tab, plus how many campaigns each tab has. `userId` is the creator's.
async function buildMarketplaceSections(userId, query = {}) {
  const { tab, limit } = parsePaging(query);
  const state = await scoreForCreator(userId);
  const lists = sectionsOf(state.scored, tab, { newestFirst: true });
  const tabCounts = { all: state.scored.length, fixed: 0, performance: 0, hybrid: 0 };
  for (const s of state.scored) if (tabCounts[s.terms.payShape] !== undefined) tabCounts[s.terms.payShape] += 1;
  const [recommended, trending, fresh] = await cardPages(state, SECTIONS.map((section) => pageRequest(lists, section, tab, null, limit)));
  return { tab, limit, sections: { recommended, trending, new: fresh }, tabCounts, ...metaOf(state.viewer) };
}

// The next page of one section.
async function buildMarketplaceSection(userId, section, query = {}) {
  if (!SECTIONS.includes(section)) throw new MarketplaceError(404, "UNKNOWN_SECTION", `Section must be one of ${SECTIONS.join(", ")}`);
  const { tab, limit } = parsePaging(query);
  const after = query.cursor ? decodeCursor(query.cursor, section, tab) : null;
  const state = await scoreForCreator(userId);
  const lists = sectionsOf(state.scored, tab, { newestFirst: true });
  const [page] = await cardPages(state, [pageRequest(lists, section, tab, after, limit)]);
  return { section, tab, limit, ...page, ...metaOf(state.viewer) };
}

module.exports = {
  MARKETPLACE_CAMPAIGN_FIELDS,
  liveMarketplaceCampaigns,
  keysOf,
  openPlacesByCampaign,
  placeTotalsByCampaign,
  resetMarketplaceCaches,
  viewerOf,
  scoreCampaign,
  boardOf,
  classifyBoard,
  cardOf,
  sectionsOf,
  SECTION_ORDER: ORDER,
  pageOf,
  encodeCursor,
  decodeCursor,
  buildMarketplaceSections,
  buildMarketplaceSection,
  MarketplaceError,
  PAY_TABS,
  SECTIONS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  creatorTermsOf,
};
