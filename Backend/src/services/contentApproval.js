// Content Approval and delivery (ticket 07, ADR 0002).
//
// A creator holding a deliverable placement in a content campaign submits content; the brand
// approves, requests changes (at most 2 rounds, D11) or rejects (appealable). Approved content
// then goes where the campaign says:
//
//   creator_page: awaiting_post → (live post link) verifying → (brand verifies) completed
//   brand_page:   awaiting_delivery → (download link + usage rights) delivered → (brand confirms receipt) completed
//   both:         awaiting_delivery → delivered → (receipt) awaiting_post → verifying → completed
//
// Content nobody reviews for 72 hours is approved automatically (D10).
//
// These transitions only ever read and write the Submission (and its events and notifications).
// They never read or write an application, and never change who holds a placement.
// Views / performance campaigns never come through here.
const Submission = require("../models/Submission");
const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const ReferralCode = require("../models/ReferralCode");
const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const { emitToUser } = require("../config/socket");
const { emitCampaignUpdate } = require("../utils/campaignUpdates");
const { campaignTerms } = require("../utils/campaignPay");
const { HELD_PLACEMENT_STATUSES } = require("../utils/placementStatuses");
const { recordEvent } = require("./submissionEvents");

const MAX_CHANGE_REQUESTS = 2;
const AUTO_APPROVE_AFTER_MS = 72 * 60 * 60 * 1000;
const AUTO_APPROVE_INTERVAL_MS = 15 * 60 * 1000;

// D6: the one standard licence a creator grants when content goes to the brand's page.
const USAGE_RIGHTS_LICENCE =
  "You grant the brand a perpetual, non-exclusive licence to use this content on its own organic and paid social channels.";

class ContentApprovalError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const fail = (status, code, message, extra) => {
  throw new ContentApprovalError(status, code, message, extra);
};

function isContentCampaign(campaign) {
  return Boolean(campaign) && campaignTerms(campaign).campaignModel === "content";
}

function destinationOf(campaign) {
  return (campaign && campaign.contentDestination) || "creator_page";
}

const needsDelivery = (campaign) => ["brand_page", "both"].includes(destinationOf(campaign));
const needsPost = (campaign) => ["creator_page", "both"].includes(destinationOf(campaign));

function statusAfterApproval(campaign) {
  return needsDelivery(campaign) ? "awaiting_delivery" : "awaiting_post";
}

function changeRequestsUsed(submission) {
  return (submission.changeRequests || []).length;
}

function changeRequestsLeft(submission) {
  return Math.max(MAX_CHANGE_REQUESTS - changeRequestsUsed(submission), 0);
}

function reviewDueAt(submission) {
  if (submission.status !== "new") return null;
  const since = submission.awaitingReviewSince || submission.submittedAt;
  return since ? new Date(new Date(since).getTime() + AUTO_APPROVE_AFTER_MS) : null;
}

const isHttpUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// In-app notification plus a socket push, sent to whoever has to act next.
async function notify({ campaign, submission, to, type, title, body }) {
  const userId = to === "brand" ? campaign.businessId : submission.creatorId;
  const notification = await Notification.create({
    ...(to === "brand" ? { businessId: userId } : { creatorId: userId }),
    campaignId: campaign._id,
    type,
    title,
    body,
  });
  emitToUser(userId, "notification", {
    id: notification._id,
    type,
    title,
    body,
    campaignId: campaign._id,
    submissionId: submission._id,
    createdAt: notification.createdAt,
  });
  return notification;
}

// Moves a submission only if it is still in one of `from`, so two actors (a brand and the
// auto-approve job) can't both apply a transition.
async function transition(submission, from, update) {
  const updated = await Submission.findOneAndUpdate(
    { _id: submission._id, status: { $in: from } },
    update,
    { new: true }
  );
  if (!updated) fail(409, "STATUS_CHANGED", "This submission has changed. Refresh to see where it is now.");
  return updated;
}

function afterChange(submission) {
  // Socket pushes never fail the request.
  emitCampaignUpdate(submission).catch((error) => console.error("[Content] update emit failed:", error.message));
}

// ── M6 seam ─────────────────────────────────────────────────────────────────
// D1: fixed pay is due on approval for brand-page content, and once the live post is verified
// for creator-page / both. Crediting the creator is ticket M6; for now this only records that
// the pay became due, so M6 has one place to hook in.
async function fixedPayDue(submission, campaign, { trigger }) {
  const slot = await Slot.findOne({ campaignId: campaign._id, creatorId: submission.creatorId }).select("reward").lean();
  await recordEvent(submission, {
    type: "fixed_pay_due",
    actor: "system",
    reason: null,
    metadata: { trigger, amount: slot ? slot.reward : null, credited: false },
  });
}

async function complete(submission, campaign, { now = new Date() } = {}) {
  const completed = await Submission.findByIdAndUpdate(
    submission._id,
    { $set: { status: "completed", completedAt: now } },
    { new: true }
  );
  // The placement's work is done: it stays held by the creator, but no longer counts
  // towards their active placement limit.
  await Slot.updateOne(
    { campaignId: campaign._id, creatorId: submission.creatorId, status: { $in: ["claimed", "submitted", "verifying"] } },
    { $set: { status: "approved", completedAt: now } }
  );
  await recordEvent(completed, { type: "completed", actor: "system" });
  await notify({
    campaign,
    submission: completed,
    to: "creator",
    type: "content_completed",
    title: "Deliverable completed",
    body: `Your deliverable for "${campaign.name}" is complete.`,
  });
  return completed;
}

// ── Transitions ─────────────────────────────────────────────────────────────

async function submitContent({ user, campaign, videoUrl, caption, durationSeconds }) {
  if (!isHttpUrl(videoUrl)) fail(400, "VIDEO_URL_REQUIRED", "Add a link to your content");

  const [placements, existing] = await Promise.all([
    Slot.countDocuments({ campaignId: campaign._id, creatorId: user._id, kind: "deliverable", status: { $in: HELD_PLACEMENT_STATUSES } }),
    Submission.countDocuments({ campaignId: campaign._id, creatorId: user._id }),
  ]);
  if (placements === 0) fail(403, "PLACEMENT_REQUIRED", "Join this campaign before submitting content");
  // A placement carries one submission for its whole life: changes go through change
  // requests, and a rejection is final unless appealed.
  if (existing >= placements) {
    fail(409, "SUBMISSION_LIMIT", "You've already submitted content for your place in this campaign");
  }

  const [account, profile] = await Promise.all([User.findById(user._id), CreatorProfile.findOne({ userId: user._id })]);
  const now = new Date();
  const submission = await Submission.create({
    campaignId: campaign._id,
    creatorId: user._id,
    creatorHandle: profile ? profile.username : account.name,
    videoUrl: String(videoUrl).trim(),
    caption,
    durationSeconds,
    status: "new",
    submittedAt: now,
    awaitingReviewSince: now,
  });

  await Slot.updateOne(
    { campaignId: campaign._id, creatorId: user._id, status: "claimed" },
    { $set: { status: "submitted", submissionUrl: submission.videoUrl } }
  );
  await recordEvent(submission, {
    type: "submitted",
    actor: "creator",
    actorId: user._id,
    actorName: submission.creatorHandle,
    metadata: { videoUrl: submission.videoUrl, caption, durationSeconds },
  });
  await notify({
    campaign,
    submission,
    to: "brand",
    type: "content_submitted",
    title: "Content to review",
    body: `${submission.creatorHandle} submitted content for "${campaign.name}". Review it within 72 hours or it's approved automatically.`,
  });
  afterChange(submission);
  return submission;
}

async function requestChanges({ submission, campaign, user, notes }) {
  const text = String(notes || "").trim();
  if (!text) fail(400, "NOTES_REQUIRED", "Tell the creator what to change");
  if (submission.status !== "new") fail(400, "NOT_AWAITING_REVIEW", "You can only request changes on content waiting for review");
  if (changeRequestsLeft(submission) <= 0) {
    fail(409, "CHANGE_REQUESTS_USED", `You've used all ${MAX_CHANGE_REQUESTS} change requests. Approve or reject this content.`);
  }

  const round = changeRequestsUsed(submission) + 1;
  const updated = await transition(submission, ["new"], {
    $set: { status: "changes_requested", reviewedAt: new Date() },
    $push: {
      changeRequests: {
        round,
        notes: text,
        requestedAt: new Date(),
        requestedBy: user._id,
        videoUrl: submission.videoUrl,
        caption: submission.caption,
      },
    },
  });
  // Guard against a concurrent second request slipping past the round check.
  if (changeRequestsUsed(updated) > MAX_CHANGE_REQUESTS) {
    await Submission.updateOne({ _id: updated._id }, { $pop: { changeRequests: 1 }, $set: { status: "new" } });
    fail(409, "CHANGE_REQUESTS_USED", `You've used all ${MAX_CHANGE_REQUESTS} change requests. Approve or reject this content.`);
  }

  await recordEvent(updated, { type: "changes_requested", actor: "brand", actorId: user._id, actorName: user.name, reason: text, metadata: { round } });
  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: "content_changes_requested",
    title: "Changes requested",
    body: `The brand asked for changes to your content for "${campaign.name}": ${text}`,
  });
  afterChange(updated);
  return updated;
}

async function resubmit({ submission, campaign, user, videoUrl, caption }) {
  if (videoUrl !== undefined && !isHttpUrl(videoUrl)) fail(400, "VIDEO_URL_REQUIRED", "Add a link to your content");

  if (submission.status === "new") {
    // Editing before the brand has looked: no new round, the review clock keeps running.
    const set = {};
    if (videoUrl !== undefined) set.videoUrl = String(videoUrl).trim();
    if (caption !== undefined) set.caption = caption;
    const updated = await transition(submission, ["new"], { $set: set });
    await recordEvent(updated, {
      type: "content_edited",
      actor: "creator",
      actorId: user._id,
      actorName: updated.creatorHandle,
      metadata: { videoUrl: updated.videoUrl, caption: updated.caption },
    });
    afterChange(updated);
    return updated;
  }
  if (submission.status !== "changes_requested") {
    fail(400, "NOT_EDITABLE", "Content can only be changed while it's waiting for review or the brand asked for changes");
  }

  const now = new Date();
  const set = { status: "new", awaitingReviewSince: now };
  if (videoUrl !== undefined) set.videoUrl = String(videoUrl).trim();
  if (caption !== undefined) set.caption = caption;
  const last = changeRequestsUsed(submission) - 1;
  if (last >= 0) set[`changeRequests.${last}.resubmittedAt`] = now;

  const updated = await transition(submission, ["changes_requested"], { $set: set });
  await recordEvent(updated, {
    type: "resubmitted",
    actor: "creator",
    actorId: user._id,
    actorName: updated.creatorHandle,
    metadata: { videoUrl: updated.videoUrl, caption: updated.caption, round: changeRequestsUsed(updated) },
  });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_resubmitted",
    title: "Updated content to review",
    body: `${updated.creatorHandle} updated their content for "${campaign.name}". ${changeRequestsLeft(updated)} change request${changeRequestsLeft(updated) === 1 ? "" : "s"} left.`,
  });
  afterChange(updated);
  return updated;
}

// `actor` is { kind: "brand", user } or { kind: "system" }.
async function approveContent({ submission, campaign, actor, now = new Date() }) {
  if (submission.status !== "new") fail(400, "NOT_AWAITING_REVIEW", "Can only approve content waiting for review");
  const auto = actor.kind === "system";
  const updated = await transition(submission, ["new"], {
    $set: { status: statusAfterApproval(campaign), reviewedAt: now, ...(auto && { autoApproved: true }) },
  });

  await recordEvent(updated, {
    type: "approved",
    actor: auto ? "system" : "brand",
    actorId: auto ? null : actor.user._id,
    actorName: auto ? null : actor.user.name,
    metadata: auto ? { auto: true, reason: "No brand response within 72 hours" } : {},
  });
  if (destinationOf(campaign) === "brand_page") await fixedPayDue(updated, campaign, { trigger: "approved" });

  const next = needsDelivery(campaign)
    ? "Share a download link for the brand."
    : "Post it on your page and share the live link.";
  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: auto ? "content_auto_approved" : "content_approved",
    title: auto ? "Content approved automatically" : "Content approved",
    body: auto
      ? `The brand didn't respond within 72 hours, so your content for "${campaign.name}" was approved. ${next}`
      : `Your content for "${campaign.name}" was approved. ${next}`,
  });
  if (auto) {
    await notify({
      campaign,
      submission: updated,
      to: "brand",
      type: "content_auto_approved",
      title: "Content approved automatically",
      body: `${updated.creatorHandle}'s content for "${campaign.name}" waited 72 hours without a review, so it was approved.`,
    });
  }
  afterChange(updated);
  return updated;
}

async function appealRejection({ submission, campaign, user, reason }) {
  const text = String(reason || "").trim();
  if (!text) fail(400, "REASON_REQUIRED", "Say why the rejection should be reviewed");
  if (submission.status !== "rejected") fail(400, "NOT_REJECTED", "Only rejected content can be appealed");
  const updated = await transition(submission, ["rejected"], { $set: { status: "appealed", appealReason: text } });
  await recordEvent(updated, { type: "appealed", actor: "creator", actorId: user._id, actorName: updated.creatorHandle, reason: text });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_appealed",
    title: "Rejection appealed",
    body: `${updated.creatorHandle} appealed the rejection of their content for "${campaign.name}". EasilyPromote will review it.`,
  });
  afterChange(updated);
  return updated;
}

async function shareDelivery({ submission, campaign, user, url, acceptUsageRights }) {
  if (!needsDelivery(campaign)) fail(400, "NO_BRAND_DELIVERY", "This campaign's content goes on your page, not to the brand");
  if (!["awaiting_delivery", "delivered"].includes(submission.status)) {
    fail(400, "NOT_AWAITING_DELIVERY", "Share a download link once your content is approved");
  }
  if (!isHttpUrl(url)) fail(400, "DOWNLOAD_LINK_REQUIRED", "Add a download link the brand can open");
  if (acceptUsageRights !== true) {
    fail(400, "USAGE_RIGHTS_REQUIRED", "Accept the usage rights to deliver content to the brand", { licence: USAGE_RIGHTS_LICENCE });
  }

  const now = new Date();
  const replacing = submission.status === "delivered";
  const updated = await transition(submission, ["awaiting_delivery", "delivered"], {
    $set: {
      status: "delivered",
      "delivery.url": String(url).trim(),
      "delivery.sharedAt": now,
      "usageRights.licence": USAGE_RIGHTS_LICENCE,
      "usageRights.acceptedAt": now,
      "usageRights.acceptedBy": user._id,
    },
  });
  await recordEvent(updated, {
    type: "delivery_shared",
    actor: "creator",
    actorId: user._id,
    actorName: updated.creatorHandle,
    metadata: { url: updated.delivery.url, usageRightsAccepted: true, licence: USAGE_RIGHTS_LICENCE, replacing },
  });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_delivered",
    title: "Content delivered",
    body: `${updated.creatorHandle} shared a download link for "${campaign.name}". Download it and confirm you received it.`,
  });
  afterChange(updated);
  return updated;
}

async function confirmReceipt({ submission, campaign, user }) {
  if (submission.status !== "delivered") fail(400, "NOT_DELIVERED", "There's no delivered content to confirm");
  const now = new Date();
  const posting = needsPost(campaign);
  const updated = await transition(submission, ["delivered"], {
    $set: { "delivery.confirmedAt": now, "delivery.confirmedBy": user._id, ...(posting && { status: "awaiting_post" }) },
  });
  await recordEvent(updated, { type: "receipt_confirmed", actor: "brand", actorId: user._id, actorName: user.name });

  if (!posting) return complete(updated, campaign, { now });

  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: "content_receipt_confirmed",
    title: "Brand received your content",
    body: `The brand confirmed it received your content for "${campaign.name}". Now post it on your page and share the live link.`,
  });
  afterChange(updated);
  return updated;
}

const normalizePlatform = (value) => {
  const p = String(value || "").trim().toLowerCase();
  if (!p) return null;
  if (p === "twitter" || p === "x (twitter)" || p === "x") return "x";
  if (p === "youtube" || p === "youtube shorts") return "youtube";
  return p;
};

const normalizeTag = (tag) => String(tag || "").trim().replace(/^#+/, "").toLowerCase();

// Hashtags from the brief that the caption doesn't carry, as "#Tag" in the brief's spelling.
function missingHashtags(requiredTags, caption) {
  const present = new Set((String(caption || "").match(/#[\p{L}\p{N}_]+/gu) || []).map(normalizeTag));
  return (requiredTags || [])
    .filter((tag) => normalizeTag(tag))
    .filter((tag) => !present.has(normalizeTag(tag)))
    .map((tag) => `#${String(tag).trim().replace(/^#+/, "")}`);
}

async function markContentPosted({ submission, campaign, user, posts, caption }) {
  if (!needsPost(campaign)) fail(400, "NO_CREATOR_POST", "This campaign's content goes to the brand. Share a download link instead");
  if (!["awaiting_post", "verifying"].includes(submission.status)) {
    const message = submission.status === "awaiting_delivery" || submission.status === "delivered"
      ? "Deliver the content to the brand first, then post it"
      : "You can share a live post link once your content is approved";
    fail(400, "NOT_AWAITING_POST", message);
  }

  const links = (Array.isArray(posts) ? posts : [])
    .map((post) => ({ platform: normalizePlatform(post && post.platform), postUrl: String((post && post.postUrl) || "").trim() }))
    .filter((post) => post.platform && post.postUrl);
  if (links.length === 0 || links.some((post) => !isHttpUrl(post.postUrl))) {
    fail(400, "POST_LINK_REQUIRED", "Add the link to your live post");
  }

  // The live caption must carry the brief's hashtags, and the creator's referral code when
  // the campaign tracks referrals. Both are required, not warnings: the brand is paying for them.
  const brief = campaign.brief || {};
  const missing = missingHashtags(brief.hashtags, caption);
  if (missing.length > 0) {
    fail(400, "MISSING_HASHTAGS", `Your caption is missing ${missing.join(", ")}`, { missing });
  }
  if (campaign.referral && campaign.referral.enabled) {
    const code = await ReferralCode.findOne({ campaignId: campaign._id, creatorId: submission.creatorId }).select("code").lean();
    if (code && !String(caption || "").toUpperCase().includes(String(code.code).toUpperCase())) {
      fail(400, "MISSING_REFERRAL_CODE", `Your caption is missing your referral code ${code.code}`, { referralCode: code.code });
    }
  }

  const postedPlatforms = (submission.postedPlatforms || []).map((p) => (p.toObject ? p.toObject() : p));
  for (const link of links) {
    const entry = postedPlatforms.find((p) => p.platform === link.platform);
    if (entry) entry.postUrl = link.postUrl;
    else postedPlatforms.push({ platform: link.platform, postUrl: link.postUrl, views: 0, likes: 0, comments: 0 });
  }

  const now = new Date();
  const additional = submission.status === "verifying";
  const updated = await transition(submission, ["awaiting_post", "verifying"], {
    $set: {
      status: "verifying",
      postedPlatforms,
      postedCaption: String(caption || ""),
      ...(!submission.postedAt && { postedAt: now }),
    },
  });
  await recordEvent(updated, {
    type: "posted",
    actor: "creator",
    actorId: user._id,
    actorName: updated.creatorHandle,
    metadata: { additional, caption: updated.postedCaption, platforms: postedPlatforms.map((p) => ({ platform: p.platform, postUrl: p.postUrl })) },
  });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_posted",
    title: "Live post to verify",
    body: `${updated.creatorHandle} posted their content for "${campaign.name}". Check the live post and confirm it.`,
  });
  afterChange(updated);
  return updated;
}

async function confirmPost({ submission, campaign, user }) {
  if (submission.status !== "verifying") fail(400, "NOT_VERIFYING", "There's no live post waiting to be verified");
  const now = new Date();
  const updated = await transition(submission, ["verifying"], { $set: { postVerifiedAt: now } });
  await recordEvent(updated, { type: "post_verified", actor: "brand", actorId: user._id, actorName: user.name });
  await fixedPayDue(updated, campaign, { trigger: "post_verified" });
  return complete(updated, campaign, { now });
}

// The brand can't find the post or it doesn't match: back to the creator with a note.
async function disputePost({ submission, campaign, user, notes }) {
  const text = String(notes || "").trim();
  if (!text) fail(400, "NOTES_REQUIRED", "Tell the creator what's wrong with the post");
  if (submission.status !== "verifying") fail(400, "NOT_VERIFYING", "There's no live post waiting to be verified");
  const updated = await transition(submission, ["verifying"], { $set: { status: "awaiting_post" } });
  await recordEvent(updated, { type: "post_disputed", actor: "brand", actorId: user._id, actorName: user.name, reason: text });
  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: "content_post_disputed",
    title: "Check your live post",
    body: `The brand couldn't verify your post for "${campaign.name}": ${text}`,
  });
  afterChange(updated);
  return updated;
}

// D10: approves content that has waited on the brand for 72 hours. `now` is injectable for tests.
async function autoApproveStaleSubmissions(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_APPROVE_AFTER_MS);
  // Views campaigns keep their manual review, so only content campaigns' submissions are read.
  const contentCampaignIds = await Campaign.distinct("_id", {
    $or: [{ campaignModel: "content" }, { campaignModel: { $exists: false }, campaignObjective: "content" }],
    status: { $ne: "cancelled" },
  });
  if (contentCampaignIds.length === 0) return { approved: 0 };
  const candidates = await Submission.find({
    campaignId: { $in: contentCampaignIds },
    status: "new",
    $or: [
      { awaitingReviewSince: { $lte: cutoff } },
      { awaitingReviewSince: { $exists: false }, submittedAt: { $lte: cutoff } },
    ],
  })
    .sort({ awaitingReviewSince: 1 })
    .limit(500);

  let approved = 0;
  const campaigns = new Map();
  for (const submission of candidates) {
    const key = String(submission.campaignId);
    if (!campaigns.has(key)) campaigns.set(key, await Campaign.findById(submission.campaignId));
    const campaign = campaigns.get(key);
    if (!isContentCampaign(campaign)) continue;
    try {
      await approveContent({ submission, campaign, actor: { kind: "system" }, now });
      approved += 1;
    } catch (error) {
      if (!(error instanceof ContentApprovalError)) {
        console.error("[Content] Auto-approve failed for submission", String(submission._id), error.message);
      }
    }
  }
  return { approved };
}

function startContentAutoApprove() {
  const run = () =>
    autoApproveStaleSubmissions().catch((error) => console.error("[Content] Auto-approve run failed:", error.message));
  run();
  setInterval(run, AUTO_APPROVE_INTERVAL_MS);
}

// What the brand and the creator see about a content submission's approval and delivery.
function contentApprovalView(submission, campaign) {
  return {
    status: submission.status,
    destination: destinationOf(campaign),
    maxChangeRequests: MAX_CHANGE_REQUESTS,
    changeRequestsLeft: changeRequestsLeft(submission),
    changeRequests: (submission.changeRequests || []).map((r) => ({
      round: r.round,
      notes: r.notes,
      requestedAt: r.requestedAt,
      videoUrl: r.videoUrl || null,
      caption: r.caption || null,
      resubmittedAt: r.resubmittedAt || null,
    })),
    autoApproved: Boolean(submission.autoApproved),
    awaitingReviewSince: submission.awaitingReviewSince || null,
    reviewDueAt: reviewDueAt(submission),
    rejectionReason: submission.rejectionReason || null,
    appealReason: submission.appealReason || null,
    delivery: submission.delivery && submission.delivery.url
      ? { url: submission.delivery.url, sharedAt: submission.delivery.sharedAt || null, confirmedAt: submission.delivery.confirmedAt || null }
      : null,
    usageRights: submission.usageRights && submission.usageRights.acceptedAt
      ? {
          licence: submission.usageRights.licence,
          acceptedAt: submission.usageRights.acceptedAt,
          acceptedBy: submission.usageRights.acceptedBy ? String(submission.usageRights.acceptedBy) : null,
        }
      : null,
    postedCaption: submission.postedCaption || null,
    postVerifiedAt: submission.postVerifiedAt || null,
    completedAt: submission.completedAt || null,
    licence: needsDelivery(campaign) ? USAGE_RIGHTS_LICENCE : null,
  };
}

module.exports = {
  MAX_CHANGE_REQUESTS,
  AUTO_APPROVE_AFTER_MS,
  USAGE_RIGHTS_LICENCE,
  ContentApprovalError,
  isContentCampaign,
  destinationOf,
  statusAfterApproval,
  missingHashtags,
  fixedPayDue,
  submitContent,
  requestChanges,
  resubmit,
  approveContent,
  appealRejection,
  shareDelivery,
  confirmReceipt,
  markContentPosted,
  confirmPost,
  disputePost,
  autoApproveStaleSubmissions,
  startContentAutoApprove,
  contentApprovalView,
};
