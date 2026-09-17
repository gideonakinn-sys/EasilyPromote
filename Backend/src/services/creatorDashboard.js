const { toObjectId } = require("../utils/objectId");
const { loadCreatorAccounts } = require("../utils/creatorAccounts");
const { ownAudience, publicPortfolio, publicStats } = require("../utils/creatorProfile");
const Campaign = require("../models/Campaign");
const CampaignApplication = require("../models/CampaignApplication");
const Slot = require("../models/Slot");
const ReferralCode = require("../models/ReferralCode");
const User = require("../models/User");
const Withdrawal = require("../models/Withdrawal");
const { creatorConversionGroups, referralEarningsFrom } = require("../utils/referralEarnings");
const { campaignEventTypes } = require("../utils/referralCodes");
const { latestSlotPerCampaign, viewsEarningsFrom, floorKobo, COMMITTED_WITHDRAWAL_STATUSES } = require("../utils/earnings");
const { fixedEarningsFrom, FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES } = require("../utils/fixedPay");
const { bonusEarningsFrom, BONUS_WITHDRAWABLE_CAMPAIGN_STATUSES } = require("../utils/hybridBonus");
const { roundMoney } = require("../utils/money");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const meta = require("./meta");
const { rankAtLeast } = require("./creatorScore");
const { listEventsForSubmissions, labelFor } = require("./submissionEvents");
const { timeAgo } = require("../utils/timeAgo");
const { campaignTerms, payPerUnit, briefSummary, fullBrief } = require("../utils/campaignPay");
const { joinEligibility, campaignFailures } = require("./joinRules");
const { recommendation, sortRecommended } = require("./recommendations");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS } = require("../utils/placementStatuses");
const { deliveryProgress, mapStatusToCreator } = require("../utils/campaignUpdates");
const { myApplicationsFrom, CAMPAIGN_FIELDS_FOR_PAY } = require("./applications"); // Campaign engine: applications (ticket 06)

// Campaign engine: content approval (ticket 07)
const contentApproval = require("./contentApproval");
const { contentLabelFor } = require("./submissionEvents");

// Everything the creator dashboard shows is derived from the same handful of documents. They're
// loaded once per request by loadCreatorData, in three rounds of parallel queries (the creator's
// own rows; the campaigns and ledger rows those point at; brands and open places), and every
// section is built from them. The dashboard is about 15 queries whatever the creator holds.

// Fields each section reads from a campaign. Sections see exactly these, as they did when each
// loaded its own campaigns, so a response never gains or loses a field.
const MY_CAMPAIGN_FIELDS =
  "name category status coverImageUrl contentBrief keyMessageCta whatToAvoid goal competitors uniqueSellingPoint funFact platforms contentStyle startDate endDate targetViews viewsDelivered costPerView scriptUrl scriptFileName businessId referral brief campaignObjective campaignModel payShape contentPay hybridBonus creatorAccess objective contentDestination";
const RELEASED_CAMPAIGN_FIELDS =
  "name category status coverImageUrl contentBrief platforms businessId brief campaignObjective campaignModel payShape contentPay hybridBonus contentDestination";
const WALLET_CAMPAIGN_FIELDS = "name status targetViews costPerView viewsDelivered referral payShape";
const VIEWS_EARNINGS_CAMPAIGN_FIELDS = "name status businessId";

// A lean document reduced to _id and `fields` (those it has), like a mongoose select.
function project(doc, fields) {
  if (!doc) return null;
  const out = { _id: doc._id };
  for (const field of fields.split(" ")) if (field in doc) out[field] = doc[field];
  return out;
}

function lockReasonFor({ hasSocial, hasNiches }) {
  if (hasSocial && hasNiches) return null;
  return hasSocial && !hasNiches
    ? "Choose your niches to unlock campaigns"
    : "Connect a social account to unlock campaigns";
}

// Profile + social connections, in one query. Shared by every builder below.
async function loadContext(userId) {
  const { profile, tiktok, metaConnections } = await loadCreatorAccounts(userId);

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

// ── Loading ─────────────────────────────────────────────────────────────────

// Rejected or appealed content whose place went back to the campaign: the creator still sees the
// campaign so they can read why and appeal. `submissions` are newest first.
function waitingReleasedSubmissions(submissions, heldCampaignIds) {
  const latest = new Map();
  for (const sub of submissions) {
    const key = String(sub.campaignId);
    if (!heldCampaignIds.has(key) && sub.slotId && !latest.has(key)) latest.set(key, sub);
  }
  return [...latest.values()].filter((sub) => ["rejected", "appealed"].includes(sub.status));
}

// Loads what the requested sections need: { marketplace, myCampaigns, wallet, applications }.
async function loadCreatorData(user, ctx, sections) {
  const creatorId = toObjectId(ctx.userId);
  const now = new Date();
  const need = (...names) => names.some((name) => sections[name]);
  const handle = ctx.profile ? ctx.profile.username : user && user.name;

  // Round 1: the creator's own rows.
  const [slots, submissions, withdrawals, conversionGroups, referralCodes, applications, recentTransactions] = await Promise.all([
    Slot.find({ creatorId }).sort({ createdAt: -1 }).lean(),
    need("myCampaigns", "wallet") ? Submission.find({ creatorId }).sort({ createdAt: -1 }).lean() : [],
    need("myCampaigns", "wallet")
      ? Withdrawal.find({ creatorId, status: { $ne: "rejected" } })
          .select("campaignId kind amount viewsAmount referralAmount fixedAmount bonusAmount status requestedAt")
          .sort({ _id: 1 })
          .lean()
      : [],
    need("myCampaigns", "wallet") ? creatorConversionGroups(creatorId, now) : [],
    need("myCampaigns") ? ReferralCode.find({ creatorId }).select("slotId code status conversions").lean() : [],
    need("applications") ? CampaignApplication.find({ creator: creatorId }).sort({ appliedAt: -1 }).lean() : [],
    need("wallet") ? Transaction.find({ creatorHandle: handle }).sort({ date: -1 }).limit(50).lean() : [],
  ]);

  const heldCampaignIds = new Set(slots.map((slot) => String(slot.campaignId)));
  const released = need("myCampaigns") ? waitingReleasedSubmissions(submissions, heldCampaignIds) : [];
  const campaignIds = new Set([
    ...(need("myCampaigns", "wallet") ? heldCampaignIds : []),
    ...applications.map((a) => String(a.campaign)),
    ...released.map((s) => String(s.campaignId)),
  ]);
  const submissionIds = submissions.map((s) => s._id);

  // Round 2: the campaigns those rows point at (and every live one for the marketplace), the
  // ledger rows the wallet reads, and the content timeline.
  const campaignFilter = need("marketplace")
    ? { $or: [{ status: "live" }, { _id: { $in: [...campaignIds].map(toObjectId) } }] }
    : { _id: { $in: [...campaignIds].map(toObjectId) } };
  const [campaigns, ledger, events] = await Promise.all([
    need("marketplace") || campaignIds.size > 0 ? Campaign.find(campaignFilter).sort({ createdAt: -1 }).lean() : [],
    need("wallet")
      ? Transaction.find({
          // Each branch is served by its own index. Older views releases carry only a submission.
          $or: [
            { creatorId, type: "fixed_credit", status: "credited" },
            { creatorId, type: "bonus_credit", status: "credited" },
            { creatorId, type: "release", status: "released", bucket: { $nin: ["referral", "fixed", "bonus"] } },
            ...(submissionIds.length > 0
              ? [{ submissionId: { $in: submissionIds }, type: "release", status: "released", bucket: { $nin: ["referral", "fixed", "bonus"] } }]
              : []),
          ],
        })
          .select("type campaignId submissionId amount date")
          .lean()
      : [],
    need("myCampaigns") && submissions.length > 0 ? listEventsForSubmissions(submissionIds) : [],
  ]);
  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

  // Round 3: brands for everything that shows one, and the marketplace's open places.
  const brandIds = new Set();
  const addBrand = (campaign) => campaign && campaign.businessId && brandIds.add(String(campaign.businessId));
  if (need("myCampaigns")) {
    slots.forEach((slot) => addBrand(campaignById.get(String(slot.campaignId))));
    released.forEach((sub) => addBrand(campaignById.get(String(sub.campaignId))));
  }
  applications.forEach((a) => addBrand(campaignById.get(String(a.campaign))));
  const heldForMarketplace = new Set(slots.filter((s) => HELD_PLACEMENT_STATUSES.includes(s.status)).map((s) => String(s.campaignId)));
  const openCampaigns = need("marketplace")
    ? campaigns.filter((c) => c.status === "live" && !heldForMarketplace.has(String(c._id)))
    : [];
  openCampaigns.forEach(addBrand);

  const [brands, availableSlots] = await Promise.all([
    brandIds.size > 0 ? User.find({ _id: { $in: [...brandIds].map(toObjectId) } }).select("name avatar").lean() : [],
    openCampaigns.length > 0
      ? Slot.find({ campaignId: { $in: openCampaigns.map((c) => c._id) }, status: "available" }).sort({ createdAt: 1, _id: 1 }).lean()
      : [],
  ]);
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  const withBrand = (campaign) => (campaign ? { ...campaign, businessId: campaign.businessId ? brandById.get(String(campaign.businessId)) || null : campaign.businessId } : null);

  return {
    now,
    slots,
    submissions,
    withdrawals,
    conversionGroups,
    referralCodes,
    applications,
    recentTransactions,
    released,
    campaignById,
    ledger,
    events,
    openCampaigns,
    availableSlots,
    withBrand,
  };
}

// Requested or paid withdrawals summed per campaign, per pot, as the earnings helpers count them.
function committedWithdrawals(withdrawals) {
  const views = new Map();
  const referral = new Map();
  const fixed = [];
  const bonus = [];
  const add = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);
  for (const w of withdrawals.filter((row) => COMMITTED_WITHDRAWAL_STATUSES.includes(row.status))) {
    const key = String(w.campaignId);
    if (w.kind !== "referral") add(views, key, w.kind === "campaign" ? w.viewsAmount || 0 : w.amount);
    if (w.kind === "referral") add(referral, key, w.amount);
    else if (w.kind === "campaign" && w.referralAmount > 0) add(referral, key, w.referralAmount);
    if (w.kind === "campaign" && w.fixedAmount > 0) fixed.push({ campaignId: w.campaignId, withdrawn: w.fixedAmount });
    if (w.kind === "campaign" && w.bonusAmount > 0) bonus.push({ campaignId: w.campaignId, withdrawn: w.bonusAmount });
  }
  return { views, referral, fixed, bonus };
}

function referralEarningsOf(data) {
  return referralEarningsFrom({ groups: data.conversionGroups, withdrawnByCampaign: committedWithdrawals(data.withdrawals).referral });
}

// ── Sections ────────────────────────────────────────────────────────────────

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

async function buildMarketplace(ctx, data = null) {
  data = data || (await loadCreatorData(null, ctx, { marketplace: true }));
  const { profile } = ctx;
  const creatorRank = profile ? profile.rank : "rank1";
  const activeSlots = data.slots.filter((s) => ACTIVE_PLACEMENT_STATUSES.includes(s.status)).length;

  // Open places for every campaign in one query, in the order a join takes them, so each card shows
  // the pay of the place the creator would get.
  const slotsByCampaign = new Map();
  for (const slot of data.availableSlots) {
    const key = slot.campaignId.toString();
    if (!slotsByCampaign.has(key)) slotsByCampaign.set(key, []);
    slotsByCampaign.get(key).push(slot);
  }

  const marketplace = [];
  for (const campaign of data.openCampaigns.map(data.withBrand)) {
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
    // Whether new conversions are currently being paid (the brand has budget left). A hybrid
    // campaign's conversions are paid from its bonus pool (ticket 10).
    paying:
      (campaign.referral.rewardPerConversion || 0) > 0 &&
      (campaign.payShape === "hybrid" && campaign.hybridBonus
        ? (campaign.hybridBonus.poolRemaining || 0) > 0
        : (campaign.referral.poolRemaining || 0) >= (campaign.referral.rewardPerConversion || 0)),
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
// so they can read why and appeal.
function releasedContentCampaigns(data, eventsBySubmission) {
  return data.released
    .map((sub) => ({ sub, campaign: data.withBrand(project(data.campaignById.get(String(sub.campaignId)), RELEASED_CAMPAIGN_FIELDS)) }))
    .filter(({ campaign }) => campaign && contentApproval.isContentCampaign(campaign))
    .map(({ sub, campaign }) => {
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

async function buildMyCampaigns(ctx, data = null) {
  data = data || (await loadCreatorData(null, ctx, { myCampaigns: true }));
  const { submissions } = data;
  const referralEarnings = referralEarningsOf(data);
  const submissionMap = indexSubmissionsByCampaign(submissions);
  const referralBySlot = new Map(data.referralCodes.map((code) => [code.slotId.toString(), code]));

  // Newest first, matching how the drawer stacks its activity list.
  const eventsBySubmission = {};
  for (const event of data.events) {
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

  const campaigns = data.slots
    .map((slot) => ({ slot, campaign: data.withBrand(project(data.campaignById.get(String(slot.campaignId)), MY_CAMPAIGN_FIELDS)) }))
    .filter(({ campaign }) => campaign)
    .map(({ slot, campaign }) => {
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
  const released = releasedContentCampaigns(data, eventsBySubmission);
  return { campaigns: [...campaigns, ...released], locked: ctx.locked, lockReason: ctx.lockReason };
}

async function buildWallet(user, ctx, data = null) {
  data = data || (await loadCreatorData(user, ctx, { wallet: true }));
  const { profile } = ctx;
  const { now } = data;
  const withdrawn = committedWithdrawals(data.withdrawals);

  const referralEarnings = referralEarningsOf(data);

  // Views earnings per campaign, with the same formula as withdrawals: views placements, most recent
  // claim first, and views delivered across the creator's submissions.
  const viewsSlots = data.slots
    .filter((slot) => slot.kind !== "deliverable")
    .map((slot) => ({ ...slot, campaignId: project(data.campaignById.get(String(slot.campaignId)), VIEWS_EARNINGS_CAMPAIGN_FIELDS) }))
    .sort((a, b) => new Date(b.claimedAt || 0) - new Date(a.claimedAt || 0) || new Date(b.createdAt) - new Date(a.createdAt));
  const viewsByCampaign = new Map();
  for (const sub of data.submissions) {
    const key = String(sub.campaignId);
    viewsByCampaign.set(key, (viewsByCampaign.get(key) || 0) + (sub.viewsDelivered || 0));
  }
  const viewsEarnings = viewsEarningsFrom({
    slotByCampaign: latestSlotPerCampaign(viewsSlots),
    viewsByCampaign,
    withdrawnByCampaign: withdrawn.views,
  });

  const credits = data.ledger.filter((t) => t.type === "fixed_credit");
  const fixedEarnings = fixedEarningsFrom({
    credits,
    submissionById: new Map(data.submissions.map((s) => [String(s._id), s])),
    withdrawals: withdrawn.fixed,
    now,
  });
  // Hybrid campaigns' bonus (ticket 10): held 7 days per credit, then withdrawable.
  const bonusEarnings = bonusEarningsFrom({ credits: data.ledger.filter((t) => t.type === "bonus_credit"), withdrawals: withdrawn.bonus, now });

  // Paid views payouts come from the ledger. Older releases carry only a submission;
  // newer ones also record the creator.
  const totalReleased = data.ledger.filter((t) => t.type === "release").reduce((sum, t) => sum + t.amount, 0);

  // Placements in the order the wallet always listed them (the creatorId + status index: by status,
  // then oldest first), each with the campaign fields the wallet reads.
  const slots = [...data.slots]
    .sort((a, b) => (a.status === b.status ? (String(a._id) < String(b._id) ? -1 : 1) : a.status < b.status ? -1 : 1))
    .map((slot) => ({ ...slot, campaignId: project(data.campaignById.get(String(slot.campaignId)), WALLET_CAMPAIGN_FIELDS) }));

  // Every campaign with views earnings, using the same formula as withdrawals.
  const viewsByCampaignList = [...viewsEarnings.values()]
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
    viewsByCampaignList.filter((c) => c.withdrawable).reduce((sum, c) => sum + c.availableToWithdraw, 0)
  );

  // Kept for older clients: earnings on campaigns that aren't finished yet.
  const pendingByCampaign = viewsByCampaignList
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
    viewsByCampaignList.filter((c) => !c.withdrawable).reduce((sum, c) => sum + c.availableToWithdraw, 0)
  );
  const payout = profile && profile.payoutAccount;

  // Withdrawals are once a week per campaign: views earnings, and referral earnings and fixed
  // pay past their hold, go out together.
  const { MIN_CAMPAIGN_WITHDRAWAL, payoutWeekStart, nextPayoutDate } = require("../utils/payoutSchedule");
  const weekStart = payoutWeekStart(now);
  const recentWithdrawals = data.withdrawals.filter(
    (w) => ["pending", "processing"].includes(w.status) || new Date(w.requestedAt) >= weekStart
  );

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
    const bonusTotals = bonusEarnings.get(key);
    const bonusAvailable = bonusTotals && BONUS_WITHDRAWABLE_CAMPAIGN_STATUSES.includes(campaign.status) ? bonusTotals.availableToWithdraw : 0;
    const bonusOnHold = bonusTotals ? bonusTotals.onHold : 0;
    const total = floorKobo(viewsAvailable + referralAvailable + fixedAvailable + bonusAvailable);

    const forCampaign = recentWithdrawals.filter((w) => String(w.campaignId) === key);
    const inFlight = forCampaign.find((w) => ["pending", "processing"].includes(w.status));
    const thisWeek = forCampaign.find((w) => new Date(w.requestedAt) >= weekStart);
    if (total <= 0 && !inFlight && !thisWeek && referralOnHold <= 0 && fixedOnHold <= 0 && fixedAwaitingDelivery <= 0 && bonusOnHold <= 0) continue;

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
    for (const unlock of (bonusTotals && bonusTotals.unlocks) || []) {
      onHold.push({ pot: "bonus", amount: unlock.amount, reason: "7-day hold", until: unlock.date });
    }

    withdrawCampaigns.push({
      id: campaign._id,
      title: campaign.name,
      status: campaign.status,
      // A hybrid campaign's fixed pay is its base; its bonus is its own pot (ticket 10).
      payShape: campaign.payShape || null,
      viewsAvailable,
      referralAvailable,
      referralOnHold,
      fixedAvailable,
      fixedOnHold,
      fixedAwaitingDelivery,
      fixedHoldUntil: fixedTotals ? fixedTotals.holdUntil : null,
      bonusAvailable,
      bonusOnHold,
      // What the campaign has earned per pot, withdrawn or not.
      earnings: {
        fixed: fixedTotals ? fixedTotals.earned : 0,
        performance: views ? views.earned : 0,
        referral: referralTotals ? referralTotals.earned : 0,
        bonus: bonusTotals ? bonusTotals.earned : 0,
      },
      onHold,
      onHoldTotal: roundMoney(fixedAwaitingDelivery + fixedOnHold + referralOnHold + bonusOnHold),
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

  // Hybrid campaigns' bonus, beside their base (the fixed pay above).
  const bonusByCampaign = [...bonusEarnings.values()].map((entry) => {
    const campaign = campaignById.get(String(entry.campaignId));
    return {
      id: entry.campaignId,
      title: campaign ? campaign.name : "Campaign",
      status: campaign ? campaign.status : null,
      earned: entry.earned,
      onHold: entry.onHold,
      holdUntil: entry.holdUntil,
      unlocks: entry.unlocks,
      withdrawn: entry.withdrawn,
      availableToWithdraw: entry.availableToWithdraw,
    };
  });
  const sumBonus = (field) => roundMoney(bonusByCampaign.reduce((sum, c) => sum + c[field], 0));

  return {
    balance: withdrawableBalance,
    withdrawableBalance,
    pendingBalance,
    pendingByCampaign,
    viewsByCampaign: viewsByCampaignList,
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
    bonus: {
      earned: sumBonus("earned"),
      onHold: sumBonus("onHold"),
      availableToWithdraw: sumBonus("availableToWithdraw"),
      withdrawn: sumBonus("withdrawn"),
      holdDays: 7,
      byCampaign: bonusByCampaign,
    },
    recentTransactions: data.recentTransactions.map((t) => ({
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

// "My applications", with each campaign's pay fields and brand.
function buildApplications(data) {
  return myApplicationsFrom(
    data.applications.map((application) => ({
      ...application,
      campaign: data.withBrand(project(data.campaignById.get(String(application.campaign)), CAMPAIGN_FIELDS_FOR_PAY)),
    }))
  );
}

// The whole dashboard in one round trip, from one load shared by every section.
async function buildDashboard(user) {
  const ctx = await loadContext(user._id);
  const profile = buildProfile(user, ctx);
  if (!profile) return null;

  const data = await loadCreatorData(user, ctx, { marketplace: true, myCampaigns: true, wallet: true, applications: true });
  const [campaigns, marketplace, wallet] = await Promise.all([
    buildMyCampaigns(ctx, data),
    buildMarketplace(ctx, data),
    buildWallet(user, ctx, data),
  ]);

  return {
    profile,
    campaigns,
    marketplace,
    wallet,
    applications: buildApplications(data),
    tiktok: buildTikTokStatus(ctx),
    meta: buildMetaStatus(ctx),
  };
}

module.exports = {
  loadContext,
  loadCreatorData,
  buildProfile,
  buildTikTokStatus,
  buildMetaStatus,
  buildMarketplace,
  buildMyCampaigns,
  buildWallet,
  buildDashboard,
};
