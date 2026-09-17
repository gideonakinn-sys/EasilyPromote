const CreatorProfile = require("../models/CreatorProfile");
const { ownAudience, publicPortfolio, publicStats } = require("../utils/creatorProfile");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const ReferralCode = require("../models/ReferralCode");
const { creatorReferralEarnings } = require("../utils/referralEarnings");
const { campaignEventTypes } = require("../utils/referralCodes");
const { creatorViewsEarnings, releasedViewsTotal, floorKobo } = require("../utils/earnings");
const { creatorFixedEarnings, FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES } = require("../utils/fixedPay");
const { roundMoney } = require("../utils/money");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const meta = require("./meta");
const { rankAtLeast } = require("./creatorScore");
const { listEventsForSubmissions, labelFor } = require("./submissionEvents");
const { timeAgo } = require("../utils/timeAgo");
const { campaignTerms, payPerUnit, briefSummary, fullBrief } = require("../utils/campaignPay");
const { joinEligibility, campaignFailures } = require("./joinRules");
const { recommendation, sortRecommended } = require("./recommendations");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS } = require("../utils/placementStatuses");
const { deliveryProgress, mapStatusToCreator } = require("../utils/campaignUpdates");
const { buildMyApplications } = require("./applications"); // Campaign engine: applications (ticket 06)

// Campaign engine: content approval (ticket 07)
const contentApproval = require("./contentApproval");
const { contentLabelFor } = require("./submissionEvents");

// Everything the creator dashboard shows is derived from the same handful of
// documents. Loading them once per request (instead of once per endpoint, and
// again inside every helper) is where most of the round trips went.


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

  const connectedPlatforms = [
    ...(tiktok ? ["tiktok"] : []),
    ...metaConnections.map((c) => c.provider).filter(Boolean),
  ];

  return {
    userId,
    profile,
    connectedPlatforms,
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
    city: profile.city || "",
    state: profile.state || "",
    legalName: profile.legalName || "",
    phone: profile.phone || "",
    categories: profile.categories || [],
    portfolio: publicPortfolio(profile.portfolio),
    verified: Boolean(profile.verifiedAt),
    badges: profile.badges || [],
    stats: publicStats(profile),
    audience: ownAudience(profile.audience),
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

  const [activeSlots, claimedCampaignIds, campaigns] = await Promise.all([
    Slot.countDocuments({ creatorId: userId, status: { $in: ACTIVE_PLACEMENT_STATUSES } }),
    Slot.distinct("campaignId", { creatorId: userId, status: { $in: HELD_PLACEMENT_STATUSES } }),
    Campaign.find({ status: "live" })
      .populate("businessId", "name avatar")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const claimedCampaignSet = new Set(claimedCampaignIds.map((id) => id.toString()));
  const openCampaigns = campaigns.filter((c) => !claimedCampaignSet.has(c._id.toString()));

  // One query for every campaign's open slots, instead of one query per campaign, in the
  // order a join takes them so each card shows the pay of the place the creator would get.
  const availableSlots = openCampaigns.length > 0
    ? await Slot.find({
        campaignId: { $in: openCampaigns.map((c) => c._id) },
        status: "available",
      })
        .sort({ createdAt: 1, _id: 1 })
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

    // Same check as joining; account-wide rules (connection, niches, placement limit) are
    // reported once via locked / canClaim rather than on every card.
    const check = joinEligibility({
      profile,
      connectedPlatforms: ctx.connectedPlatforms,
      hasSocial: ctx.hasSocial,
      activeSlots,
      campaign,
      availableSlots: slots,
    });
    const reasons = campaignFailures(check.failures).map((f) => f.message);
    const { recommended, nicheOverlap } = recommendation(profile, campaign, {
      eligible: reasons.length === 0,
      matchScore: check.matchScore,
    });
    const terms = campaignTerms(campaign);
    const targeting = campaign.audienceTargeting || {};

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
      // Campaign engine: creator marketplace v2 (tickets 04/05)
      campaignModel: terms.campaignModel,
      payShape: terms.payShape,
      creatorAccess: terms.creatorAccess,
      pay: payPerUnit(campaign, matchingSlot),
      targetPlatforms: targeting.platforms && targeting.platforms.length ? targeting.platforms : campaign.platforms || [],
      targetLocations: targeting.locations || [],
      placesLeft: slots.length,
      briefSummary: briefSummary(campaign),
      publishedAt: campaign.createdAt,
      eligible: reasons.length === 0,
      ineligibleReasons: reasons,
      matchScore: check.matchScore,
      nicheOverlap,
      recommended,
      // Shown before claiming, so creators know a campaign also pays per referral.
      referralReward:
        campaign.referral &&
        campaign.referral.enabled &&
        campaign.referral.rewardPerConversion > 0 &&
        campaign.referral.poolRemaining >= campaign.referral.rewardPerConversion
          ? { amount: campaign.referral.rewardPerConversion, eventType: campaign.referral.eventType, eventTypes: campaignEventTypes(campaign) }
          : null,
    });
  }

  // Recommended for You first, then New: everything else, newest first.
  marketplace.sort((a, b) => {
    if (b.recommended !== a.recommended) return b.recommended - a.recommended;
    if (a.recommended) return sortRecommended(a, b);
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  return {
    campaigns: marketplace,
    activeSlots,
    maxSlots: MAX_ACTIVE_PLACEMENTS,
    canClaim: ctx.locked ? false : activeSlots < MAX_ACTIVE_PLACEMENTS,
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

// Only campaigns with referral tracking on carry a referral block. A null code means
// the brand supplies its own codes and hasn't set this creator's yet.
function emptyReferralEarnings() {
  return { earned: 0, pending: 0, available: 0, withdrawn: 0, availableToWithdraw: 0, paidConversions: 0 };
}

function buildCreatorReferral(campaign, code, earnings) {
  if (!campaign.referral || !campaign.referral.enabled) return null;
  const totals = earnings || emptyReferralEarnings();
  return {
    eventType: campaign.referral.eventType,
    eventTypes: campaignEventTypes(campaign),
    code: code ? code.code : null,
    status: code ? code.status : "awaiting_code",
    conversions: code ? code.conversions : 0,
    rewardPerConversion: campaign.referral.rewardPerConversion || 0,
    // Whether new conversions are currently being paid (the brand has budget left).
    paying: (campaign.referral.rewardPerConversion || 0) > 0 && (campaign.referral.poolRemaining || 0) >= (campaign.referral.rewardPerConversion || 0),
    earnings: {
      earned: totals.earned,
      pending: totals.pending,
      available: totals.available,
      withdrawn: totals.withdrawn,
      availableToWithdraw: totals.availableToWithdraw,
      paidConversions: totals.paidConversions,
    },
  };
}

// Campaign engine: content approval (ticket 07)
// Content campaigns carry where their approval and delivery stand; a creator with no
// submission yet still learns the destination and the brief's required hashtags.
function contentApprovalFields(campaign, submission, timeline) {
  if (!contentApproval.isContentCampaign(campaign)) return {};
  const view = submission
    ? contentApproval.contentApprovalView(submission, campaign)
    : {
        status: null,
        destination: contentApproval.destinationOf(campaign),
        maxChangeRequests: contentApproval.MAX_CHANGE_REQUESTS,
        changeRequestsLeft: contentApproval.MAX_CHANGE_REQUESTS,
        changeRequests: [],
        licence: contentApproval.destinationOf(campaign) === "creator_page" ? null : contentApproval.USAGE_RIGHTS_LICENCE,
      };
  return {
    contentApproval: { ...view, requiredHashtags: (campaign.brief && campaign.brief.hashtags) || [] },
    timeline: timeline.map((event) => ({ ...event, label: contentLabelFor(event.type, event.metadata) })),
  };
}

// Rejected content gives its place back to the campaign, but the creator still sees the campaign
// so they can read why and appeal. `submissions` are newest first.
async function releasedContentCampaigns(submissions, heldItems, eventsBySubmission) {
  const held = new Set(heldItems.map((item) => String(item.id)));
  const latest = new Map();
  for (const sub of submissions) {
    const key = String(sub.campaignId);
    if (!held.has(key) && sub.slotId && !latest.has(key)) latest.set(key, sub);
  }
  const waiting = [...latest.values()].filter((sub) => ["rejected", "appealed"].includes(sub.status));
  if (waiting.length === 0) return [];

  const campaigns = await Campaign.find({ _id: { $in: waiting.map((sub) => sub.campaignId) } })
    .select("name category status coverImageUrl contentBrief platforms businessId brief campaignObjective campaignModel payShape contentPay contentDestination")
    .populate("businessId", "name avatar")
    .lean();
  const byId = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));

  return waiting
    .filter((sub) => byId.has(String(sub.campaignId)) && contentApproval.isContentCampaign(byId.get(String(sub.campaignId))))
    .map((sub) => {
      const campaign = byId.get(String(sub.campaignId));
      const pay = payPerUnit(campaign, null);
      return {
        id: campaign._id,
        slotId: null,
        title: campaign.name,
        category: campaign.category,
        coverImageUrl: campaign.coverImageUrl,
        status: campaign.status === "cancelled" ? "cancelled" : mapStatusToCreator(sub, campaign, null),
        reward: pay.amount || 0,
        submissionId: sub._id,
        videoUrl: sub.videoUrl,
        caption: sub.caption,
        contentBrief: campaign.contentBrief,
        description: campaign.contentBrief || undefined,
        platforms: campaign.platforms,
        kind: "deliverable",
        brief: fullBrief(campaign),
        pay,
        brandName: campaign.businessId ? campaign.businessId.name || undefined : undefined,
        brandAvatar: campaign.businessId ? campaign.businessId.avatar || undefined : undefined,
        delivery: sub.status === "appealed" ? "Appealed" : "Rejected",
        submittedAgo: timeAgo(sub.submittedAt),
        reviewedAgo: timeAgo(sub.reviewedAt),
        referral: null,
        ...contentApprovalFields(campaign, sub, eventsBySubmission[sub._id.toString()] || []),
      };
    });
}

async function buildMyCampaigns(ctx) {
  const { userId } = ctx;

  const [slots, submissions, referralCodes, referralEarnings] = await Promise.all([
    Slot.find({ creatorId: userId })
      .populate({
        path: "campaignId",
        select: "name category status coverImageUrl contentBrief keyMessageCta whatToAvoid goal competitors uniqueSellingPoint funFact platforms contentStyle startDate endDate targetViews viewsDelivered costPerView scriptUrl scriptFileName businessId referral brief campaignObjective campaignModel payShape contentPay creatorAccess objective contentDestination",
        populate: { path: "businessId", select: "name avatar" },
      })
      .sort({ createdAt: -1 })
      .lean(),
    Submission.find({ creatorId: userId }).sort({ createdAt: -1 }).lean(),
    ReferralCode.find({ creatorId: userId }).select("slotId code status conversions").lean(),
    creatorReferralEarnings(userId),
  ]);

  const submissionMap = indexSubmissionsByCampaign(submissions);
  const referralBySlot = new Map(referralCodes.map((code) => [code.slotId.toString(), code]));

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

      let status = mapStatusToCreator(submission, campaign, slot);
      if (campaign.status === "cancelled") status = "cancelled";
      const deliverable = slot.kind === "deliverable";

      return {
        id: campaign._id,
        slotId: slot._id,
        title: campaign.name,
        category: campaign.category,
        coverImageUrl: campaign.coverImageUrl,
        status,
        reward: slot.reward,
        viewTarget: slot.viewTarget,
        // Deliverable placements have no views to commit to.
        ...(!deliverable && { minViews: 1000, maxViews: slot.viewTarget }),
        costPerView: campaign.costPerView,
        submissionId: submission ? submission._id : null,
        comment: submission && submission.status === "rejected" ? submission.rejectionReason : undefined,
        progress: deliveryProgress(submission, slot, campaign),
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
        // Campaign engine: the full brief unlocks once the creator holds a placement.
        kind: slot.kind || "views",
        brief: fullBrief(campaign),
        pay: payPerUnit(campaign, slot),
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
        referral: buildCreatorReferral(
          campaign,
          referralBySlot.get(slot._id.toString()),
          referralEarnings.get(campaign._id.toString())
        ),
        // Campaign engine: content approval (ticket 07)
        ...contentApprovalFields(campaign, submission, submission ? eventsBySubmission[submission._id.toString()] || [] : []),
      };
    });

  // Campaign engine: content approval (ticket 07)
  const released = await releasedContentCampaigns(submissions, campaigns, eventsBySubmission);
  return { campaigns: [...campaigns, ...released], locked: ctx.locked, lockReason: ctx.lockReason };
}

async function buildWallet(user, ctx) {
  const { userId, profile } = ctx;
  const handle = profile ? profile.username : user.name;

  const now = new Date();
  const [transactions, submissions, slots, referralEarnings, viewsEarnings, fixedEarnings] = await Promise.all([
    Transaction.find({ creatorHandle: handle }).sort({ date: -1 }).limit(50).lean(),
    Submission.find({ creatorId: userId }).select("_id").lean(),
    Slot.find({ creatorId: userId })
      .populate({ path: "campaignId", select: "name status targetViews costPerView viewsDelivered referral" })
      .lean(),
    creatorReferralEarnings(userId),
    creatorViewsEarnings(userId),
    creatorFixedEarnings(userId, { now }),
  ]);

  // Paid views payouts come from the ledger. Older releases carry only a submission;
  // newer ones also record the creator.
  const totalReleased = await releasedViewsTotal({
    $or: [
      { creatorId: new (require("mongoose").Types.ObjectId)(String(userId)) },
      { submissionId: { $in: submissions.map((s) => s._id) } },
    ],
  });

  // Every campaign with views earnings, using the same formula as withdrawals.
  const viewsByCampaign = [...viewsEarnings.values()]
    .filter((entry) => entry.views > 0 || entry.withdrawn > 0)
    .map((entry) => ({
      id: entry.campaignId,
      title: entry.title,
      status: entry.status,
      views: entry.views,
      viewTarget: entry.viewTarget,
      reward: entry.reward,
      earned: entry.earned,
      withdrawn: entry.withdrawn,
      availableToWithdraw: entry.availableToWithdraw,
      withdrawable: entry.withdrawable,
    }));

  const withdrawableBalance = floorKobo(
    viewsByCampaign.filter((c) => c.withdrawable).reduce((sum, c) => sum + c.availableToWithdraw, 0)
  );

  // Kept for older clients: earnings on campaigns that aren't finished yet.
  const pendingByCampaign = viewsByCampaign
    .filter((c) => ["live", "paused", "under_review"].includes(c.status))
    .map((c) => ({
      id: c.id,
      title: c.title,
      views: c.views,
      viewTarget: c.viewTarget,
      earned: c.availableToWithdraw,
      status: c.status,
    }));

  // Earned but not withdrawable until the campaign is approved.
  const pendingBalance = floorKobo(
    viewsByCampaign.filter((c) => !c.withdrawable).reduce((sum, c) => sum + c.availableToWithdraw, 0)
  );
  const payout = profile && profile.payoutAccount;

  // Withdrawals are once a week per campaign: views earnings, and referral earnings and fixed
  // pay past their hold, go out together.
  const Withdrawal = require("../models/Withdrawal");
  const { MIN_CAMPAIGN_WITHDRAWAL, payoutWeekStart, nextPayoutDate } = require("../utils/payoutSchedule");
  const weekStart = payoutWeekStart(now);
  const recentWithdrawals = await Withdrawal.find({
    creatorId: userId,
    $or: [{ status: { $in: ["pending", "processing"] } }, { status: { $ne: "rejected" }, requestedAt: { $gte: weekStart } }],
  }).lean();

  const withdrawCampaigns = [];
  const seenCampaigns = new Set();
  for (const slot of slots) {
    const campaign = slot.campaignId;
    if (!campaign) continue;
    const key = String(campaign._id);
    if (seenCampaigns.has(key)) continue;
    seenCampaigns.add(key);

    const views = viewsEarnings.get(key);
    const referralTotals = referralEarnings.get(key);
    const fixedTotals = fixedEarnings.get(key);
    const viewsEligible = ["live", "paused", "completed"].includes(campaign.status);
    const referralEligible = viewsEligible || campaign.status === "cancelled";
    const viewsAvailable = viewsEligible && views ? views.availableToWithdraw : 0;
    const referralAvailable = referralEligible && referralTotals ? referralTotals.availableToWithdraw : 0;
    const referralOnHold = referralTotals ? referralTotals.pending : 0;
    const fixedAvailable = fixedTotals && FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES.includes(campaign.status) ? fixedTotals.availableToWithdraw : 0;
    const fixedOnHold = fixedTotals ? fixedTotals.onHold : 0;
    const fixedAwaitingDelivery = fixedTotals ? fixedTotals.awaitingDelivery : 0;
    const total = floorKobo(viewsAvailable + referralAvailable + fixedAvailable);

    const forCampaign = recentWithdrawals.filter((w) => String(w.campaignId) === key);
    const inFlight = forCampaign.find((w) => ["pending", "processing"].includes(w.status));
    const thisWeek = forCampaign.find((w) => new Date(w.requestedAt) >= weekStart);
    if (total <= 0 && !inFlight && !thisWeek && referralOnHold <= 0 && fixedOnHold <= 0 && fixedAwaitingDelivery <= 0) continue;

    // Money not withdrawable yet, and why: one line per unlock date, each with its own amount.
    const onHold = [];
    if (fixedAwaitingDelivery > 0) {
      onHold.push({ pot: "fixed", amount: fixedAwaitingDelivery, reason: "Waiting for the brand to confirm delivery", until: null });
    }
    for (const unlock of (fixedTotals && fixedTotals.unlocks) || []) {
      onHold.push({ pot: "fixed", amount: unlock.amount, reason: "7-day hold", until: unlock.date });
    }
    for (const unlock of (referralTotals && referralTotals.unlocks) || []) {
      onHold.push({ pot: "referral", amount: unlock.amount, reason: "7-day hold", until: unlock.date });
    }

    withdrawCampaigns.push({
      id: campaign._id,
      title: campaign.name,
      status: campaign.status,
      viewsAvailable,
      referralAvailable,
      referralOnHold,
      fixedAvailable,
      fixedOnHold,
      fixedAwaitingDelivery,
      fixedHoldUntil: fixedTotals ? fixedTotals.holdUntil : null,
      // What the campaign has earned per pot, withdrawn or not.
      earnings: {
        fixed: fixedTotals ? fixedTotals.earned : 0,
        performance: views ? views.earned : 0,
        referral: referralTotals ? referralTotals.earned : 0,
      },
      onHold,
      onHoldTotal: roundMoney(fixedAwaitingDelivery + fixedOnHold + referralOnHold),
      payoutDate: inFlight ? nextPayoutDate(inFlight.requestedAt) : nextPayoutDate(now),
      total,
      // available | below_minimum | nothing_yet | requested | withdrawn_this_week
      state: inFlight
        ? "requested"
        : thisWeek
          ? "withdrawn_this_week"
          : total <= 0
            ? "nothing_yet"
            : total < MIN_CAMPAIGN_WITHDRAWAL
              ? "below_minimum"
              : "available",
      requested: inFlight
        ? { amount: inFlight.amount, status: inFlight.status, payoutDate: nextPayoutDate(inFlight.requestedAt) }
        : null,
    });
  }

  // Referral earnings are their own pot: held 7 days per conversion, then withdrawable.
  const referralByCampaign = [];
  for (const slot of slots) {
    const campaign = slot.campaignId;
    if (!campaign) continue;
    const earnings = referralEarnings.get(campaign._id.toString());
    const tracking = campaign.referral && campaign.referral.enabled;
    if (!earnings && !tracking) continue;
    const totals = earnings || emptyReferralEarnings();
    referralByCampaign.push({
      id: campaign._id,
      title: campaign.name,
      status: campaign.status,
      eventType: campaign.referral ? campaign.referral.eventType : null,
      eventTypes: campaign.referral ? campaignEventTypes(campaign) : [],
      rewardPerConversion: campaign.referral ? campaign.referral.rewardPerConversion || 0 : 0,
      paidConversions: totals.paidConversions,
      earned: totals.earned,
      pending: totals.pending,
      available: totals.available,
      withdrawn: totals.withdrawn,
      availableToWithdraw: totals.availableToWithdraw,
    });
  }
  const sumReferral = (field) =>
    Math.round(referralByCampaign.reduce((sum, c) => sum + c[field], 0) * 100) / 100;

  // Fixed pay from content campaigns: credited per deliverable, withdrawable once the brand has
  // confirmed delivery and the 7-day hold is over.
  const campaignById = new Map(slots.filter((s) => s.campaignId).map((s) => [String(s.campaignId._id), s.campaignId]));
  const fixedByCampaign = [...fixedEarnings.values()].map((entry) => {
    const campaign = campaignById.get(String(entry.campaignId));
    return {
      id: entry.campaignId,
      title: campaign ? campaign.name : "Campaign",
      status: campaign ? campaign.status : null,
      deliverables: entry.deliverables,
      earned: entry.earned,
      awaitingDelivery: entry.awaitingDelivery,
      onHold: entry.onHold,
      holdUntil: entry.holdUntil,
      unlocks: entry.unlocks,
      withdrawn: entry.withdrawn,
      availableToWithdraw: entry.availableToWithdraw,
    };
  });
  const sumFixed = (field) => roundMoney(fixedByCampaign.reduce((sum, c) => sum + c[field], 0));

  return {
    balance: withdrawableBalance,
    withdrawableBalance,
    pendingBalance,
    pendingByCampaign,
    viewsByCampaign,
    withdrawCampaigns,
    payoutSchedule: { nextPayoutDate: nextPayoutDate(now), minimumPerCampaign: MIN_CAMPAIGN_WITHDRAWAL },
    hasBankAccount: !!(payout && payout.paystackRecipientCode),
    bankName: payout ? payout.bankName : null,
    accountName: payout ? payout.accountName : null,
    maskedAccountNumber: payout && payout.accountNumber ? `****${payout.accountNumber.slice(-4)}` : null,
    lifetimeEarnings: profile ? profile.lifetimeEarnings : 0,
    completionRate: profile ? profile.completionRate : 0,
    totalReleased,
    referral: {
      earned: sumReferral("earned"),
      pending: sumReferral("pending"),
      availableToWithdraw: sumReferral("availableToWithdraw"),
      withdrawn: sumReferral("withdrawn"),
      holdDays: 7,
      byCampaign: referralByCampaign,
    },
    fixed: {
      earned: sumFixed("earned"),
      awaitingDelivery: sumFixed("awaitingDelivery"),
      onHold: sumFixed("onHold"),
      availableToWithdraw: sumFixed("availableToWithdraw"),
      withdrawn: sumFixed("withdrawn"),
      holdDays: 7,
      byCampaign: fixedByCampaign,
    },
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

  const [campaigns, marketplace, wallet, applications] = await Promise.all([
    buildMyCampaigns(ctx),
    buildMarketplace(ctx),
    buildWallet(user, ctx),
    buildMyApplications(ctx.userId),
  ]);

  return {
    profile,
    campaigns,
    marketplace,
    wallet,
    applications,
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
