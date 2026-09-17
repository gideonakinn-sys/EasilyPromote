const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const Submission = require("../models/Submission");
const ConversionEvent = require("../models/ConversionEvent");
const {
  monthRange,
  dailySeries,
  totalViews,
  topCampaigns,
  availableMonths,
} = require("./viewSnapshots");

// Statuses that count as "running" for the brand.
const ACTIVE_STATUSES = ["under_review", "live", "paused"];
// Money paid in (both the initial payment and later top-ups).
const DEPOSIT_TYPES = ["escrow_deposit", "topup"];
// A release is spent money as soon as the transfer is initiated.
const COMMITTED_RELEASE_STATUSES = ["escrow_deposit", "released"];
const SERIES_DAYS = 14;

function campaignBrief(c) {
  const progressPercent =
    c.targetViews > 0
      ? Math.min(Math.round((c.viewsDelivered / c.targetViews) * 100), 100)
      : 0;
  return {
    id: c._id,
    name: c.name,
    category: c.category,
    status: c.status,
    coverImageUrl: c.coverImageUrl,
    targetViews: c.targetViews,
    viewsDelivered: c.viewsDelivered,
    progressPercent,
    budget: c.budget,
    views: c.viewsDelivered,
    startDate: c.startDate,
    endDate: c.endDate,
    hasReferral: !!(c.referral && c.referral.enabled),
    conversions: c.referral && c.referral.enabled ? c.referral.conversions || 0 : 0,
  };
}

// One aggregate endpoint for the brand's Overview/Analytics pages. Everything is
// derived from the same handful of documents so the dashboards stay cheap.
async function buildAggregateStats(userId) {
  const campaigns = await Campaign.find({ businessId: userId })
    .sort({ createdAt: -1 })
    .lean();

  const campaignIds = campaigns.map((c) => c._id);

  const [transactions, unreadCount, submissions, conversionEvents] = await Promise.all([
    campaignIds.length > 0
      ? Transaction.find({ campaignId: { $in: campaignIds } })
          .select("type status amount bucket date")
          .lean()
      : [],
    Notification.countDocuments({ businessId: userId, read: false }),
    campaignIds.length > 0
      ? Submission.find({ campaignId: { $in: campaignIds } })
          .select("postedAt viewsDelivered")
          .lean()
      : [],
    ConversionEvent.find({ businessId: userId, isTest: false })
      .select("occurredAt")
      .lean(),
  ]);

  const byStatus = (statuses) => campaigns.filter((c) => statuses.includes(c.status)).length;
  const summary = {
    totalCampaigns: campaigns.length,
    drafts: byStatus(["draft"]),
    pendingPayment: byStatus(["pending_payment"]),
    activeCampaigns: byStatus(ACTIVE_STATUSES),
    completed: byStatus(["completed"]),
    cancelled: byStatus(["cancelled"]),
  };

  // Drafts, unpaid and cancelled campaigns pledge nothing.
  const funded = campaigns.filter((c) =>
    ["under_review", "live", "paused", "completed"].includes(c.status)
  );
  const viewsTarget = funded.reduce((sum, c) => sum + c.targetViews, 0);
  const viewsDelivered = funded.reduce((sum, c) => sum + c.viewsDelivered, 0);

  const deposited = transactions
    .filter((t) => DEPOSIT_TYPES.includes(t.type) && t.status === "escrow_deposit")
    .reduce((sum, t) => sum + t.amount, 0);
  const released = transactions
    .filter((t) => t.type === "release" && COMMITTED_RELEASE_STATUSES.includes(t.status))
    .reduce((sum, t) => sum + t.amount, 0);
  const refunded = transactions
    .filter((t) => t.type === "refund")
    .reduce((sum, t) => sum + t.amount, 0);

  // Views payouts can only come out of the creator pool, so the brand's escrow is
  // capped by the pool pledged across funded campaigns.
  const creatorPool = funded.reduce((sum, c) => sum + (c.creatorPool || 0), 0);
  const escrowBalance = Math.max(
    Math.min(deposited, creatorPool || deposited) - refunded - released,
    0
  );

  const avgCostPerView =
    viewsTarget > 0
      ? Math.round((funded.reduce((sum, c) => sum + c.budget, 0) / viewsTarget) * 1000) / 1000
      : 0;

  // Last 14 days. Views are attributed to the day a submission went posted, which
  // is the closest we have to a delivery timeline.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i -= 1) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const views = submissions
      .filter((s) => s.postedAt && s.postedAt >= start && s.postedAt < end)
      .reduce((sum, s) => sum + s.viewsDelivered, 0);
    const conversions = conversionEvents.filter(
      (e) => e.occurredAt >= start && e.occurredAt < end
    ).length;

    series.push({ date: start.toISOString(), views, conversions });
  }

  const topCampaigns = [...campaigns]
    .sort((a, b) => b.viewsDelivered - a.viewsDelivered)
    .slice(0, 5)
    .map(campaignBrief);

  return {
    summary: {
      ...summary,
      viewsTarget,
      viewsDelivered,
      progressPercent:
        viewsTarget > 0 ? Math.min(Math.round((viewsDelivered / viewsTarget) * 100), 100) : 0,
    },
    money: {
      deposited,
      released,
      refunded,
      escrowBalance,
      avgCostPerView,
    },
    conversions: conversionEvents.length,
    distribution: campaigns.map(campaignBrief),
    deliverySeries: series,
    topCampaigns,
    recent: campaigns.slice(0, 5).map(campaignBrief),
    unreadCount,
  };
}

// Billing feed: the brand's money movement across all its campaigns.
async function listTransactions(userId) {

  const rows = await Transaction.find({ campaignId: { $in: campaignIds } })
    .populate("campaignId", "name")
    .sort({ date: -1 })
    .limit(100)
    .lean();

  const transactions = rows.map((t) => ({
    id: t._id,
    date: t.date,
    type: t.type,
    status: t.status,
    amount: t.amount,
    views: t.views,
    bucket: t.bucket || "views",
    reference: t.reference,
    campaignId: t.campaignId ? t.campaignId._id : null,
    campaignName: t.campaignId ? t.campaignId.name : null,
  }));

  return { total: transactions.length, transactions };
}

// Overview: month-scoped metrics driven by the daily view snapshots.
async function buildMonthlyStats(userId, month) {
  const { from, to } = monthRange(month);

  const [totalCampaigns, drafts, activeCampaigns, campaignsCompleted, unreadCount] =
    await Promise.all([
      Campaign.countDocuments({ businessId: userId }),
      Campaign.countDocuments({ businessId: userId, status: "draft" }),
      Campaign.countDocuments({ businessId: userId, status: { $in: ACTIVE_STATUSES } }),
      Campaign.countDocuments({ businessId: userId, completedAt: { $gte: from, $lt: to } }),
      Notification.countDocuments({ businessId: userId, read: false }),
    ]);

  const [viewsDelivered, series, top, months] = await Promise.all([
    totalViews(userId, { from, to }),
    dailySeries(userId, { from, to }),
    topCampaigns(userId, { from, to }, 5),
    availableMonths(userId),
  ]);

  // Avg cost per view is a blended rate (budget ÷ target views), not a
  // month-to-month time series, so it stays stable across the picker.
  const funded = await Campaign.find({
    businessId: userId,
    status: { $in: ["under_review", "live", "paused", "completed"] },
  })
    .select("budget targetViews")
    .lean();
  const fundedBudget = funded.reduce((sum, c) => sum + (c.budget || 0), 0);
  const fundedTarget = funded.reduce((sum, c) => sum + (c.targetViews || 0), 0);
  const avgCostPerView =
    fundedTarget > 0 ? Math.round((fundedBudget / fundedTarget) * 1000) / 1000 : 0;

  return {
    summary: {
      totalCampaigns,
      drafts,
      activeCampaigns,
      campaignsCompleted,
      viewsDelivered,
      avgCostPerView,
    },
    dailySeries: series,
    topCampaigns: top,
    availableMonths: months,
    unreadCount,
  };
}

function buildStats(userId, { month } = {}) {
  return month ? buildMonthlyStats(userId, month) : buildAggregateStats(userId);
}

module.exports = { buildStats, listTransactions };