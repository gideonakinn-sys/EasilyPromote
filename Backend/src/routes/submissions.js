const express = require("express");
const { z } = require("zod");
const Submission = require("../models/Submission");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const { protect, authorizeRoles } = require("../middleware/auth");
const { emitCampaignUpdate } = require("../utils/campaignUpdates");
const { recordEvent } = require("../services/submissionEvents");
const { recordViewDelta } = require("../services/viewSnapshots");
// Campaign engine: content approval (ticket 07)
const contentApproval = require("../services/contentApproval");
const { fullBrief } = require("../utils/campaignPay");
const { postAlreadyUsed, postKeyFor, POST_ALREADY_USED_MESSAGE } = require("../services/postIdentity");

const router = express.Router();

// Campaign engine: content approval (ticket 07)
// Loads a submission and its campaign for a content-campaign action by the brand or the
// creator. Sends the error response and returns null when the action isn't allowed.
async function loadContentSubmission(req, res, who) {
  const submission = await Submission.findById(req.params.id);
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return null;
  }
  const campaign = await Campaign.findById(submission.campaignId);
  const owner = who === "brand" ? campaign && String(campaign.businessId) : String(submission.creatorId);
  if (!campaign || owner !== String(req.user._id)) {
    res.status(403).json({ error: "Not authorized" });
    return null;
  }
  if (!contentApproval.isContentCampaign(campaign)) {
    res.status(400).json({ error: "This only applies to content campaigns", code: "NOT_CONTENT_CAMPAIGN" });
    return null;
  }
  return { submission, campaign };
}

function sendContentError(res, error, next) {
  if (error instanceof contentApproval.ContentApprovalError) {
    return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: error.errors[0].message, code: "INVALID_BODY" });
  }
  return next(error);
}

const linkText = z.string({ invalid_type_error: "Links must be text" }).trim().max(2000, "That link is too long");
const noteText = (message) => z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message).max(2000);
const contentBodySchemas = {
  submit: z.object({
    videoUrl: linkText.url("Add a link to your content"),
    caption: z.string().max(1000, "Captions can be up to 1,000 characters").optional(),
    durationSeconds: z.number().min(0).optional(),
  }),
  edit: z.object({
    videoUrl: linkText.url("Add a link to your content").optional(),
    caption: z.string().max(1000, "Captions can be up to 1,000 characters").optional(),
  }),
  requestChanges: z.object({ notes: noteText("Tell the creator what to change") }),
  reject: z.object({ reason: noteText("A rejection reason is required") }),
  appeal: z.object({ reason: noteText("Say why the rejection should be reviewed") }),
  deliver: z.object({
    url: linkText.url("Add a download link the brand can open"),
    acceptUsageRights: z.boolean().optional(),
  }),
  markPosted: z.object({
    posts: z
      .array(z.object({ platform: z.string().trim().max(40), postUrl: z.string().trim().max(2000) }), {
        required_error: "Add the link to your live post",
      })
      .min(1, "Add the link to your live post")
      .max(10),
    caption: z.string().max(5000, "Captions can be up to 5,000 characters").optional(),
  }),
  empty: z.object({}).passthrough(),
  disputePost: z.object({ notes: noteText("Tell the creator what's wrong with the post") }),
};

function contentResponse(submission, campaign) {
  return { id: submission._id, ...contentApproval.contentApprovalView(submission, campaign) };
}

router.post("/", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { campaignId, slotId, videoUrl, caption, durationSeconds } = req.body;

    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign || campaign.status !== "live") {
      return res.status(400).json({ error: "Campaign is not available for submissions" });
    }

    // Campaign engine: content approval (ticket 07)
    if (contentApproval.isContentCampaign(campaign)) {
      try {
        const body = contentBodySchemas.submit.parse({ videoUrl, caption, durationSeconds });
        const created = await contentApproval.submitContent({ user: req.user, campaign, ...body });
        return res.status(201).json({ id: created._id, status: created.status, campaignId: created.campaignId });
      } catch (error) {
        return sendContentError(res, error, next);
      }
    }

    const user = await User.findById(req.user._id);
    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    const creatorHandle = profile ? profile.username : user.name;

    const submission = await Submission.create({
      campaignId,
      creatorId: req.user._id,
      creatorHandle,
      videoUrl,
      caption,
      durationSeconds,
      status: "new",
    });

    if (slotId) {
      const Slot = require("../models/Slot");
      const slot = await Slot.findById(slotId);
      if (slot && slot.creatorId.toString() === req.user._id.toString()) {
        slot.status = "submitted";
        slot.submissionUrl = videoUrl || "";
        await slot.save();
      }
    }

    await recordEvent(submission, {
      type: "submitted",
      actor: "creator",
      actorId: req.user._id,
      actorName: creatorHandle,
      metadata: { videoUrl, caption, durationSeconds },
    });

    res.status(201).json({
      id: submission._id,
      status: submission.status,
      campaignId: submission.campaignId,
    });

    emitCampaignUpdate(submission);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { videoUrl, caption } = req.body;

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Campaign engine: content approval (ticket 07)
    const contentCampaign = await Campaign.findById(submission.campaignId);
    if (contentApproval.isContentCampaign(contentCampaign)) {
      try {
        const body = contentBodySchemas.edit.parse({ videoUrl, caption });
        const updated = await contentApproval.editOrResubmitContent({ submission, campaign: contentCampaign, user: req.user, ...body });
        return res.json({ ...contentResponse(updated, contentCampaign), videoUrl: updated.videoUrl, caption: updated.caption });
      } catch (error) {
        return sendContentError(res, error, next);
      }
    }

    if (!["new", "rejected"].includes(submission.status)) {
      return res.status(400).json({ error: "Content can only be updated before approval" });
    }

    const wasRejected = submission.status === "rejected";
    if (videoUrl !== undefined) submission.videoUrl = videoUrl;
    if (caption !== undefined) submission.caption = caption;
    if (wasRejected) {
      submission.status = "new";
      submission.rejectionReason = null;
    }
    await submission.save();

    await recordEvent(submission, {
      type: wasRejected ? "resubmitted" : "content_edited",
      actor: "creator",
      actorId: req.user._id,
      actorName: submission.creatorHandle,
      metadata: { videoUrl: submission.videoUrl, caption: submission.caption },
    });

    res.json({
      id: submission._id,
      status: submission.status,
      videoUrl: submission.videoUrl,
      caption: submission.caption,
    });

    emitCampaignUpdate(submission);
  } catch (error) {
    next(error);
  }
});

router.get("/campaign/:campaignId", protect, async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { campaignId: req.params.campaignId };

    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (status) {
      filter.status = status;
    }

    // The list, what's been paid per submission and the counts per status, read together.
    // payoutAmount was never stored on submissions; report what has actually been paid
    // for each one from settled views releases in the ledger.
    const Transaction = require("../models/Transaction");
    const [submissions, releasedGroups, byStatus] = await Promise.all([
      Submission.find(filter).sort({ submittedAt: -1 }),
      Transaction.aggregate([
        {
          $match: {
            campaignId: campaign._id,
            type: "release",
            status: "released",
            bucket: { $nin: ["referral", "fixed", "bonus"] },
            submissionId: { $ne: null },
          },
        },
        { $group: { _id: "$submissionId", total: { $sum: "$amount" } } },
      ]),
      Submission.aggregate([
        { $match: { campaignId: campaign._id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const releasedBySubmission = new Map(releasedGroups.map((group) => [String(group._id), group.total]));
    const count = (value) => (byStatus.find((group) => group._id === value) || { count: 0 }).count;

    const counts = {
      new: count("new"),
      // Older clients read "approved" as content waiting to be posted.
      approved: count("awaiting_post"),
      awaitingPost: count("awaiting_post"),
      posted: count("posted"),
      rejected: count("rejected"),
    };

    // Campaign engine: content approval (ticket 07)
    const isContent = contentApproval.isContentCampaign(campaign);
    if (isContent) {
      Object.assign(counts, {
        changesRequested: count("changes_requested"),
        awaitingDelivery: count("awaiting_delivery"),
        delivered: count("delivered"),
        verifying: count("verifying"),
        completed: count("completed"),
        appealed: count("appealed"),
      });
    }

    const submissionsResponse = submissions.map((s) => ({
      id: s._id,
      creatorId: s.creatorId,
      creatorHandle: s.creatorHandle,
      videoUrl: s.videoUrl,
      caption: s.caption,
      durationSeconds: s.durationSeconds,
      uploadedAt: s.submittedAt,
      status: s.status,
      rejectionReason: s.rejectionReason,
      postedPlatforms: s.postedPlatforms,
      viewsDelivered: s.viewsDelivered,
      payoutAmount: releasedBySubmission.get(String(s._id)) || 0,
      payoutStatus: s.payoutStatus,
      submittedAt: s.submittedAt,
      reviewedAt: s.reviewedAt,
      postedAt: s.postedAt,
      // Campaign engine: content approval (ticket 07)
      ...(isContent && contentApproval.contentApprovalView(s, campaign)),
    }));

    res.json({
      counts,
      submissions: submissionsResponse,
      // Campaign engine: content approval (ticket 07)
      ...(isContent && {
        contentApproval: {
          destination: contentApproval.destinationOf(campaign),
          maxChangeRequests: contentApproval.MAX_CHANGE_REQUESTS,
          licence: contentApproval.USAGE_RIGHTS_LICENCE,
          brief: fullBrief(campaign),
        },
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/approve", protect, async (req, res, next) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const campaign = await Campaign.findById(submission.campaignId);
    if (!campaign || campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Campaign engine: content approval (ticket 07)
    if (contentApproval.isContentCampaign(campaign)) {
      try {
        const approved = await contentApproval.approveContent({ submission, campaign, actor: { kind: "brand", user: req.user } });
        return res.json(contentResponse(approved, campaign));
      } catch (error) {
        return sendContentError(res, error, next);
      }
    }

    if (submission.status !== "new") {
      return res.status(400).json({ error: "Can only approve new submissions" });
    }

    submission.status = "awaiting_post";
    submission.reviewedAt = new Date();
    await submission.save();

    await recordEvent(submission, {
      type: "approved",
      actor: "brand",
      actorId: req.user._id,
      actorName: req.user.name,
    });

    await Notification.create({
      creatorId: submission.creatorId,
      campaignId: submission.campaignId,
      type: "content_approved",
      title: "Content approved",
      body: `Your submission for "${campaign.name}" has been approved. Post it on your socials now!`,
    });

    res.json({ id: submission._id, status: submission.status });

    emitCampaignUpdate(submission);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reject", protect, async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!(reason && String(reason).trim())) {
      return res.status(400).json({ error: "A rejection reason is required" });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const campaign = await Campaign.findById(submission.campaignId);
    if (!campaign || campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Campaign engine: content approval (ticket 07): the status is checked inside the update, so a
    // rejection can't overwrite an approval that landed a moment earlier.
    if (contentApproval.isContentCampaign(campaign)) {
      try {
        const body = contentBodySchemas.reject.parse(req.body);
        const rejected = await contentApproval.rejectContent({ submission, campaign, actor: { kind: "brand", user: req.user }, reason: body.reason });
        return res.json({ ...contentResponse(rejected, campaign), rejectionReason: rejected.rejectionReason });
      } catch (error) {
        return sendContentError(res, error, next);
      }
    }

    if (submission.status !== "new") {
      return res.status(400).json({ error: "Can only reject new submissions" });
    }

    submission.status = "rejected";
    submission.rejectionReason = reason;
    submission.reviewedAt = new Date();
    await submission.save();

    await recordEvent(submission, {
      type: "rejected",
      actor: "brand",
      actorId: req.user._id,
      actorName: req.user.name,
      reason,
    });

    await Notification.create({
      creatorId: submission.creatorId,
      campaignId: submission.campaignId,
      type: "content_rejected",
      title: "Content rejected",
      body: `Your submission for "${campaign.name}" was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    });

    res.json({
      id: submission._id,
      status: submission.status,
      rejectionReason: submission.rejectionReason,
    });

    emitCampaignUpdate(submission);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/mark-posted", protect, async (req, res, next) => {
  try {
    const { posts, url, platform } = req.body;

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Campaign engine: content approval (ticket 07)
    const contentCampaign = await Campaign.findById(submission.campaignId);
    if (contentApproval.isContentCampaign(contentCampaign)) {
      try {
        const body = contentBodySchemas.markPosted.parse(req.body);
        const posted = await contentApproval.markContentPosted({ submission, campaign: contentCampaign, user: req.user, ...body });
        return res.json({ ...contentResponse(posted, contentCampaign), postedPlatforms: posted.postedPlatforms });
      } catch (error) {
        return sendContentError(res, error, next);
      }
    }

    // "posted" and "verifying" are allowed so a creator can add a second
    // platform's link later — they often post to TikTok first and Instagram
    // hours afterwards, by which point the sync jobs have already moved the
    // submission on.
    const POSTABLE = ["awaiting_post", "approved", "posted", "verifying"];
    if (!POSTABLE.includes(submission.status)) {
      const reason =
        submission.status === "new"
          ? "This submission is still waiting to be reviewed."
          : submission.status === "rejected"
            ? "This submission needs changes — upload new content first."
            : `A submission with status "${submission.status}" cannot accept post links.`;
      return res.status(400).json({ error: reason });
    }

    const normalizePlatform = (p) => {
      if (!p) return null;
      const value = p.trim().toLowerCase();
      if (!value) return null;
      if (value === "twitter" || value === "x (twitter)" || value === "x") return "x";
      if (value === "youtube" || value === "youtube shorts") return "youtube";
      return value;
    };

    const newPosts = Array.isArray(posts)
      ? posts
      : [{ platform, postUrl: url }];

    // D34: one post, one submission.
    if (await postAlreadyUsed(submission._id, newPosts.filter((p) => p && normalizePlatform(p.platform) && p.postUrl).map((p) => p.postUrl))) {
      return res.status(409).json({ error: POST_ALREADY_USED_MESSAGE, code: "POST_ALREADY_USED" });
    }

    const postedPlatforms = submission.postedPlatforms || [];
    for (const post of newPosts) {
      const normalized = normalizePlatform(post.platform);
      if (!normalized) continue;
      const entry = postedPlatforms.find((e) => e.platform === normalized);
      if (entry) {
        if (post.postUrl !== undefined) {
          entry.postUrl = post.postUrl;
          entry.postKey = postKeyFor(post.postUrl);
        }
      } else {
        postedPlatforms.push({
          platform: normalized,
          postUrl: post.postUrl || "",
          postKey: postKeyFor(post.postUrl),
          views: 0,
          likes: 0,
          comments: 0,
        });
      }
      if (post.postUrl && /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(String(post.postUrl))) {
        const longMatch = String(post.postUrl).match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
        if (longMatch) submission.tiktokVideoId = longMatch[1];
      }
    }

    const wasAlreadyPosted = ["posted", "verifying"].includes(submission.status);
    if (submission.status !== "verifying") submission.status = "posted";
    if (!submission.postedAt) submission.postedAt = new Date();
    submission.postedPlatforms = postedPlatforms;
    await submission.save();

    await recordEvent(submission, {
      type: "posted",
      actor: "creator",
      actorId: req.user._id,
      actorName: submission.creatorHandle,
      metadata: {
        addedPlatforms: newPosts.map((p) => normalizePlatform(p.platform)).filter(Boolean),
        additional: wasAlreadyPosted,
        platforms: submission.postedPlatforms.map((p) => ({ platform: p.platform, postUrl: p.postUrl })),
      },
    });

    const { syncTiktokViews } = require("../utils/syncTiktokViews");
    const { syncMetaViews } = require("../utils/syncMetaViews");
    try {
      await Promise.allSettled([syncTiktokViews(), syncMetaViews()]);
    } catch (err) {
      console.error("[Views Sync] Immediate sync after post failed:", err.message);
    }

    const freshSubmission = await Submission.findById(submission._id);
    const subToEmit = freshSubmission || submission;

    const campaign = await Campaign.findById(subToEmit.campaignId);
    if (campaign) {
      await Notification.create({
        businessId: campaign.businessId,
        campaignId: campaign._id,
        type: "submission_pending",
        title: "Content posted",
        body: `${subToEmit.creatorHandle} has posted content for "${campaign.name}".`,
      });
    }

    res.json({
      id: subToEmit._id,
      status: subToEmit.status,
      postedPlatforms: subToEmit.postedPlatforms,
      viewsDelivered: subToEmit.viewsDelivered || 0,
    });

    await emitCampaignUpdate(subToEmit);
  } catch (error) {
    next(error);
  }
});

// ── Campaign engine: content approval (ticket 07) ──────────────────────────────
// Content campaigns only; each route answers NOT_CONTENT_CAMPAIGN for views campaigns.

function contentRoute(who, schema, action) {
  return async (req, res, next) => {
    try {
      const loaded = await loadContentSubmission(req, res, who);
      if (!loaded) return;
      const body = schema.parse(req.body || {});
      const updated = await action({ ...loaded, user: req.user, body });
      res.json(contentResponse(updated, loaded.campaign));
    } catch (error) {
      sendContentError(res, error, next);
    }
  };
}

router.patch(
  "/:id/request-changes",
  protect,
  contentRoute("brand", contentBodySchemas.requestChanges, ({ body, ...ctx }) => contentApproval.requestChanges({ ...ctx, notes: body.notes }))
);

router.patch(
  "/:id/appeal",
  protect,
  authorizeRoles("creator"),
  contentRoute("creator", contentBodySchemas.appeal, ({ body, ...ctx }) => contentApproval.appealRejection({ ...ctx, reason: body.reason }))
);

router.patch(
  "/:id/deliver",
  protect,
  authorizeRoles("creator"),
  contentRoute("creator", contentBodySchemas.deliver, ({ body, ...ctx }) =>
    contentApproval.shareDelivery({ ...ctx, url: body.url, acceptUsageRights: body.acceptUsageRights })
  )
);

router.patch(
  "/:id/confirm-receipt",
  protect,
  contentRoute("brand", contentBodySchemas.empty, ({ user, submission, campaign }) =>
    contentApproval.confirmReceipt({ submission, campaign, actor: { kind: "brand", user } })
  )
);

router.patch(
  "/:id/confirm-post",
  protect,
  contentRoute("brand", contentBodySchemas.empty, ({ user, submission, campaign }) =>
    contentApproval.confirmPost({ submission, campaign, actor: { kind: "brand", user } })
  )
);

router.patch(
  "/:id/dispute-post",
  protect,
  contentRoute("brand", contentBodySchemas.disputePost, ({ body, ...ctx }) => contentApproval.disputePost({ ...ctx, notes: body.notes }))
);

router.post("/:id/sync-stats", protect, authorizeRoles("admin", "super_admin"), async (req, res, next) => {
  try {
    const { platform: rawPlatform, views, likes, comments } = req.body;
    const platform = rawPlatform ? rawPlatform.trim().toLowerCase() : "";

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }
    if (submission.status !== "posted") {
      return res.status(400).json({ error: "Can only sync stats for posted submissions" });
    }

    const platformEntry = submission.postedPlatforms.find((p) => p.platform === platform);
    if (platformEntry) {
      platformEntry.views = views || 0;
      platformEntry.likes = likes || 0;
      platformEntry.comments = comments || 0;
    } else {
      submission.postedPlatforms.push({ platform, postUrl: "", views: views || 0, likes: likes || 0, comments: comments || 0 });
    }

    const previousViews = submission.viewsDelivered || 0;
    submission.viewsDelivered = submission.postedPlatforms.reduce((sum, p) => sum + (p.views || 0), 0);
    await submission.save();
    if (submission.viewsDelivered > previousViews) {
      await recordViewDelta({
        campaignId: submission.campaignId,
        submissionId: submission._id,
        delta: submission.viewsDelivered - previousViews,
      });
    }

    const campaign = await Campaign.findById(submission.campaignId);
    if (campaign) {
      const totalViews = await Submission.aggregate([
        { $match: { campaignId: campaign._id, status: "posted" } },
        { $group: { _id: null, total: { $sum: "$viewsDelivered" } } },
      ]);
      campaign.viewsDelivered = totalViews.length > 0 ? totalViews[0].total : 0;

      let shouldComplete = false;
      let completionReason = "";

      if (campaign.targetViews > 0 && campaign.viewsDelivered >= campaign.targetViews && campaign.status === "live") {
        shouldComplete = true;
        completionReason = "Campaign hit its target — that's a wrap.";
      }

      if (!shouldComplete && campaign.status === "live") {
        const Transaction = require("../models/Transaction");
        const released = await Transaction.aggregate([
          // The views pool only: referral payouts must not complete a views campaign.
          { $match: { campaignId: campaign._id, status: "released", bucket: { $nin: ["referral", "fixed", "bonus"] } } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalReleased = released.length > 0 ? released[0].total : 0;
        // A referrals-only campaign (SPEC D31) has no views pool, so views never complete it.
        if (campaign.creatorPool > 0 && totalReleased >= campaign.creatorPool) {
          shouldComplete = true;
          completionReason = "Campaign escrow has been fully released — that's a wrap.";
        }
      }

      if (shouldComplete) {
        campaign.status = "completed";
        campaign.completedAt = new Date();
        await Notification.create({
          businessId: campaign.businessId,
          campaignId: campaign._id,
          type: "completed",
          title: "Completed",
          body: completionReason,
        });
      }
      await campaign.save();
    }

    // The creator's views earnings on this campaign so far — the same figure the wallet
    // shows and withdrawals allow, not a share of the whole pool.
    const { creatorViewsEarnings } = require("../utils/earnings");
    const earnings = campaign
      ? (await creatorViewsEarnings(submission.creatorId, { campaignIds: [campaign._id] })).get(String(campaign._id))
      : null;
    const payoutAmount = earnings ? earnings.earned : 0;

    res.json({
      id: submission._id,
      viewsDelivered: submission.viewsDelivered,
      payoutAmount,
      payoutStatus: submission.payoutStatus,
    });

    emitCampaignUpdate(submission);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
