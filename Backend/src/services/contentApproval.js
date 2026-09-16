// Content Approval and delivery (ticket 07, ADR 0002).
//
// A creator holding a deliverable placement in a content campaign submits content; the brand
// approves, requests changes (at most 2 rounds, D11) or rejects (appealable). Approved content
// then goes where the campaign says:
//
//   creator_page: awaiting_post → (live post link) verifying → (brand verifies) completed
//   brand_page:   awaiting_delivery → (download link + usage rights) awaiting_receipt → (brand confirms receipt) completed
//   both:         awaiting_delivery → awaiting_receipt → (receipt) awaiting_post → verifying → completed
//
// Whatever waits on the brand (review, receipt, post verification) is done automatically after
// 72 hours without a response (D10).
//
// Every transition moves the status in the same guarded update that authorises it, so events,
// notifications and the pay seam only ever fire for the request that won. These transitions never
// read or write an application. The one placement change is releasing the place of rejected
// content (and taking it back if an appeal is upheld while it's still free).
// Views / performance campaigns never come through here.
const Submission = require("../models/Submission");
const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const ReferralCode = require("../models/ReferralCode");
const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const { emitToUser, emitToRole } = require("../config/socket");
const { emitCampaignUpdate, emitPlacesLeft } = require("../utils/campaignUpdates");
const { isContentCampaign } = require("../utils/campaignPay");
const { missingHashtags, captionHasCode } = require("../utils/captionRules");
const { HELD_PLACEMENT_STATUSES } = require("../utils/placementStatuses");
const { recordEvent } = require("./submissionEvents");

const MAX_CHANGE_REQUESTS = 2;
const BRAND_RESPONSE_MS = 72 * 60 * 60 * 1000;
const DEADLINE_INTERVAL_MS = 15 * 60 * 1000;
// Statuses waiting on the brand; each is resolved automatically after BRAND_RESPONSE_MS.
const WAITING_ON_BRAND = ["new", "awaiting_receipt", "verifying"];

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

function destinationOf(campaign) {
  return (campaign && campaign.contentDestination) || "creator_page";
}

const needsDelivery = (campaign) => ["brand_page", "both"].includes(destinationOf(campaign));
const needsPost = (campaign) => ["creator_page", "both"].includes(destinationOf(campaign));

function statusAfterApproval(campaign) {
  return needsDelivery(campaign) ? "awaiting_delivery" : "awaiting_post";
}

const changeRequestsUsed = (submission) => (submission.changeRequests || []).length;
const changeRequestsLeft = (submission) => Math.max(MAX_CHANGE_REQUESTS - changeRequestsUsed(submission), 0);

function brandDueAt(submission) {
  if (!WAITING_ON_BRAND.includes(submission.status) || !submission.awaitingBrandSince) return null;
  return new Date(new Date(submission.awaitingBrandSince).getTime() + BRAND_RESPONSE_MS);
}

const isHttpUrl = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// actor: { kind: "creator" | "brand" | "admin" | "system", user? }
function eventActor(actor, submission) {
  if (actor.kind === "system") return { actor: "system" };
  if (actor.kind === "creator") return { actor: "creator", actorId: actor.user._id, actorName: submission.creatorHandle };
  return { actor: actor.kind, actorId: actor.user._id, actorName: actor.user.name };
}

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

// Moves a submission only if it is still in one of `from`. The request that loses a race gets 409
// and records nothing.
async function transition(submission, from, update) {
  const updated = await Submission.findOneAndUpdate({ _id: submission._id, status: { $in: from } }, update, { new: true });
  if (!updated) fail(409, "STATUS_CHANGED", "This submission has changed. Refresh to see where it is now.");
  return updated;
}

function afterChange(submission) {
  // Socket pushes never fail the request.
  emitCampaignUpdate(submission).catch((error) => console.error("[Content] update emit failed:", error.message));
}

// ── M6 seam ─────────────────────────────────────────────────────────────────
// D1: fixed pay is due on approval for brand-page content, and once the live post is verified for
// creator-page / both. Crediting is ticket M6; this records, once per submission, that pay became
// due. fixedPayDueAt is claimed atomically, so a second call does nothing. Returns whether it fired.
async function fixedPayDue(submission, campaign, { trigger, now = new Date() }) {
  const claimed = await Submission.findOneAndUpdate(
    { _id: submission._id, fixedPayDueAt: null },
    { $set: { fixedPayDueAt: now } },
    { new: true }
  );
  if (!claimed) return false;
  const slot = claimed.slotId
    ? await Slot.findById(claimed.slotId).select("reward").lean()
    : await Slot.findOne({ campaignId: campaign._id, creatorId: claimed.creatorId }).select("reward").lean();
  await recordEvent(claimed, {
    type: "fixed_pay_due",
    actor: "system",
    metadata: { trigger, amount: slot ? slot.reward : null, credited: false },
  });
  return true;
}

// Runs once, for the request whose guarded update moved the submission into completed.
async function afterCompleted(completed, campaign, now) {
  // The placement's work is done: still held by the creator, no longer counted as active.
  await Slot.updateOne(
    {
      ...(completed.slotId ? { _id: completed.slotId } : { campaignId: campaign._id }),
      creatorId: completed.creatorId,
      status: { $in: ["claimed", "submitted", "verifying"] },
    },
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
}

async function notifyAutoConfirmed(campaign, submission, what) {
  await notify({
    campaign,
    submission,
    to: "brand",
    type: "content_auto_confirmed",
    title: `${what} confirmed automatically`,
    body: `${submission.creatorHandle}'s ${what.toLowerCase()} for "${campaign.name}" waited 72 hours without a response, so it was confirmed.`,
  });
}

// Gives a rejected creator's place back to the campaign so another creator can deliver it.
async function releasePlacement(submission, campaign) {
  const released = await Slot.findOneAndUpdate(
    {
      ...(submission.slotId ? { _id: submission.slotId } : { campaignId: campaign._id }),
      creatorId: submission.creatorId,
      status: { $in: ["claimed", "submitted"] },
    },
    { $set: { creatorId: null, status: "available", claimedAt: null, submissionUrl: null } }
  );
  if (released) await emitPlacesLeft(campaign._id);
}

// ── Transitions ─────────────────────────────────────────────────────────────

async function submitContent({ user, campaign, videoUrl, caption, durationSeconds }) {
  if (!isHttpUrl(videoUrl)) fail(400, "VIDEO_URL_REQUIRED", "Add a link to your content");

  const [slot, existing] = await Promise.all([
    Slot.findOne({ campaignId: campaign._id, creatorId: user._id, kind: "deliverable", status: { $in: HELD_PLACEMENT_STATUSES } }).lean(),
    Submission.exists({ campaignId: campaign._id, creatorId: user._id }),
  ]);
  if (!slot) fail(403, "PLACEMENT_REQUIRED", "Join this campaign before submitting content");
  // A creator's content for a campaign is one submission for good: changes go through change
  // requests, and a rejection is final unless appealed (rejoining doesn't reset it).
  const limit = () => fail(409, "SUBMISSION_LIMIT", "You've already submitted content for this campaign");
  if (existing) limit();

  const [account, profile] = await Promise.all([User.findById(user._id), CreatorProfile.findOne({ userId: user._id })]);
  const now = new Date();
  let submission;
  try {
    submission = await Submission.create({
      campaignId: campaign._id,
      creatorId: user._id,
      slotId: slot._id,
      creatorHandle: profile ? profile.username : account.name,
      videoUrl: String(videoUrl).trim(),
      caption,
      durationSeconds,
      status: "new",
      submittedAt: now,
      awaitingBrandSince: now,
    });
  } catch (error) {
    // The unique (slot, creator) index caught a concurrent second submit.
    if (error.code === 11000) limit();
    throw error;
  }

  await Slot.updateOne({ _id: slot._id, creatorId: user._id, status: "claimed" }, { $set: { status: "submitted", submissionUrl: submission.videoUrl } });
  await recordEvent(submission, {
    type: "submitted",
    ...eventActor({ kind: "creator", user }, submission),
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
  const used = changeRequestsUsed(submission);
  const exhausted = () =>
    fail(409, "CHANGE_REQUESTS_USED", `You've used all ${MAX_CHANGE_REQUESTS} change requests. Approve or reject this content.`);
  if (used >= MAX_CHANGE_REQUESTS) exhausted();

  const now = new Date();
  // The round count is part of the guard, so two concurrent requests can't both add a round.
  const updated = await Submission.findOneAndUpdate(
    { _id: submission._id, status: "new", [`changeRequests.${MAX_CHANGE_REQUESTS - 1}`]: { $exists: false } },
    {
      $set: { status: "changes_requested", reviewedAt: now },
      $unset: { awaitingBrandSince: 1 },
      $push: {
        changeRequests: { round: used + 1, notes: text, requestedAt: now, requestedBy: user._id, videoUrl: submission.videoUrl, caption: submission.caption },
      },
    },
    { new: true }
  );
  if (!updated) fail(409, "STATUS_CHANGED", "This submission has changed. Refresh to see where it is now.");
  const round = changeRequestsUsed(updated);

  await recordEvent(updated, { type: "changes_requested", ...eventActor({ kind: "brand", user }, updated), reason: text, metadata: { round } });
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

// A creator edits content still waiting for review (no new round), or resubmits after the
// brand asked for changes (starts the next review).
async function editOrResubmitContent({ submission, campaign, user, videoUrl, caption }) {
  if (videoUrl !== undefined && !isHttpUrl(videoUrl)) fail(400, "VIDEO_URL_REQUIRED", "Add a link to your content");
  const set = {};
  if (videoUrl !== undefined) set.videoUrl = String(videoUrl).trim();
  if (caption !== undefined) set.caption = caption;

  if (submission.status === "new") {
    const updated = await transition(submission, ["new"], { $set: set });
    await recordEvent(updated, {
      type: "content_edited",
      ...eventActor({ kind: "creator", user }, updated),
      metadata: { videoUrl: updated.videoUrl, caption: updated.caption },
    });
    afterChange(updated);
    return updated;
  }
  if (submission.status !== "changes_requested") {
    fail(400, "NOT_EDITABLE", "Content can only be changed while it's waiting for review or the brand asked for changes");
  }

  const now = new Date();
  const last = changeRequestsUsed(submission) - 1;
  const updated = await transition(submission, ["changes_requested"], {
    $set: { ...set, status: "new", awaitingBrandSince: now, ...(last >= 0 && { [`changeRequests.${last}.resubmittedAt`]: now }) },
  });
  await recordEvent(updated, {
    type: "resubmitted",
    ...eventActor({ kind: "creator", user }, updated),
    metadata: { videoUrl: updated.videoUrl, caption: updated.caption, round: changeRequestsUsed(updated) },
  });
  const left = changeRequestsLeft(updated);
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_resubmitted",
    title: "Updated content to review",
    body: `${updated.creatorHandle} updated their content for "${campaign.name}". ${left} change request${left === 1 ? "" : "s"} left.`,
  });
  afterChange(updated);
  return updated;
}

async function approveContent({ submission, campaign, actor, now = new Date() }) {
  if (submission.status !== "new") fail(400, "NOT_AWAITING_REVIEW", "Can only approve content waiting for review");
  const auto = actor.kind === "system";
  const updated = await transition(submission, ["new"], {
    $set: { status: statusAfterApproval(campaign), reviewedAt: now, ...(auto && { autoApproved: true }) },
    $unset: { awaitingBrandSince: 1 },
  });

  await recordEvent(updated, {
    type: "approved",
    ...eventActor(actor, updated),
    metadata: auto ? { auto: true, reason: "No brand response within 72 hours" } : {},
  });
  if (destinationOf(campaign) === "brand_page") await fixedPayDue(updated, campaign, { trigger: "approved", now });

  const next = needsDelivery(campaign) ? "Share a download link for the brand." : "Post it on your page and share the live link.";
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

async function rejectContent({ submission, campaign, actor, reason }) {
  const text = String(reason || "").trim();
  if (!text) fail(400, "REASON_REQUIRED", "A rejection reason is required");
  if (submission.status !== "new") fail(400, "NOT_AWAITING_REVIEW", "Can only reject content waiting for review");
  const updated = await transition(submission, ["new"], {
    $set: { status: "rejected", rejectionReason: text, reviewedAt: new Date() },
    $unset: { awaitingBrandSince: 1 },
  });
  await recordEvent(updated, { type: "rejected", ...eventActor(actor, updated), reason: text });
  await releasePlacement(updated, campaign);
  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: "content_rejected",
    title: "Content rejected",
    body: `Your content for "${campaign.name}" was rejected: ${text}. You can appeal if it meets the brief.`,
  });
  afterChange(updated);
  return updated;
}

async function appealRejection({ submission, campaign, user, reason }) {
  const text = String(reason || "").trim();
  if (!text) fail(400, "REASON_REQUIRED", "Say why the rejection should be reviewed");
  if (submission.status !== "rejected") fail(400, "NOT_REJECTED", "Only rejected content can be appealed");
  const updated = await transition(submission, ["rejected"], { $set: { status: "appealed", appealReason: text } });
  await recordEvent(updated, { type: "appealed", ...eventActor({ kind: "creator", user }, updated), reason: text });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_appealed",
    title: "Rejection appealed",
    body: `${updated.creatorHandle} appealed the rejection of their content for "${campaign.name}". EasilyPromote will review it.`,
  });
  // Admins have no in-app notification inbox; the console's appealed count picks this up, and
  // signed-in admins get a push.
  for (const role of ["admin", "super_admin", "support"]) {
    emitToRole(role, "submission-appealed", { submissionId: updated._id, campaignId: campaign._id, campaignName: campaign.name });
  }
  afterChange(updated);
  return updated;
}

// Admin's decision on an appeal. Upholding it approves the content, which needs the creator's
// place back: it's taken again only if still free.
async function decideAppeal({ submission, campaign, admin, decision, notes }) {
  if (submission.status !== "appealed") fail(409, "NOT_APPEALED", "This submission has no open appeal");
  const actor = { kind: "admin", user: admin };

  if (decision === "reject") {
    const updated = await transition(submission, ["appealed"], { $set: { status: "rejected", adminNotes: notes || "Appeal rejected by Admin" } });
    await recordEvent(updated, { type: "appeal_rejected", ...eventActor(actor, updated), reason: notes || null });
    await notify({
      campaign,
      submission: updated,
      to: "creator",
      type: "content_appeal_rejected",
      title: "Appeal rejected",
      body: `Your appeal for "${campaign.name}" was rejected.${notes ? ` ${notes}` : ""}`,
    });
    afterChange(updated);
    return updated;
  }

  const now = new Date();
  let retaken = null;
  if (submission.slotId) {
    try {
      retaken = await Slot.findOneAndUpdate(
        { _id: submission.slotId, $or: [{ creatorId: submission.creatorId }, { status: "available" }] },
        { $set: { creatorId: submission.creatorId, status: "submitted", claimedAt: now } },
        { new: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    if (!retaken) {
      fail(409, "PLACEMENT_TAKEN", "The creator's place in this campaign has been taken by another creator, so this appeal can't be approved");
    }
  }

  let updated;
  try {
    updated = await transition(submission, ["appealed"], {
      $set: { status: statusAfterApproval(campaign), reviewedAt: now, adminNotes: notes || "Appeal approved by Admin" },
    });
  } catch (error) {
    if (retaken) {
      await Slot.updateOne({ _id: retaken._id, creatorId: submission.creatorId }, { $set: { creatorId: null, status: "available", claimedAt: null } });
    }
    throw error;
  }
  if (retaken) await emitPlacesLeft(campaign._id);
  await recordEvent(updated, { type: "appeal_approved", ...eventActor(actor, updated), reason: notes || null });
  if (destinationOf(campaign) === "brand_page") await fixedPayDue(updated, campaign, { trigger: "appeal_approved", now });
  await notify({
    campaign,
    submission: updated,
    to: "creator",
    type: "content_appeal_approved",
    title: "Appeal approved",
    body: `Your appeal for "${campaign.name}" was approved. Your content is approved.`,
  });
  afterChange(updated);
  return updated;
}

async function shareDelivery({ submission, campaign, user, url, acceptUsageRights }) {
  if (!needsDelivery(campaign)) fail(400, "NO_BRAND_DELIVERY", "This campaign's content goes on your page, not to the brand");
  if (!["awaiting_delivery", "awaiting_receipt"].includes(submission.status)) {
    fail(400, "NOT_AWAITING_DELIVERY", "Share a download link once your content is approved");
  }
  if (!isHttpUrl(url)) fail(400, "DOWNLOAD_LINK_REQUIRED", "Add a download link the brand can open");
  if (acceptUsageRights !== true) {
    fail(400, "USAGE_RIGHTS_REQUIRED", "Accept the usage rights to deliver content to the brand", { licence: USAGE_RIGHTS_LICENCE });
  }

  const now = new Date();
  const replacing = submission.status === "awaiting_receipt";
  const updated = await transition(submission, ["awaiting_delivery", "awaiting_receipt"], {
    $set: {
      status: "awaiting_receipt",
      // A new link gives the brand a fresh 72 hours to check it.
      awaitingBrandSince: now,
      "delivery.url": String(url).trim(),
      "delivery.sharedAt": now,
      "usageRights.licence": USAGE_RIGHTS_LICENCE,
      "usageRights.acceptedAt": now,
      "usageRights.acceptedBy": user._id,
    },
  });
  await recordEvent(updated, {
    type: "delivery_shared",
    ...eventActor({ kind: "creator", user }, updated),
    metadata: { url: updated.delivery.url, usageRightsAccepted: true, licence: USAGE_RIGHTS_LICENCE, replacing },
  });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_delivered",
    title: "Content delivered",
    body: `${updated.creatorHandle} shared a download link for "${campaign.name}". Download it and confirm you received it within 72 hours.`,
  });
  afterChange(updated);
  return updated;
}

// The brand confirms it received the file: the content is delivered. Brand page completes;
// both moves on to the live post.
async function confirmReceipt({ submission, campaign, actor, now = new Date() }) {
  if (submission.status !== "awaiting_receipt") fail(400, "NOT_AWAITING_RECEIPT", "There's no delivered content to confirm");
  const posting = needsPost(campaign);
  const updated = await transition(submission, ["awaiting_receipt"], {
    $set: {
      status: posting ? "awaiting_post" : "completed",
      "delivery.confirmedAt": now,
      "delivery.confirmedBy": actor.user ? actor.user._id : null,
      ...(!posting && { completedAt: now }),
    },
    $unset: { awaitingBrandSince: 1 },
  });
  await recordEvent(updated, {
    type: "receipt_confirmed",
    ...eventActor(actor, updated),
    metadata: actor.kind === "system" ? { auto: true } : {},
  });
  if (actor.kind === "system") await notifyAutoConfirmed(campaign, updated, "Receipt");

  if (!posting) {
    await afterCompleted(updated, campaign, now);
  } else {
    await notify({
      campaign,
      submission: updated,
      to: "creator",
      type: "content_receipt_confirmed",
      title: "Brand received your content",
      body: `The brand's copy of your content for "${campaign.name}" is confirmed. Now post it on your page and share the live link.`,
    });
  }
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

async function markContentPosted({ submission, campaign, user, posts, caption }) {
  if (!needsPost(campaign)) fail(400, "NO_CREATOR_POST", "This campaign's content goes to the brand. Share a download link instead");
  if (!["awaiting_post", "verifying"].includes(submission.status)) {
    const message = ["awaiting_delivery", "awaiting_receipt"].includes(submission.status)
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

  // The live caption must carry the brief's hashtags and, when the campaign tracks referrals, the
  // creator's code. Both are required, not warnings: the brand is paying for them.
  const missing = missingHashtags((campaign.brief && campaign.brief.hashtags) || [], caption);
  if (missing.length > 0) fail(400, "MISSING_HASHTAGS", `Your caption is missing ${missing.join(", ")}`, { missing });
  if (campaign.referral && campaign.referral.enabled) {
    const code = await ReferralCode.findOne({ campaignId: campaign._id, creatorId: submission.creatorId }).select("code").lean();
    if (!code) {
      fail(409, "REFERRAL_CODE_PENDING", "Your referral code for this campaign isn't ready yet. Post once it shows on your campaign page.");
    }
    if (!captionHasCode(caption, code.code)) {
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
  const updated = await transition(submission, [submission.status], {
    $set: {
      status: "verifying",
      postedPlatforms,
      postedCaption: String(caption || ""),
      ...(!additional && { awaitingBrandSince: now }),
      ...(!submission.postedAt && { postedAt: now }),
    },
  });
  await recordEvent(updated, {
    type: "posted",
    ...eventActor({ kind: "creator", user }, updated),
    metadata: { additional, caption: updated.postedCaption, platforms: postedPlatforms.map((p) => ({ platform: p.platform, postUrl: p.postUrl })) },
  });
  await notify({
    campaign,
    submission: updated,
    to: "brand",
    type: "content_posted",
    title: "Live post to verify",
    body: `${updated.creatorHandle} posted their content for "${campaign.name}". Check the live post and confirm it within 72 hours.`,
  });
  afterChange(updated);
  return updated;
}

async function confirmPost({ submission, campaign, actor, now = new Date() }) {
  if (submission.status !== "verifying") fail(400, "NOT_VERIFYING", "There's no live post waiting to be verified");
  const updated = await transition(submission, ["verifying"], {
    $set: { status: "completed", postVerifiedAt: now, completedAt: now },
    $unset: { awaitingBrandSince: 1 },
  });
  await recordEvent(updated, {
    type: "post_verified",
    ...eventActor(actor, updated),
    metadata: actor.kind === "system" ? { auto: true } : {},
  });
  await fixedPayDue(updated, campaign, { trigger: "post_verified", now });
  if (actor.kind === "system") await notifyAutoConfirmed(campaign, updated, "Live post");
  await afterCompleted(updated, campaign, now);
  afterChange(updated);
  return updated;
}

// The brand can't find the post or it doesn't match: back to the creator with a note.
async function disputePost({ submission, campaign, user, notes }) {
  const text = String(notes || "").trim();
  if (!text) fail(400, "NOTES_REQUIRED", "Tell the creator what's wrong with the post");
  if (submission.status !== "verifying") fail(400, "NOT_VERIFYING", "There's no live post waiting to be verified");
  const updated = await transition(submission, ["verifying"], { $set: { status: "awaiting_post" }, $unset: { awaitingBrandSince: 1 } });
  await recordEvent(updated, { type: "post_disputed", ...eventActor({ kind: "brand", user }, updated), reason: text });
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

const AUTO_ACTIONS = {
  new: (ctx) => approveContent(ctx),
  awaiting_receipt: (ctx) => confirmReceipt(ctx),
  verifying: (ctx) => confirmPost(ctx),
};

// D10, extended: whatever has waited on the brand for 72 hours (review, receipt, post verification)
// is done automatically, as the system. `now` is injectable for tests. Returns counts per status.
async function autoApproveStaleSubmissions(now = new Date()) {
  const cutoff = new Date(now.getTime() - BRAND_RESPONSE_MS);
  // Views campaigns keep their manual review, so only content campaigns' submissions are read.
  const contentCampaignIds = await Campaign.distinct("_id", {
    $or: [{ campaignModel: "content" }, { campaignModel: { $exists: false }, campaignObjective: "content" }],
    status: { $ne: "cancelled" },
  });
  const result = { approved: 0, receiptsConfirmed: 0, postsVerified: 0 };
  if (contentCampaignIds.length === 0) return result;

  const candidates = await Submission.find({
    campaignId: { $in: contentCampaignIds },
    status: { $in: WAITING_ON_BRAND },
    awaitingBrandSince: { $lte: cutoff },
  })
    .sort({ awaitingBrandSince: 1 })
    .limit(500);

  const campaigns = new Map();
  const counter = { new: "approved", awaiting_receipt: "receiptsConfirmed", verifying: "postsVerified" };
  for (const submission of candidates) {
    const key = String(submission.campaignId);
    if (!campaigns.has(key)) campaigns.set(key, await Campaign.findById(submission.campaignId));
    const campaign = campaigns.get(key);
    if (!isContentCampaign(campaign)) continue;
    try {
      await AUTO_ACTIONS[submission.status]({ submission, campaign, actor: { kind: "system" }, now });
      result[counter[submission.status]] += 1;
    } catch (error) {
      // A brand acting at the same moment wins; anything else is logged and retried next run.
      if (!(error instanceof ContentApprovalError)) {
        console.error("[Content] Auto-confirm failed for submission", String(submission._id), error.message);
      }
    }
  }
  return result;
}

function startContentAutoApprove() {
  const run = () => autoApproveStaleSubmissions().catch((error) => console.error("[Content] Deadline run failed:", error.message));
  run();
  setInterval(run, DEADLINE_INTERVAL_MS);
}

// What the brand and the creator see about a content submission's approval and delivery.
function contentApprovalView(submission, campaign) {
  const hashtags = (campaign.brief && campaign.brief.hashtags) || [];
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
    // When whatever waits on the brand is done automatically.
    brandDueAt: brandDueAt(submission),
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
    // Brief hashtags the submitted caption and the posted caption don't carry, judged here only.
    missingHashtags: missingHashtags(hashtags, submission.caption),
    postedCaption: submission.postedCaption || null,
    postedMissingHashtags: submission.postedCaption ? missingHashtags(hashtags, submission.postedCaption) : [],
    postVerifiedAt: submission.postVerifiedAt || null,
    completedAt: submission.completedAt || null,
    licence: needsDelivery(campaign) ? USAGE_RIGHTS_LICENCE : null,
  };
}

module.exports = {
  MAX_CHANGE_REQUESTS,
  BRAND_RESPONSE_MS,
  USAGE_RIGHTS_LICENCE,
  ContentApprovalError,
  isContentCampaign,
  destinationOf,
  statusAfterApproval,
  fixedPayDue,
  submitContent,
  requestChanges,
  editOrResubmitContent,
  approveContent,
  rejectContent,
  appealRejection,
  decideAppeal,
  shareDelivery,
  confirmReceipt,
  markContentPosted,
  confirmPost,
  disputePost,
  autoApproveStaleSubmissions,
  startContentAutoApprove,
  contentApprovalView,
};
