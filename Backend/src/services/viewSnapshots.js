const mongoose = require("mongoose");
const ViewSnapshot = require("../models/ViewSnapshot");
const Campaign = require("../models/Campaign");

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Book a positive view delta into today's snapshot for the campaign. Called from
// every view-sync path; safe to call when nothing moved (delta <= 0 is a no-op).
async function recordViewDelta({ campaignId, submissionId = null, delta }) {
  if (!campaignId || !delta || delta <= 0) return;

  const campaign = await Campaign.findById(campaignId).select("businessId").lean();
  if (!campaign || !campaign.businessId) return;

  const date = startOfUtcDay(new Date());
  await ViewSnapshot.updateOne(
    { campaignId, date },
    {
      $inc: { views: delta },
      $setOnInsert: { businessId: campaign.businessId, submissionId },
    },
    { upsert: true }
  );
}

// "YYYY-MM" -> { from, to } UTC Date boundaries for that calendar month.
function monthRange(month) {
  const [year, monthIndex] = String(month).split("-").map(Number);
  const from = new Date(Date.UTC(year, monthIndex - 1, 1));
  const to = new Date(Date.UTC(year, monthIndex, 1));
  return { from, to };
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

// One point per day in the range, zero-filled so charts render a continuous axis.
async function dailySeries(businessId, { from, to }) {
  const rows = await ViewSnapshot.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(String(businessId)),
        date: { $gte: from, $lt: to },
      },
    },
    { $group: { _id: "$date", views: { $sum: "$views" } } },
  ]);

  const byDay = new Map(rows.map((r) => [dayKey(r._id), r.views]));

  const series = [];
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    series.push({ date: d.toISOString(), views: byDay.get(dayKey(d)) || 0 });
  }
  return series;
}

async function totalViews(businessId, { from, to }) {
  const [result] = await ViewSnapshot.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(String(businessId)),
        date: { $gte: from, $lt: to },
      },
    },
    { $group: { _id: null, total: { $sum: "$views" } } },
  ]);
  return result ? result.total : 0;
}

// Campaigns ranked by views gained in the range, best first.
async function topCampaigns(businessId, { from, to }, limit = 5) {
  const rows = await ViewSnapshot.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(String(businessId)),
        date: { $gte: from, $lt: to },
      },
    },
    { $group: { _id: "$campaignId", views: { $sum: "$views" } } },
    { $sort: { views: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r._id);
  const campaigns = await Campaign.find({ _id: { $in: ids } }).lean();
  const byId = new Map(campaigns.map((c) => [c._id.toString(), c]));

  return rows
    .map((r) => {
      const c = byId.get(r._id.toString());
      if (!c) return null;
      const targetViews = c.targetViews || 0;
      const progressPercent =
        targetViews > 0 ? Math.min(Math.round((r.views / targetViews) * 100), 100) : 0;
      return {
        id: c._id,
        name: c.name,
        category: c.category,
        status: c.status,
        coverImageUrl: c.coverImageUrl,
        targetViews,
        viewsDelivered: r.views,
        progressPercent,
        budget: c.budget,
        views: r.views,
        startDate: c.startDate,
        endDate: c.endDate,
        objective: c.objective,
        campaignModel: c.campaignModel,
        hasReferral: !!(c.referral && c.referral.enabled),
        conversions: c.referral && c.referral.enabled ? c.referral.conversions || 0 : 0,
      };
    })
    .filter(Boolean);
}

// Distinct "YYYY-MM" months that have any view activity, newest first.
async function availableMonths(businessId) {
  const rows = await ViewSnapshot.aggregate([
    { $match: { businessId: new mongoose.Types.ObjectId(String(businessId)) } },
    {
      $group: {
        _id: { year: { $year: "$date" }, month: { $month: "$date" } },
      },
    },
    { $sort: { "_id.year": -1, "_id.month": -1 } },
  ]);
  return rows.map((r) => {
    const y = r._id.year;
    const m = String(r._id.month).padStart(2, "0");
    return `${y}-${m}`;
  });
}

module.exports = {
  recordViewDelta,
  monthRange,
  dailySeries,
  totalViews,
  topCampaigns,
  availableMonths,
};