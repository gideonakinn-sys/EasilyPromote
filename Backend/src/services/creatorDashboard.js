const CreatorProfile = require("../models/CreatorProfile");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const meta = require("./meta");
const { rankAtLeast } = require("./creatorScore");
const { listEventsForSubmissions, labelFor } = require("./submissionEvents");
const { timeAgo } = require("../utils/timeAgo");

// Everything the creator dashboard shows is derived from the same handful of
// documents. Loading them once per request (instead of once per endpoint, and
// again inside every helper) is where most of the round trips went.

const MAX_SLOTS = 3;
const ACTIVE_SLOT_STATUSES = ["claimed", "submitted", "verifying"];
const CLAIMED_SLOT_STATUSES = ["claimed", "submitted", "verifying", "approved", "paid"];

function lockReasonFor({ hasSocial, hasNiches }) {
  if (hasSocial && hasNiches) return null;
  return hasSocial && !hasNiches
    ? "Choose your niches to unlock campaigns"
    : "Connect a social account to unlock campaigns";
}

// Profile + social connections, fetched in parallel. Shared by every builder below.
async function loadContext(userId) {
  const [profile, tiktok, metaConnections] = await Promise.all([
    CreatorProfile.findOne({ userId }).lean(),
    TikTokConnection.findOne({ userId }).lean(),
    MetaConnection.find({ userId }).lean(),
  ]);

  const niches = Array.isArray(profile && profile.niches) ? profile.niches : [];
  const hasSocial = Boolean(tiktok || metaConnections.length > 0);
  const hasNiches = niches.length > 0;
  const lockReason = lockReasonFor({ hasSocial, hasNiches });

  return {
    userId,
    profile,
    tiktok,
    metaConnections,
    hasSocial,
    hasNiches,
    locked: lockReason !== null,
    lockReason,
  };
}

function buildProfile(user, ctx) {
  const profile = ctx.profile;
  if (!profile) return null;
  return {
    name: user.name,
    avatar: user.avatar || null,
    displayName: profile.displayName || user.name,
    username: profile.username,
    bio: profile.bio || "",
    country: profile.country || "",
    socialAccounts: profile.socialAccounts || [],
    niches: profile.niches || [],
    rank: profile.rank,
    creatorScore: profile.creatorScore,
    verifiedViews: profile.verifiedViews,
    lifetimeEarnings: profile.lifetimeEarnings,
    completionRate: profile.completionRate,
  };
}

function buildTikTokStatus(ctx) {
  const connection = ctx.tiktok;
  if (!connection) return { connected: false };
  return {
    connected: true,
    openId: connection.openId,
    username: connection.username,
    displayName: connection.displayName,
    avatarUrl: connection.avatarUrl,
    scopes: connection.scopes,
    expiresAt: connection.expiresAt,
    connectedAt: connection.connectedAt,
  };
}

function buildMetaStatus(ctx) {
  const byProvider = {};
  for (const c of ctx.metaConnections) {
    byProvider[c.provider] = {
      connected: true,
      username: c.username,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      scopes: c.scopes,
      expiresAt: c.expiresAt,
      connectedAt: c.connectedAt,
      pages: (c.pages || []).map((p) => ({ pageId: p.pageId, name: p.name, igBusinessId: p.igBusinessId })),
    };
  }
  // `configured` tells the UI whether this deployment has app credentials for
  // the provider at all, so it can hide a button that could only ever fail.
  return {
    instagram: {
      ...(byProvider.instagram || { connected: false }),
      configured: meta.isProviderConfigured("instagram"),
    },
    facebook: {
      ...(byProvider.facebook || { connected: false }),
      configured: meta.isProviderConfigured("facebook"),
    },
  };
}

function normalizeNiches(list) {
  return (Array.isArray(list) ? list : [])
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean);
}

async function buildMarketplace(ctx) {
  const { userId, profile } = ctx;
  const creatorRank = profile ? profile.rank : "rank1";
  const profileNiches = normalizeNiches(profile && profile.niches);

  const [activeSlots, claimedCampaignIds, campaigns] = await Promise.all([
    Slot.countDocuments({ creatorId: userId, status: { $in: ACTIVE_SLOT_STATUSES } }),
    Slot.distinct("campaignId", { creatorId: userId, status: { $in: CLAIMED_SLOT_STATUSES } }),
    Campaign.find({ status: "live" })
      .populate("businessId", "name avatar")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const claimedCampaignSet = new Set(claimedCampaignIds.map((id) => id.toString()));
  const openCampaigns = campaigns.filter((c) => !claimedCampaignSet.has(c._id.toString()));

  // One query for every campaign's open slots, instead of one query per campaign.
  const availableSlots = openCampaigns.length > 0
    ? await Slot.find({
        campaignId: { $in: openCampaigns.map((c) => c._id) },
        status: "available",
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const slotsByCampaign = new Map();
  for (const slot of availableSlots) {
    const key = slot.campaignId.toString();
    if (!slotsByCampaign.has(key)) slotsByCampaign.set(key, []);
    slotsByCampaign.get(key).push(slot);
  }

  const marketplace = [];
  for (const campaign of openCampaigns) {
    const slots = slotsByCampaign.get(campaign._id.toString()) || [];
    if (slots.length === 0) continue;

    const eligibleSlot = slots.find((s) => rankAtLeast(creatorRank, s.rankRequired));
    const matchingSlot = eligibleSlot || slots[0];
    const rankLocked = !eligibleSlot;

    const daysLeft = campaign.endDate
      ? Math.max(Math.ceil((campaign.endDate - Date.now()) / (1000 * 60 * 60 * 24)), 1)
      : 7;
    const brand = campaign.businessId;
    const campaignNiches = normalizeNiches(campaign.niches);

    let matchScore = 0;
    if (profileNiches.length > 0) {
      const overlap = campaignNiches.filter((n) => profileNiches.includes(n)).length;
      matchScore += overlap * 3;
      if (campaign.category && profileNiches.includes(String(campaign.category).trim().toLowerCase())) {
        matchScore += 2;
      }
      if (campaignNiches.length === 0) matchScore += 1;
    }

    marketplace.push({
      id: campaign._id,
      title: campaign.name,
      category: campaign.category,
      niches: campaignNiches,
      reward: matchingSlot.reward,
      creatorPool: campaign.creatorPool,
      viewTarget: matchingSlot.viewTarget,
      slotId: matchingSlot._id,
      rankRequired: matchingSlot.rankRequired,
      rankLocked,
      slotsLeft: slots.length,
      targetViews: campaign.targetViews,
      coverImageUrl: campaign.coverImageUrl,
      contentBrief: campaign.contentBrief,
      keyMessageCta: campaign.keyMessageCta,
      platforms: campaign.platforms,
      description: campaign.contentBrief || "",
      minViews: 1000,
      maxViews: matchingSlot.viewTarget,
      costPerView: campaign.costPerView,
      daysLeft,
      brandName: brand ? brand.name || "Brand" : "Brand",
      brandAvatar: brand ? brand.avatar || null : null,
      matchScore,
      recommended: matchScore > 0,
    });
  }

  marketplace.sort((a, b) => {
    if (b.recommended !== a.recommended) return b.recommended - a.recommended;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return b.slotsLeft - a.slotsLeft;
  });

  return {
    campaigns: marketplace,
    activeSlots,
    maxSlots: MAX_SLOTS,
    canClaim: ctx.locked ? false : activeSlots < MAX_SLOTS,
    locked: ctx.locked,
    lockReason: ctx.lockReason,
  };
}

// Newest submission first; a later (older) one never overrides it.
function indexSubmissionsByCampaign(submissions) {
  const map = {};
  for (const sub of submissions) {
    const key = sub.campaignId.toString();
    if (!map[key]) map[key] = sub;
  }
  return map;
}

async function buildMyCampaigns(ctx) {
  const { userId } = ctx;

  const [slots, submissions] = await Promise.all([
    Slot.find({ creatorId: userId })
      .populate({
        path: "campaignId",
        select: "name category status coverImageUrl contentBrief keyMessageCta whatToAvoid goal competitors uniqueSellingPoint funFact platforms contentStyle startDate endDate targetViews viewsDelivered costPerView scriptUrl scriptFileName businessId",
        populate: { path: "businessId", select: "name avatar" },
      })
      .sort({ createdAt: -1 })
      .lean(),
    Submission.find({ creatorId: userId }).sort({ createdAt: -1 }).lean(),
  ]);

  const submissionMap = indexSubmissionsByCampaign(submissions);

  // Newest first, matching how the drawer stacks its activity list.
  const eventsBySubmission = {};
  if (submissions.length > 0) {
    const events = await listEventsForSubmissions(submissions.map((s) => s._id));
    for (const event of events) {
      const key = event.submissionId.toString();
      if (!eventsBySubmission[key]) eventsBySubmission[key] = [];
      eventsBySubmission[key].unshift({
        id: event._id,
        type: event.type,
        label: labelFor(event.type),
        actor: event.actor,
        actorName: event.actorName,
        reason: event.reason,
        statusAfter: event.statusAfter,
        metadata: event.metadata,
        at: event.createdAt,
        time: timeAgo(event.createdAt),
      });
    }
  }

  const campaigns = slots
    .filter((slot) => slot.campaignId)
    .map((slot) => {
      const campaign = slot.campaignId;
      const submission = submissionMap[campaign._id.toString()];

      let status;
      if (submission) {
        switch (submission.status) {
          case "new":
            status = "under_review";
            break;
          case "awaiting_post":
          case "approved":
            status = "approved_post";
            break;
          case "posted":
            status = submission.viewsDelivered >= campaign.targetViews ? "delivered" : "live_tracking";
            break;
          case "rejected":
            status = "changes_requested";
            break;
          default:
            status = "under_review";
        }
      } else {
        status = "needs_content";
      }

      if (campaign.status === "cancelled") status = "cancelled";

      return {
        id: campaign._id,
        slotId: slot._id,
        title: campaign.name,
        category: campaign.category,
        coverImageUrl: campaign.coverImageUrl,
        status,
        reward: slot.reward,
        viewTarget: slot.viewTarget,
        minViews: 1000,
        maxViews: slot.viewTarget,
        costPerView: campaign.costPerView,
        submissionId: submission ? submission._id : null,
        comment: submission && submission.status === "rejected" ? submission.rejectionReason : undefined,
        progress: submission && submission.viewsDelivered > 0
          ? Math.min(Number(((submission.viewsDelivered / (slot.viewTarget || campaign.targetViews)) * 100).toFixed(3)), 100)
          : 0,
        currentViews: submission ? submission.viewsDelivered : undefined,
        targetViews: campaign.targetViews,
        videoUrl: submission ? submission.videoUrl : undefined,
        caption: submission ? submission.caption : undefined,
        videoDuration: submission && submission.durationSeconds
          ? `${Math.floor(submission.durationSeconds / 60)}m ${submission.durationSeconds % 60}s`
          : undefined,
        postedPlatforms: submission ? submission.postedPlatforms : undefined,
        contentBrief: campaign.contentBrief,
        description: campaign.contentBrief || undefined,
        keyMessageCta: campaign.keyMessageCta,
        whatToAvoid: campaign.whatToAvoid,
        goal: campaign.goal,
        competitors: campaign.competitors,
        uniqueSellingPoint: campaign.uniqueSellingPoint,
        funFact: campaign.funFact,
        platforms: campaign.platforms,
        contentStyle: campaign.contentStyle,
        scriptUrl: campaign.scriptUrl,
        scriptFileName: campaign.scriptFileName,
        brandName: campaign.businessId ? campaign.businessId.name || undefined : undefined,
        brandAvatar: campaign.businessId ? campaign.businessId.avatar || undefined : undefined,
        delivery: slot.status === "claimed"
          ? "Claimed"
          : submission && submission.status === "posted"
          ? "Live"
          : submission && (submission.status === "awaiting_post" || submission.status === "approved")
          ? "Awaiting Post"
          : "Submitted",
        submittedAgo: timeAgo(submission ? submission.submittedAt : undefined),
        reviewedAgo: timeAgo(submission ? submission.reviewedAt : undefined),
        postedAgo: timeAgo(submission ? submission.postedAt : undefined),
        timeline: submission ? eventsBySubmission[submission._id.toString()] || [] : [],
      };
    });

  return { campaigns, locked: ctx.locked, lockReason: ctx.lockReason };
}

async function buildWallet(user, ctx) {
  const { userId, profile } = ctx;
  const handle = profile ? profile.username : user.name;

  const [transactions, submissions, slots] = await Promise.all([
    Transaction.find({ creatorHandle: handle }).sort({ date: -1 }).limit(50).lean(),
    Submission.find({ creatorId: userId }).lean(),
    Slot.find({ creatorId: userId })
      .populate({ path: "campaignId", select: "name status targetViews costPerView viewsDelivered" })
      .lean(),
  ]);

  const totalReleased = submissions
    .filter((s) => s.payoutStatus === "released")
    .reduce((sum, s) => sum + (s.payoutAmount || 0), 0);

  // Last one wins here, exactly as the wallet always did.
  const submissionMap = {};
  for (const sub of submissions) {
    submissionMap[sub.campaignId.toString()] = sub;
  }

  let withdrawableBalance = 0;
  const pendingByCampaign = [];

  for (const slot of slots) {
    const campaign = slot.campaignId;
    if (!campaign) continue;
    const submission = submissionMap[campaign._id.toString()];
    if (!submission) continue;

    const views = submission.viewsDelivered || 0;
    const costPerView = campaign.costPerView || 0;
    const earned = views * costPerView;

    if (campaign.status === "completed") {
      withdrawableBalance += earned;
    } else if (["live", "paused", "under_review"].includes(campaign.status)) {
      pendingByCampaign.push({
        id: campaign._id,
        title: campaign.name,
        views,
        viewTarget: slot.viewTarget,
        earned,
        status: campaign.status,
      });
    }
  }

  const pendingBalance = pendingByCampaign.reduce((sum, c) => sum + c.earned, 0);
  const payout = profile && profile.payoutAccount;

  return {
    balance: withdrawableBalance,
    withdrawableBalance,
    pendingBalance,
    pendingByCampaign,
    hasBankAccount: !!(payout && payout.paystackRecipientCode),
    bankName: payout ? payout.bankName : null,
    accountName: payout ? payout.accountName : null,
    maskedAccountNumber: payout && payout.accountNumber ? `****${payout.accountNumber.slice(-4)}` : null,
    lifetimeEarnings: profile ? profile.lifetimeEarnings : 0,
    completionRate: profile ? profile.completionRate : 0,
    totalReleased,
    recentTransactions: transactions.map((t) => ({
      id: t._id,
      createdAt: t.date,
      date: t.date,
      amount: t.amount,
      type: t.type,
      status: t.status,
      views: t.views,
    })),
  };
}

// The whole dashboard in one round trip. The per-section builders share one
// context, so the profile and social lookups happen once, not six times.
async function buildDashboard(user) {
  const ctx = await loadContext(user._id);
  const profile = buildProfile(user, ctx);
  if (!profile) return null;

  const [campaigns, marketplace, wallet] = await Promise.all([
    buildMyCampaigns(ctx),
    buildMarketplace(ctx),
    buildWallet(user, ctx),
  ]);

  return {
    profile,
    campaigns,
    marketplace,
    wallet,
    tiktok: buildTikTokStatus(ctx),
    meta: buildMetaStatus(ctx),
  };
}

module.exports = {
  loadContext,
  buildProfile,
  buildTikTokStatus,
  buildMetaStatus,
  buildMarketplace,
  buildMyCampaigns,
  buildWallet,
  buildDashboard,
};
