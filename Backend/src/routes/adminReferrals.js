const express = require("express");
const User = require("../models/User");
const BusinessProfile = require("../models/BusinessProfile");
const CreatorProfile = require("../models/CreatorProfile");
const Campaign = require("../models/Campaign");
const ReferralCode = require("../models/ReferralCode");
const ConversionEvent = require("../models/ConversionEvent");
const WebhookKey = require("../models/WebhookKey");
const WebhookDelivery = require("../models/WebhookDelivery");
const Notification = require("../models/Notification");
const { protect, authorizeRoles } = require("../middleware/auth");
const { recordAdminActivity } = require("../services/adminActivity");
const { EVENT_TYPES } = require("../services/conversions");
const { campaignEventTypes } = require("../utils/referralCodes");
const { paging, pageMeta, isObjectId, searchRegex, parseDate, csvCell } = require("../utils/adminQuery");
const {
  payoutStatusOf,
  voidConversion,
  payUnpaidConversions,
  MAX_REWARD_PER_CONVERSION,
} = require("../utils/referralEarnings");

const router = express.Router();

// Every admin role can read referral data. Only admin and super_admin can change it,
// because disabling a code or revoking a key breaks a brand's live integration.
const viewGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
const actGuard = [protect, authorizeRoles("admin", "super_admin")];
// Rewards are money creators earn from the brand's budget, so finance admins set them too.
const rewardGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin")];

const DAY_MS = 24 * 60 * 60 * 1000;
const CSV_MAX_ROWS = 50000;
const FLAG_LIMIT = 50;
// A campaign needs a few days of views before "no conversions" means anything.
const QUIET_CAMPAIGN_MIN_AGE_MS = 3 * DAY_MS;
const HIGH_REJECTION_MIN_REQUESTS = 10;
const HIGH_REJECTION_RATE = 0.5;
const STALE_KEY_MS = 30 * DAY_MS;
// Live referral campaigns our team hasn't set a creator reward for yet.
const NEEDS_REWARD_FILTER = {
  "referral.enabled": true,
  status: { $in: ["live", "paused"] },
  "referral.rewardPerConversion": { $not: { $gt: 0 } },
};
const CONVERSION_NOUNS = { signup: "sign-up", install: "download", purchase: "purchase", deposit: "deposit", custom: "conversion" };

function brandRef(user, fallbackId = null) {
  return user
    ? { id: user._id, name: user.name || null, email: user.email || null }
    : { id: fallbackId, name: null, email: null };
}

function effectiveKeyStatus(key, now) {
  return key.status === "expiring" && (!key.expiresAt || key.expiresAt <= now) ? "expired" : key.status;
}

function countMap(groups, field = "count") {
  return new Map(groups.map((group) => [String(group._id), group[field]]));
}

function requireNote(req, res) {
  const note = String((req.body && req.body.note) || "").trim();
  if (!note) {
    res.status(400).json({ error: "Add a note explaining why. The brand is notified and the note is kept in the activity log." });
    return null;
  }
  return note.slice(0, 1000);
}

async function buildFlags(now) {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const staleBefore = new Date(now.getTime() - STALE_KEY_MS);

  const [quietCampaigns, rejectionGroups, staleKeys] = await Promise.all([
    Campaign.find({
      "referral.enabled": true,
      "referral.conversions": 0,
      viewsDelivered: { $gt: 0 },
      status: { $in: ["live", "paused", "completed"] },
      createdAt: { $lte: new Date(now.getTime() - QUIET_CAMPAIGN_MIN_AGE_MS) },
    })
      .select("name businessId status viewsDelivered createdAt")
      .populate("businessId", "name email")
      .sort({ viewsDelivered: -1 })
      .limit(FLAG_LIMIT)
      .lean(),
    WebhookDelivery.aggregate([
      { $match: { createdAt: { $gte: weekAgo }, source: { $ne: "dashboard_test" } } },
      {
        $group: {
          _id: "$businessId",
          total: { $sum: 1 },
          rejected: { $sum: { $cond: [{ $eq: ["$result", "rejected"] }, 1, 0] } },
        },
      },
      { $match: { total: { $gte: HIGH_REJECTION_MIN_REQUESTS } } },
      { $addFields: { rate: { $divide: ["$rejected", "$total"] } } },
      { $match: { rate: { $gte: HIGH_REJECTION_RATE } } },
      { $sort: { rate: -1, total: -1 } },
      { $limit: FLAG_LIMIT },
    ]),
    WebhookKey.find({
      status: "active",
      $or: [{ lastUsedAt: null, createdAt: { $lte: staleBefore } }, { lastUsedAt: { $lte: staleBefore } }],
    })
      .select("keyId name last4 businessId createdAt lastUsedAt")
      .populate("businessId", "name email")
      .sort({ createdAt: 1 })
      .limit(FLAG_LIMIT)
      .lean(),
  ]);

  const rejectionUsers = await User.find({ _id: { $in: rejectionGroups.map((group) => group._id) } })
    .select("name email")
    .lean();
  const userById = new Map(rejectionUsers.map((user) => [String(user._id), user]));

  return {
    campaignsWithoutConversions: quietCampaigns.map((campaign) => ({
      campaignId: campaign._id,
      name: campaign.name,
      status: campaign.status,
      viewsDelivered: campaign.viewsDelivered,
      createdAt: campaign.createdAt,
      brand: brandRef(campaign.businessId),
    })),
    brandsWithHighRejections: rejectionGroups.map((group) => ({
      brand: brandRef(userById.get(String(group._id)), group._id),
      requests: group.total,
      rejected: group.rejected,
      rejectionRate: Math.round(group.rate * 1000) / 1000,
    })),
    staleKeys: staleKeys.map((key) => ({
      id: key._id,
      keyId: key.keyId,
      name: key.name || "",
      last4: key.last4,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      brand: brandRef(key.businessId),
    })),
  };
}

// ─── GET /api/admin/referrals/stats ───────────────────────────────────────────
router.get("/stats", viewGuard, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const liveRequests = { createdAt: { $gte: dayAgo }, source: { $ne: "dashboard_test" } };

    const [
      brandsConnected,
      activeKeys,
      campaignsTracking,
      totalCodes,
      activeCodes,
      conversionsToday,
      conversions7d,
      conversionsAll,
      requests24h,
      rejected24h,
      flags,
    ] = await Promise.all([
      BusinessProfile.countDocuments({ referralConnectedAt: { $ne: null } }),
      WebhookKey.countDocuments({ $or: [{ status: "active" }, { status: "expiring", expiresAt: { $gt: now } }] }),
      Campaign.countDocuments({ "referral.enabled": true }),
      ReferralCode.countDocuments({}),
      ReferralCode.countDocuments({ status: "active" }),
      ConversionEvent.countDocuments({ createdAt: { $gte: startOfToday } }),
      ConversionEvent.countDocuments({ createdAt: { $gte: weekAgo } }),
      ConversionEvent.estimatedDocumentCount(),
      WebhookDelivery.countDocuments(liveRequests),
      WebhookDelivery.countDocuments({ ...liveRequests, result: "rejected" }),
      buildFlags(now),
    ]);

    const [budgetGroup] = await Campaign.aggregate([
      { $match: { "referral.budget": { $gt: 0 } } },
      {
        $group: {
          _id: null,
          funded: { $sum: "$referral.budget" },
          platformFee: { $sum: "$referral.platformFee" },
          earnedByCreators: { $sum: "$referral.earned" },
          remaining: { $sum: "$referral.poolRemaining" },
        },
      },
    ]);
    const campaignsNeedingReward = await Campaign.countDocuments(NEEDS_REWARD_FILTER);
    const round = (value) => Math.round((value || 0) * 100) / 100;
    const budgetTotals = {
      funded: round(budgetGroup && budgetGroup.funded),
      platformFee: round(budgetGroup && budgetGroup.platformFee),
      earnedByCreators: round(budgetGroup && budgetGroup.earnedByCreators),
      remaining: round(budgetGroup && budgetGroup.remaining),
    };

    res.json({
      brandsConnected,
      activeKeys,
      campaignsTracking,
      campaignsNeedingReward,
      codes: { total: totalCodes, active: activeCodes },
      conversions: { today: conversionsToday, last7Days: conversions7d, allTime: conversionsAll },
      requests: { last24h: requests24h, rejectedLast24h: rejected24h },
      referralBudget: budgetTotals,
      flagCounts: {
        campaignsWithoutConversions: flags.campaignsWithoutConversions.length,
        brandsWithHighRejections: flags.brandsWithHighRejections.length,
        staleKeys: flags.staleKeys.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/flags ───────────────────────────────────────────
router.get("/flags", viewGuard, async (req, res, next) => {
  try {
    res.json(await buildFlags(new Date()));
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/brands ──────────────────────────────────────────
// Brands with any referral footprint: a key, a connection or a tracked campaign.
router.get("/brands", viewGuard, async (req, res, next) => {
  try {
    const pageOptions = paging(req.query);
    const [keyBrands, campaignBrands, connectedProfiles] = await Promise.all([
      WebhookKey.distinct("businessId"),
      Campaign.distinct("businessId", { "referral.enabled": true }),
      BusinessProfile.find({ referralConnectedAt: { $ne: null } }).select("userId").lean(),
    ]);
    const brandIds = [
      ...new Map(
        [...keyBrands, ...campaignBrands, ...connectedProfiles.map((profile) => profile.userId)].map((id) => [String(id), id])
      ).values(),
    ];

    const filter = { _id: { $in: brandIds }, role: "business" };
    const rx = searchRegex(req.query.q);
    if (rx) {
      const profileMatches = await BusinessProfile.find({ companyName: rx }).select("userId").lean();
      filter.$or = [{ name: rx }, { email: rx }, { _id: { $in: profileMatches.map((profile) => profile.userId) } }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select("name email isActive createdAt")
        .sort({ createdAt: -1 })
        .skip(pageOptions.skip)
        .limit(pageOptions.limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const pageIds = users.map((user) => user._id);
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    const inPage = { $in: pageIds };

    const [profiles, keyGroups, campaignGroups, codeGroups, conversionGroups, recentConversionGroups, deliveryGroups] =
      await Promise.all([
        BusinessProfile.find({ userId: inPage }).select("userId companyName referralConnectedAt").lean(),
        WebhookKey.aggregate([
          { $match: { businessId: inPage } },
          {
            $group: {
              _id: "$businessId",
              active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
              lastUsedAt: { $max: "$lastUsedAt" },
            },
          },
        ]),
        Campaign.aggregate([
          { $match: { businessId: inPage, "referral.enabled": true } },
          { $group: { _id: "$businessId", count: { $sum: 1 } } },
        ]),
        ReferralCode.aggregate([{ $match: { businessId: inPage } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
        ConversionEvent.aggregate([{ $match: { businessId: inPage } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
        ConversionEvent.aggregate([
          { $match: { businessId: inPage, createdAt: { $gte: weekAgo } } },
          { $group: { _id: "$businessId", count: { $sum: 1 } } },
        ]),
        WebhookDelivery.aggregate([
          { $match: { businessId: inPage, createdAt: { $gte: weekAgo }, source: { $ne: "dashboard_test" } } },
          {
            $group: {
              _id: "$businessId",
              total: { $sum: 1 },
              rejected: { $sum: { $cond: [{ $eq: ["$result", "rejected"] }, 1, 0] } },
              lastAt: { $max: "$createdAt" },
            },
          },
        ]),
      ]);

    const profileByUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    const keysByBrand = new Map(keyGroups.map((group) => [String(group._id), group]));
    const deliveriesByBrand = new Map(deliveryGroups.map((group) => [String(group._id), group]));
    const campaignsByBrand = countMap(campaignGroups);
    const codesByBrand = countMap(codeGroups);
    const conversionsByBrand = countMap(conversionGroups);
    const recentConversionsByBrand = countMap(recentConversionGroups);

    res.json({
      brands: users.map((user) => {
        const key = String(user._id);
        const profile = profileByUser.get(key);
        const keys = keysByBrand.get(key);
        const deliveries = deliveriesByBrand.get(key);
        const lastRequestAt = [keys && keys.lastUsedAt, deliveries && deliveries.lastAt]
          .filter(Boolean)
          .sort((a, b) => b - a)[0] || null;
        return {
          id: user._id,
          name: user.name,
          email: user.email,
          isActive: user.isActive,
          companyName: profile ? profile.companyName : null,
          connectedAt: profile ? profile.referralConnectedAt : null,
          activeKeys: keys ? keys.active : 0,
          lastRequestAt,
          campaignsTracking: campaignsByBrand.get(key) || 0,
          codes: codesByBrand.get(key) || 0,
          conversions: { allTime: conversionsByBrand.get(key) || 0, last7Days: recentConversionsByBrand.get(key) || 0 },
          requests7d: deliveries ? deliveries.total : 0,
          rejected7d: deliveries ? deliveries.rejected : 0,
          rejectionRate7d: deliveries && deliveries.total ? Math.round((deliveries.rejected / deliveries.total) * 1000) / 1000 : null,
        };
      }),
      ...pageMeta(total, pageOptions),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/brands/:id ──────────────────────────────────────
router.get("/brands/:id", viewGuard, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Brand not found" });
    const user = await User.findOne({ _id: req.params.id, role: "business" }).select("name email isActive").lean();
    if (!user) return res.status(404).json({ error: "Brand not found" });

    const now = new Date();
    const [profile, keys, campaigns, deliveries] = await Promise.all([
      BusinessProfile.findOne({ userId: user._id }).select("companyName referralConnectedAt").lean(),
      WebhookKey.find({ businessId: user._id }).select("-secretEncrypted").sort({ createdAt: -1 }).lean(),
      Campaign.find({ businessId: user._id, "referral.enabled": true })
        .select("name status referral viewsDelivered")
        .sort({ createdAt: -1 })
        .lean(),
      WebhookDelivery.find({ businessId: user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    res.json({
      brand: {
        id: user._id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        companyName: profile ? profile.companyName : null,
        connectedAt: profile ? profile.referralConnectedAt : null,
      },
      keys: keys.map((key) => ({
        id: key._id,
        keyId: key.keyId,
        name: key.name || "",
        last4: key.last4,
        status: effectiveKeyStatus(key, now),
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
      })),
      campaigns: campaigns.map((campaign) => ({
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        eventType: campaign.referral.eventType,
        eventTypes: campaignEventTypes(campaign),
        codeSource: campaign.referral.codeSource,
        conversions: campaign.referral.conversions,
        viewsDelivered: campaign.viewsDelivered,
      })),
      recentRequests: deliveries.map((delivery) => ({
        id: delivery._id,
        createdAt: delivery.createdAt,
        source: delivery.source,
        statusCode: delivery.statusCode,
        result: delivery.result,
        error: delivery.error,
        code: delivery.code,
        eventType: delivery.eventType,
        eventId: delivery.eventId,
        keyId: delivery.keyId,
        keyName: (delivery.keyId && (keys.find((key) => key.keyId === delivery.keyId) || {}).name) || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/campaigns ───────────────────────────────────────
router.get("/campaigns", viewGuard, async (req, res, next) => {
  try {
    const pageOptions = paging(req.query);
    const filter = { "referral.enabled": true };
    if (req.query.status && req.query.status !== "all") filter.status = String(req.query.status);
    if (isObjectId(req.query.brandId)) filter.businessId = req.query.brandId;
    const rx = searchRegex(req.query.q);
    if (rx) filter.name = rx;
    if (req.query.needsReward === "1") Object.assign(filter, NEEDS_REWARD_FILTER);

    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .select("name status businessId referral viewsDelivered targetViews createdAt")
        .populate("businessId", "name email")
        .sort({ createdAt: -1 })
        .skip(pageOptions.skip)
        .limit(pageOptions.limit)
        .lean(),
      Campaign.countDocuments(filter),
    ]);

    const codeGroups = await ReferralCode.aggregate([
      { $match: { campaignId: { $in: campaigns.map((campaign) => campaign._id) } } },
      {
        $group: {
          _id: "$campaignId",
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        },
      },
    ]);
    const codesByCampaign = new Map(codeGroups.map((group) => [String(group._id), group]));
    // Sign-ups recorded while there was no reward; they're paid when admin sets one.
    const unpaidGroups = await ConversionEvent.aggregate([
      {
        $match: {
          campaignId: { $in: campaigns.map((campaign) => campaign._id) },
          unpaidReason: "rate_not_set",
          voidedAt: null,
        },
      },
      { $group: { _id: "$campaignId", count: { $sum: 1 } } },
    ]);
    const unpaidByCampaign = countMap(unpaidGroups);

    res.json({
      campaigns: campaigns.map((campaign) => {
        const codes = codesByCampaign.get(String(campaign._id));
        return {
          id: campaign._id,
          name: campaign.name,
          status: campaign.status,
          brand: brandRef(campaign.businessId),
          eventType: campaign.referral.eventType,
          eventTypes: campaignEventTypes(campaign),
          codeSource: campaign.referral.codeSource,
          conversions: campaign.referral.conversions,
          rewardPerConversion: campaign.referral.rewardPerConversion || 0,
          needsReward: ["live", "paused"].includes(campaign.status) && !(campaign.referral.rewardPerConversion > 0),
          unpaidConversions: unpaidByCampaign.get(String(campaign._id)) || 0,
          pool: campaign.referral.pool || 0,
          platformFee: campaign.referral.platformFee || 0,
          referralBudget: campaign.referral.budget || 0,
          earnedByCreators: campaign.referral.earned || 0,
          poolRemaining: campaign.referral.poolRemaining || 0,
          viewsDelivered: campaign.viewsDelivered,
          targetViews: campaign.targetViews,
          codes: codes ? codes.total : 0,
          activeCodes: codes ? codes.active : 0,
          createdAt: campaign.createdAt,
        };
      }),
      ...pageMeta(total, pageOptions),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/campaigns/:id/codes ─────────────────────────────
router.get("/campaigns/:id/codes", viewGuard, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
    const campaign = await Campaign.findById(req.params.id).select("name businessId referral").lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const codes = await ReferralCode.find({ campaignId: campaign._id }).sort({ conversions: -1, createdAt: 1 }).lean();
    const creatorIds = codes.map((code) => code.creatorId);
    const [profiles, users, lastConversions] = await Promise.all([
      CreatorProfile.find({ userId: { $in: creatorIds } }).select("userId username displayName").lean(),
      User.find({ _id: { $in: creatorIds } }).select("name").lean(),
      ConversionEvent.aggregate([
        { $match: { campaignId: campaign._id } },
        {
          $group: {
            _id: "$referralCodeId",
            lastAt: { $max: "$createdAt" },
            earned: {
              $sum: {
                $cond: [{ $and: [{ $gt: ["$rewardAmount", 0] }, { $eq: [{ $ifNull: ["$voidedAt", null] }, null] }] }, "$rewardAmount", 0],
              },
            },
          },
        },
      ]),
    ]);
    const earnedByCode = countMap(lastConversions, "earned");
    const profileByUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const lastByCode = countMap(lastConversions, "lastAt");

    res.json({
      campaign: { id: campaign._id, name: campaign.name, eventType: campaign.referral ? campaign.referral.eventType : null, eventTypes: campaign.referral ? campaignEventTypes(campaign) : [] },
      codes: codes.map((code) => {
        const profile = profileByUser.get(String(code.creatorId));
        const user = userById.get(String(code.creatorId));
        return {
          id: code._id,
          code: code.code,
          status: code.status,
          source: code.source,
          conversions: code.conversions,
          creator: {
            id: code.creatorId,
            username: profile ? profile.username : null,
            name: (profile && profile.displayName) || (user && user.name) || null,
          },
          lastConversionAt: lastByCode.get(String(code._id)) || null,
          earned: Math.round((earnedByCode.get(String(code._id)) || 0) * 100) / 100,
          createdAt: code.createdAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

async function conversionFilter(query) {
  const filter = {};
  if (isObjectId(query.brandId)) filter.businessId = query.brandId;
  if (isObjectId(query.campaignId)) filter.campaignId = query.campaignId;
  if (isObjectId(query.creatorId)) filter.creatorId = query.creatorId;
  if (EVENT_TYPES.includes(query.eventType)) filter.eventType = query.eventType;

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = from;
    // A bare date means "up to the end of that day".
    if (to) filter.occurredAt.$lte = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to)) ? new Date(to.getTime() + DAY_MS - 1) : to;
  }

  const code = String(query.code || "").trim().toUpperCase();
  if (code) {
    const codeIds = await ReferralCode.find({ code }).distinct("_id");
    filter.referralCodeId = { $in: codeIds };
  }
  return filter;
}

async function hydrateConversions(events) {
  const ids = (field) => [...new Set(events.map((event) => String(event[field])))];
  const [campaigns, brands, creators, profiles, codes] = await Promise.all([
    Campaign.find({ _id: { $in: ids("campaignId") } }).select("name referral").lean(),
    User.find({ _id: { $in: ids("businessId") } }).select("name").lean(),
    User.find({ _id: { $in: ids("creatorId") } }).select("name").lean(),
    CreatorProfile.find({ userId: { $in: ids("creatorId") } }).select("userId username").lean(),
    ReferralCode.find({ _id: { $in: ids("referralCodeId") } }).select("code").lean(),
  ]);
  const byId = (docs, key = "_id") => new Map(docs.map((doc) => [String(doc[key]), doc]));
  const campaignById = byId(campaigns);
  const brandById = byId(brands);
  const creatorById = byId(creators);
  const profileByUser = byId(profiles, "userId");
  const codeById = byId(codes);

  const now = new Date();
  return events.map((event) => {
    const campaign = campaignById.get(String(event.campaignId));
    const brand = brandById.get(String(event.businessId));
    const creator = creatorById.get(String(event.creatorId));
    const profile = profileByUser.get(String(event.creatorId));
    const code = codeById.get(String(event.referralCodeId));
    return {
      id: event._id,
      occurredAt: event.occurredAt,
      receivedAt: event.createdAt,
      eventId: event.eventId,
      eventType: event.eventType,
      // Stored at record time; events from before that fall back to the campaign's current type.
      counted:
        typeof event.counted === "boolean"
          ? event.counted
          : Boolean(campaign && campaign.referral && campaignEventTypes(campaign).includes(event.eventType)),
      rewardAmount: event.rewardAmount || 0,
      unpaidReason: event.unpaidReason || null,
      availableAt: event.availableAt || null,
      voidedAt: event.voidedAt || null,
      voidedReason: event.voidedReason || null,
      payoutStatus: payoutStatusOf(event, now),
      code: code ? code.code : null,
      brand: { id: event.businessId, name: brand ? brand.name : null },
      campaign: { id: event.campaignId, name: campaign ? campaign.name : null },
      creator: { id: event.creatorId, username: profile ? profile.username : null, name: creator ? creator.name : null },
    };
  });
}

// ─── GET /api/admin/referrals/conversions ─────────────────────────────────────
router.get("/conversions", viewGuard, async (req, res, next) => {
  try {
    const pageOptions = paging(req.query, 50);
    const filter = await conversionFilter(req.query);
    const [events, total] = await Promise.all([
      ConversionEvent.find(filter).sort({ occurredAt: -1 }).skip(pageOptions.skip).limit(pageOptions.limit).lean(),
      ConversionEvent.countDocuments(filter),
    ]);
    res.json({ conversions: await hydrateConversions(events), ...pageMeta(total, pageOptions) });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/referrals/conversions.csv ─────────────────────────────────
router.get("/conversions.csv", viewGuard, async (req, res, next) => {
  try {
    const filter = await conversionFilter(req.query);
    const events = await ConversionEvent.find(filter).sort({ occurredAt: -1 }).limit(CSV_MAX_ROWS).lean();
    const rows = await hydrateConversions(events);

    const lines = [
      "occurred_at,received_at,brand,campaign,creator_username,code,event,counted,event_id,reward_ngn,payout_status",
      ...rows.map((row) =>
        [
          row.occurredAt && new Date(row.occurredAt).toISOString(),
          row.receivedAt && new Date(row.receivedAt).toISOString(),
          row.brand.name,
          row.campaign.name,
          row.creator.username,
          row.code,
          row.eventType,
          row.counted ? "yes" : "no",
          row.eventId,
          row.rewardAmount,
          row.payoutStatus,
        ]
          .map(csvCell)
          .join(",")
      ),
    ];

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="referral-conversions-${stamp}.csv"`);
    res.send(`${lines.join("\n")}\n`);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/referrals/conversions/:id/void ───────────────────────────
// Voids a fake or reversed conversion while its earnings are still on hold.
router.post("/conversions/:id/void", actGuard, async (req, res, next) => {
  try {
    const note = requireNote(req, res);
    if (!note) return;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Conversion not found" });

    const result = await voidConversion(req.params.id, { reason: note, voidedBy: req.user._id });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    const { event, campaign, refundedToPool } = result;
    const code = await ReferralCode.findById(event.referralCodeId).select("code").lean();

    await Notification.create({
      creatorId: event.creatorId,
      campaignId: event.campaignId,
      type: "referral_conversion_voided",
      title: "A referral conversion was voided",
      body: `A ${event.eventType} on your code ${code ? code.code : ""}${campaign ? ` for "${campaign.name}"` : ""} was voided after review${
        refundedToPool > 0 ? `, so its ₦${refundedToPool.toLocaleString()} reward was removed from your pending earnings` : ""
      }. Note: ${note}`,
    });

    await recordAdminActivity(req, {
      action: "conversion.voided",
      targetType: "conversion",
      targetId: event._id,
      targetLabel: `${code ? code.code : "Conversion"} · ${event.eventId}`,
      businessId: event.businessId,
      note,
      metadata: { amount: refundedToPool, eventType: event.eventType, creatorId: event.creatorId, campaignId: event.campaignId },
    });

    res.json({ success: true, conversion: { id: event._id, voided: true, refundedToPool } });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/referrals/codes/:id/status ──────────────────────────────
router.patch("/codes/:id/status", actGuard, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!["active", "disabled"].includes(status)) {
      return res.status(400).json({ error: "Status must be active or disabled" });
    }
    const note = requireNote(req, res);
    if (!note) return;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Referral code not found" });

    const code = await ReferralCode.findById(req.params.id);
    if (!code) return res.status(404).json({ error: "Referral code not found" });
    if (code.status === status) {
      return res.status(409).json({ error: `This code is already ${status}` });
    }

    const previousStatus = code.status;
    code.status = status;
    await code.save();

    const campaign = await Campaign.findById(code.campaignId).select("name").lean();
    const disabled = status === "disabled";
    await Notification.create({
      businessId: code.businessId,
      campaignId: code.campaignId,
      type: disabled ? "referral_code_disabled" : "referral_code_enabled",
      title: disabled ? "Referral code disabled" : "Referral code re-enabled",
      body: `Easily Promote ${disabled ? "disabled" : "re-enabled"} the code ${code.code}${
        campaign ? ` on "${campaign.name}"` : ""
      }. ${disabled ? "Checks and conversions with it are now rejected." : "It works again."} Note: ${note}`,
    });

    await recordAdminActivity(req, {
      action: disabled ? "referral_code.disabled" : "referral_code.enabled",
      targetType: "referral_code",
      targetId: code._id,
      targetLabel: code.code,
      businessId: code.businessId,
      note,
      metadata: { from: previousStatus, to: status, campaignId: code.campaignId, campaignName: campaign ? campaign.name : null },
    });

    res.json({ success: true, code: { id: code._id, code: code.code, status: code.status } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/referrals/keys/:id/revoke ────────────────────────────────
router.post("/keys/:id/revoke", actGuard, async (req, res, next) => {
  try {
    const note = requireNote(req, res);
    if (!note) return;
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Signing key not found" });

    const key = await WebhookKey.findById(req.params.id);
    if (!key) return res.status(404).json({ error: "Signing key not found" });
    if (key.status === "revoked") {
      return res.status(409).json({ error: "This key is already revoked" });
    }

    const previousStatus = key.status;
    key.status = "revoked";
    await key.save();

    await Notification.create({
      businessId: key.businessId,
      type: "webhook_key_revoked",
      title: "Signing key revoked",
      body: `Easily Promote revoked your signing key ${key.name ? `"${key.name}" (${key.keyId})` : key.keyId}. Requests signed with it are now rejected — generate a new key in Referral tracking settings. Note: ${note}`,
    });

    await recordAdminActivity(req, {
      action: "webhook_key.revoked",
      targetType: "webhook_key",
      targetId: key._id,
      targetLabel: key.keyId,
      businessId: key.businessId,
      note,
      metadata: { from: previousStatus, to: "revoked" },
    });

    res.json({ success: true, key: { id: key._id, keyId: key.keyId, status: key.status } });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/referrals/campaigns/:id/reward ──────────────────────────
// Brands fund the referral budget; our team decides what creators earn per conversion.
router.patch("/campaigns/:id/reward", rewardGuard, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
    const amount = Math.round(Number(req.body && req.body.rewardPerConversion) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_REWARD_PER_CONVERSION) {
      return res.status(400).json({ error: `Enter a reward between ₦1 and ₦${MAX_REWARD_PER_CONVERSION.toLocaleString()}` });
    }

    const campaign = await Campaign.findById(req.params.id).select("name businessId status referral rateAuthority");
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    // Admin sets rewards only where admin is the rate authority (ADR 0003); campaigns from
    // before the campaign engine have no rateAuthority and are referral campaigns if enabled.
    if (campaign.rateAuthority && campaign.rateAuthority !== "admin") {
      return res.status(409).json({
        error: "This campaign's creator rate isn't set by our team",
        code: "RATE_NOT_ADMIN_SET",
      });
    }
    if (!(campaign.referral && campaign.referral.enabled)) {
      return res.status(400).json({ error: "Referral tracking isn't on for this campaign" });
    }
    if (campaign.status === "cancelled") {
      return res.status(400).json({ error: "This campaign is cancelled" });
    }

    const previous = campaign.referral.rewardPerConversion || 0;
    const note = String((req.body && req.body.note) || "").trim().slice(0, 1000) || null;
    await Campaign.updateOne({ _id: campaign._id }, { $set: { "referral.rewardPerConversion": amount } });

    // The first reward also pays conversions recorded while there wasn't one. Later
    // changes apply to new conversions only; each keeps what it earned.
    const backPay = previous > 0 ? { paid: 0, unpaid: 0 } : await payUnpaidConversions(campaign._id);

    const types = campaignEventTypes(campaign);
    const noun = types.length === 1 ? CONVERSION_NOUNS[types[0]] || "conversion" : "conversion";
    const reward = `₦${amount.toLocaleString()}`;
    const creatorIds = await ReferralCode.distinct("creatorId", { campaignId: campaign._id });
    await Notification.insertMany([
      {
        businessId: campaign.businessId,
        campaignId: campaign._id,
        type: "referral_reward",
        title: previous > 0 ? "Creator reward updated" : "Creator reward set",
        body: `Creators on "${campaign.name}" now earn ${reward} per ${noun} from your referral budget.`,
      },
      ...creatorIds.map((creatorId) => ({
        creatorId,
        campaignId: campaign._id,
        type: "referral_reward",
        title: previous > 0 ? "Referral reward updated" : "Your referral code is earning",
        body: `Your code on "${campaign.name}" now earns ${reward} per ${noun}.`,
      })),
    ]);

    await recordAdminActivity(req, {
      action: previous > 0 ? "referral.reward_changed" : "referral.reward_set",
      targetType: "campaign",
      targetId: campaign._id,
      targetLabel: campaign.name,
      businessId: campaign.businessId,
      note,
      metadata: { from: previous, to: amount, paidEarlierConversions: backPay.paid, stillUnpaid: backPay.unpaid },
    });

    const updated = await Campaign.findById(campaign._id).select("referral").lean();
    res.json({
      rewardPerConversion: amount,
      previous,
      paidEarlierConversions: backPay.paid,
      stillUnpaid: backPay.unpaid,
      poolRemaining: (updated.referral && updated.referral.poolRemaining) || 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
