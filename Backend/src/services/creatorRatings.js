// Post-campaign brand ratings (M8, D24). A brand rates a creator 1–5, with an optional short
// comment and tags, once the creator's placement on the brand's campaign is complete:
//   content campaign (fixed or hybrid)  the creator's content is completed (delivery or live post
//                                       confirmed by the brand, or automatically after 72 hours);
//   performance campaign (views,        the campaign is completed and the creator delivered verified
//   sign-ups, downloads, leads, sales)  results on it (verified views or a paid conversion).
// Once per creator per campaign; the brand can change it for 7 days. Admins see every rating and
// can hide an abusive one (audit-logged). The creator and brands only ever see the average and
// count of visible ratings, and the average only from 3 ratings.
const mongoose = require("mongoose");
const { z } = require("zod");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const CreatorProfile = require("../models/CreatorProfile");
const CreatorRating = require("../models/CreatorRating");
const Submission = require("../models/Submission");
const User = require("../models/User");
const { RATING_TAGS, COMMENT_MAX } = require("../models/CreatorRating");
const { isContentCampaign } = require("../utils/campaignPay");
const { publicRating, PUBLIC_AVERAGE_MIN } = require("../utils/creatorProfile");
const { recordAdminActivity } = require("./adminActivity");

const DAY = 24 * 60 * 60 * 1000;
const EDIT_WINDOW_MS = 7 * DAY;

const TAG_LABELS = {
  on_brief: "On brief",
  on_time: "On time",
  communication: "Good communication",
  content_quality: "Great content",
  would_work_again: "Would work with again",
};

const refuse = (status, code, error) => ({ status, body: { error, code } });

const ratingSchema = z.object({
  score: z.number({ invalid_type_error: "Choose 1 to 5 stars", required_error: "Choose 1 to 5 stars" }).int("Choose 1 to 5 stars").min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  comment: z.string().trim().max(COMMENT_MAX, `Keep the comment under ${COMMENT_MAX} characters`).optional().default(""),
  tags: z
    .array(z.enum(RATING_TAGS, { errorMap: () => ({ message: "Unknown tag" }) }))
    .max(RATING_TAGS.length)
    .optional()
    .default([])
    .transform((tags) => RATING_TAGS.filter((t) => tags.includes(t))),
});

const visibilitySchema = z.object({
  hidden: z.boolean({ required_error: "hidden must be true or false", invalid_type_error: "hidden must be true or false" }),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional().default(""),
});

// ── Who can be rated ────────────────────────────────────────────────────────────────────────

const DELIVERED_VIEWS_STATUSES = ["posted", "verifying"];
const PAID_CONVERSION = {
  isTest: { $ne: true },
  voidedAt: null,
  $or: [{ rewardAmount: { $gt: 0 } }, { bonusAmount: { $gt: 0 } }],
};

// Map of creatorId → { completedAt, submissionId } for the creators whose placement on this
// campaign is complete.
async function completedParticipants(campaign) {
  const done = new Map();
  if (isContentCampaign(campaign)) {
    const completed = await Submission.find({ campaignId: campaign._id, status: "completed" })
      .select("creatorId completedAt updatedAt")
      .sort({ completedAt: 1 })
      .lean();
    for (const s of completed) {
      done.set(String(s.creatorId), { completedAt: s.completedAt || s.updatedAt, submissionId: s._id });
    }
    return done;
  }

  if (campaign.status !== "completed") return done;
  const completedAt = campaign.completedAt || campaign.updatedAt;
  const [viewCreators, conversionCreators] = await Promise.all([
    Submission.distinct("creatorId", {
      campaignId: campaign._id,
      slotId: { $exists: false },
      status: { $in: DELIVERED_VIEWS_STATUSES },
      viewsDelivered: { $gt: 0 },
    }),
    ConversionEvent.distinct("creatorId", { campaignId: campaign._id, ...PAID_CONVERSION }),
  ]);
  for (const id of [...viewCreators, ...conversionCreators]) done.set(String(id), { completedAt, submissionId: null });
  return done;
}

async function loadOwnCampaign(user, campaignId) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) return { refusal: refuse(404, "CAMPAIGN_NOT_FOUND", "Campaign not found") };
  if (String(campaign.businessId) !== String(user._id)) return { refusal: refuse(403, "NOT_AUTHORIZED", "Not authorized") };
  return { campaign };
}

// ── Views of a rating ───────────────────────────────────────────────────────────────────────

function brandView(rating, now = new Date()) {
  if (!rating) return null;
  const hidden = Boolean(rating.hiddenAt);
  return {
    id: String(rating._id),
    score: rating.score,
    comment: rating.comment || "",
    tags: rating.tags || [],
    createdAt: rating.createdAt,
    updatedAt: rating.updatedAt,
    editableUntil: rating.editableUntil,
    editable: !hidden && new Date(rating.editableUntil) >= now,
    hidden,
  };
}

// ── Recalculating after a change ────────────────────────────────────────────────────────────

async function refreshCreatorRating(creatorId, now = new Date()) {
  const [summary] = await CreatorRating.aggregate([
    { $match: { creatorId: new mongoose.Types.ObjectId(String(creatorId)), hiddenAt: null } },
    { $group: { _id: null, average: { $avg: "$score" }, count: { $sum: 1 } } },
  ]);
  const brandRating = {
    average: summary ? Math.round(summary.average * 100) / 100 : null,
    count: summary ? summary.count : 0,
    updatedAt: now,
  };
  await CreatorProfile.updateOne({ userId: creatorId }, { $set: { brandRating } });
  return brandRating;
}

// Ratings feed the creator score and badges; a failure here never fails the rating itself (the
// nightly recalculation catches up).
async function afterRatingChanged(creatorId) {
  try {
    await refreshCreatorRating(creatorId);
    const { recalculateCreator } = require("./creatorScore");
    const profile = await CreatorProfile.findOne({ userId: creatorId });
    if (profile) await recalculateCreator(profile);
  } catch (error) {
    console.error("[Ratings] Couldn't recalculate creator", String(creatorId), error.message);
  }
}

// ── Brand ───────────────────────────────────────────────────────────────────────────────────

async function listForBrand({ user, campaignId, now = new Date() }) {
  const { campaign, refusal } = await loadOwnCampaign(user, campaignId);
  if (refusal) return refusal;

  const participants = await completedParticipants(campaign);
  const ids = [...participants.keys()];
  const [profiles, users, ratings] = await Promise.all([
    CreatorProfile.find({ userId: { $in: ids } }).select("userId username displayName").lean(),
    User.find({ _id: { $in: ids } }).select("name avatar").lean(),
    CreatorRating.find({ campaignId: campaign._id }).lean(),
  ]);
  const profileOf = new Map(profiles.map((p) => [String(p.userId), p]));
  const userOf = new Map(users.map((u) => [String(u._id), u]));
  const ratingOf = new Map(ratings.map((r) => [String(r.creatorId), r]));

  const creators = ids
    .map((id) => {
      const profile = profileOf.get(id) || {};
      const account = userOf.get(id) || {};
      return {
        creatorId: id,
        name: profile.displayName || account.name || profile.username || "Creator",
        username: profile.username || null,
        avatar: account.avatar || null,
        completedAt: participants.get(id).completedAt || null,
        rating: brandView(ratingOf.get(id), now),
      };
    })
    .sort((a, b) => Number(Boolean(a.rating)) - Number(Boolean(b.rating)) || new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  return {
    status: 200,
    body: {
      creators,
      toRate: creators.filter((c) => !c.rating).length,
      tags: RATING_TAGS.map((value) => ({ value, label: TAG_LABELS[value] })),
      editWindowDays: EDIT_WINDOW_MS / DAY,
    },
  };
}

async function rateCreator({ user, campaignId, creatorId, input, now = new Date() }) {
  const parsed = ratingSchema.safeParse(input || {});
  if (!parsed.success) return refuse(400, "INVALID_INPUT", parsed.error.errors[0].message);
  const { campaign, refusal } = await loadOwnCampaign(user, campaignId);
  if (refusal) return refusal;

  const participants = await completedParticipants(campaign);
  const participant = participants.get(String(creatorId));
  if (!participant) {
    return refuse(409, "NOT_RATEABLE", "You can rate a creator once their work on this campaign is complete");
  }

  const fields = { score: parsed.data.score, comment: parsed.data.comment, tags: parsed.data.tags };
  let created = null;
  try {
    created = await CreatorRating.create({
      campaignId: campaign._id,
      creatorId,
      businessId: user._id,
      submissionId: participant.submissionId,
      ...fields,
      editableUntil: new Date(now.getTime() + EDIT_WINDOW_MS),
    });
  } catch (error) {
    // Already rated (or a second save raced this one): it's an edit.
    if (error.code !== 11000) throw error;
  }

  if (created) {
    await afterRatingChanged(creatorId);
    return { status: 201, body: { rating: brandView(created.toObject(), now) } };
  }

  const updated = await CreatorRating.findOneAndUpdate(
    { campaignId: campaign._id, creatorId, hiddenAt: null, editableUntil: { $gte: now } },
    { $set: fields },
    { new: true }
  ).lean();
  if (!updated) {
    const existing = await CreatorRating.findOne({ campaignId: campaign._id, creatorId }).lean();
    if (existing && existing.hiddenAt) return refuse(409, "RATING_HIDDEN", "Our team hid this rating, so it can't be changed");
    return refuse(409, "EDIT_WINDOW_CLOSED", `Ratings can only be changed for ${EDIT_WINDOW_MS / DAY} days after they're given`);
  }
  await afterRatingChanged(creatorId);
  return { status: 200, body: { rating: brandView(updated, now) } };
}

// ── Admin ───────────────────────────────────────────────────────────────────────────────────

function adminView(rating, { campaigns, brands, creators, hiders }) {
  const campaign = campaigns.get(String(rating.campaignId));
  const brand = brands.get(String(rating.businessId));
  const creator = creators.get(String(rating.creatorId));
  return {
    id: String(rating._id),
    score: rating.score,
    comment: rating.comment || "",
    tags: rating.tags || [],
    createdAt: rating.createdAt,
    updatedAt: rating.updatedAt,
    editableUntil: rating.editableUntil,
    campaign: { id: String(rating.campaignId), name: campaign ? campaign.name : "Deleted campaign" },
    brand: { id: String(rating.businessId), name: brand ? brand.name || brand.email : "Deleted brand" },
    creator: {
      id: String(rating.creatorId),
      name: creator ? creator.displayName || creator.username : "Deleted creator",
      username: creator ? creator.username : null,
    },
    hidden: Boolean(rating.hiddenAt),
    hiddenAt: rating.hiddenAt || null,
    hiddenBy: rating.hiddenBy ? (hiders.get(String(rating.hiddenBy)) || {}).name || null : null,
    hiddenReason: rating.hiddenReason || null,
  };
}

async function hydrate(ratings) {
  const ids = (key) => [...new Set(ratings.map((r) => r[key]).filter(Boolean).map(String))];
  const [campaigns, brands, creators, hiders] = await Promise.all([
    Campaign.find({ _id: { $in: ids("campaignId") } }).select("name").lean(),
    User.find({ _id: { $in: ids("businessId") } }).select("name email").lean(),
    CreatorProfile.find({ userId: { $in: ids("creatorId") } }).select("userId username displayName").lean(),
    User.find({ _id: { $in: ids("hiddenBy") } }).select("name").lean(),
  ]);
  const byId = (list, key = "_id") => new Map(list.map((d) => [String(d[key]), d]));
  const maps = { campaigns: byId(campaigns), brands: byId(brands), creators: byId(creators, "userId"), hiders: byId(hiders) };
  return ratings.map((r) => adminView(r, maps));
}

async function listForAdmin({ creatorId, hidden, page = 1, limit = 50 }) {
  const filter = {};
  if (creatorId) filter.creatorId = creatorId;
  if (hidden === "true") filter.hiddenAt = { $ne: null };
  if (hidden === "false") filter.hiddenAt = null;
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const current = Math.max(Number(page) || 1, 1);
  const [ratings, total] = await Promise.all([
    CreatorRating.find(filter).sort({ createdAt: -1, _id: -1 }).skip((current - 1) * size).limit(size).lean(),
    CreatorRating.countDocuments(filter),
  ]);
  let summary = null;
  if (creatorId) {
    const profile = await CreatorProfile.findOne({ userId: creatorId }).select("brandRating").lean();
    summary = profile && profile.brandRating ? { average: profile.brandRating.average, count: profile.brandRating.count || 0 } : { average: null, count: 0 };
  }
  return { status: 200, body: { ratings: await hydrate(ratings), total, page: current, pages: Math.max(1, Math.ceil(total / size)), summary } };
}

async function setVisibility({ req, ratingId, input, now = new Date() }) {
  const parsed = visibilitySchema.safeParse(input || {});
  if (!parsed.success) return refuse(400, "INVALID_INPUT", parsed.error.errors[0].message);
  const { hidden, reason } = parsed.data;
  if (hidden && !reason) return refuse(400, "REASON_REQUIRED", "Add a reason for hiding this rating");

  const existing = await CreatorRating.findById(ratingId).lean();
  if (!existing) return refuse(404, "NOT_FOUND", "Rating not found");

  const updated = await CreatorRating.findOneAndUpdate(
    { _id: existing._id, hiddenAt: hidden ? null : { $ne: null } },
    hidden
      ? { $set: { hiddenAt: now, hiddenBy: req.user._id, hiddenReason: reason } }
      : { $set: { hiddenAt: null, hiddenBy: null, hiddenReason: null } },
    { new: true }
  ).lean();
  if (!updated) return refuse(409, "NO_CHANGE", hidden ? "This rating is already hidden" : "This rating isn't hidden");

  await afterRatingChanged(updated.creatorId);
  const [view] = await hydrate([updated]);
  await recordAdminActivity(req, {
    action: hidden ? "rating.hidden" : "rating.unhidden",
    targetType: "rating",
    targetId: updated._id,
    targetLabel: `${view.creator.username ? `@${view.creator.username}` : view.creator.name} on ${view.campaign.name}`,
    businessId: updated.businessId,
    note: reason || null,
    metadata: {
      from: hidden ? "visible" : "hidden",
      to: hidden ? "hidden" : "visible",
      score: updated.score,
      campaignId: String(updated.campaignId),
      creatorId: String(updated.creatorId),
      ...(existing.hiddenReason && !hidden && { previousReason: existing.hiddenReason }),
    },
  });
  return { status: 200, body: { rating: view } };
}

module.exports = {
  EDIT_WINDOW_MS,
  PUBLIC_AVERAGE_MIN,
  RATING_TAGS,
  TAG_LABELS,
  completedParticipants,
  publicRating,
  refreshCreatorRating,
  listForBrand,
  rateCreator,
  listForAdmin,
  setVisibility,
};
