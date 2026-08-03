const express = require("express");
const Submission = require("../models/Submission");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const { protect, authorizeRoles } = require("../middleware/auth");

const router = express.Router();

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

    res.status(201).json({
      id: submission._id,
      status: submission.status,
      campaignId: submission.campaignId,
    });
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
    if (!["new", "rejected"].includes(submission.status)) {
      return res.status(400).json({ error: "Content can only be updated before approval" });
    }

    if (videoUrl !== undefined) submission.videoUrl = videoUrl;
    if (caption !== undefined) submission.caption = caption;
    if (submission.status === "rejected") {
      submission.status = "new";
      submission.rejectionReason = null;
    }
    await submission.save();

    res.json({
      id: submission._id,
      status: submission.status,
      videoUrl: submission.videoUrl,
      caption: submission.caption,
    });
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

    const submissions = await Submission.find(filter).sort({ submittedAt: -1 });

    const counts = {
      new: await Submission.countDocuments({ campaignId: req.params.campaignId, status: "new" }),
      approved: await Submission.countDocuments({
        campaignId: req.params.campaignId,
        status: "awaiting_post",
      }),
      awaitingPost: await Submission.countDocuments({
        campaignId: req.params.campaignId,
        status: "awaiting_post",
      }),
      posted: await Submission.countDocuments({
        campaignId: req.params.campaignId,
        status: "posted",
      }),
      rejected: await Submission.countDocuments({
        campaignId: req.params.campaignId,
        status: "rejected",
      }),
    };

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
      payoutAmount: s.payoutAmount,
      payoutStatus: s.payoutStatus,
      submittedAt: s.submittedAt,
      reviewedAt: s.reviewedAt,
      postedAt: s.postedAt,
    }));

    res.json({ counts, submissions: submissionsResponse });
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
    if (submission.status !== "new") {
      return res.status(400).json({ error: "Can only approve new submissions" });
    }

    submission.status = "awaiting_post";
    submission.reviewedAt = new Date();
    await submission.save();

    await Notification.create({
      creatorId: submission.creatorId,
      campaignId: submission.campaignId,
      type: "content_approved",
      title: "Content approved",
      body: `Your submission for "${campaign.name}" has been approved. Post it on your socials now!`,
    });

    res.json({ id: submission._id, status: submission.status });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reject", protect, async (req, res, next) => {
  try {
    const { reason } = req.body;

    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const campaign = await Campaign.findById(submission.campaignId);
    if (!campaign || campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (submission.status !== "new") {
      return res.status(400).json({ error: "Can only reject new submissions" });
    }

    submission.status = "rejected";
    submission.rejectionReason = reason;
    submission.reviewedAt = new Date();
    await submission.save();

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
    if (!["awaiting_post", "approved"].includes(submission.status)) {
      return res.status(400).json({ error: "Submission must be awaiting_post before marking as posted" });
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

    const postedPlatforms = submission.postedPlatforms || [];
    for (const post of newPosts) {
      const normalized = normalizePlatform(post.platform);
      if (!normalized) continue;
      const entry = postedPlatforms.find((e) => e.platform === normalized);
      if (entry) {
        if (post.postUrl !== undefined) entry.postUrl = post.postUrl;
      } else {
        postedPlatforms.push({
          platform: normalized,
          postUrl: post.postUrl || "",
          views: 0,
          likes: 0,
          comments: 0,
        });
      }
      if (normalized === "tiktok" && post.postUrl) {
        const match = String(post.postUrl).match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
        if (match) submission.tiktokVideoId = match[1];
      }
    }

    submission.status = "posted";
    submission.postedAt = new Date();
    submission.postedPlatforms = postedPlatforms;
    await submission.save();

    const { syncTiktokViews } = require("../utils/syncTiktokViews");
    try {
      await syncTiktokViews();
    } catch (err) {
      console.error("[TikTok Sync] Immediate sync after post failed:", err.message);
    }

    const campaign = await Campaign.findById(submission.campaignId);
    if (campaign) {
      await Notification.create({
        businessId: campaign.businessId,
        campaignId: campaign._id,
        type: "submission_pending",
        title: "Content posted",
        body: `${submission.creatorHandle} has posted content for "${campaign.name}".`,
      });
    }

    res.json({
      id: submission._id,
      status: submission.status,
      postedPlatforms: submission.postedPlatforms,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/sync-stats", protect, async (req, res, next) => {
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

    submission.viewsDelivered = submission.postedPlatforms.reduce((sum, p) => sum + (p.views || 0), 0);
    await submission.save();

    const campaign = await Campaign.findById(submission.campaignId);
    if (campaign) {
      const totalViews = await Submission.aggregate([
        { $match: { campaignId: campaign._id, status: "posted" } },
        { $group: { _id: null, total: { $sum: "$viewsDelivered" } } },
      ]);
      campaign.viewsDelivered = totalViews.length > 0 ? totalViews[0].total : 0;

      let shouldComplete = false;
      let completionReason = "";

      if (campaign.viewsDelivered >= campaign.targetViews && campaign.status === "live") {
        shouldComplete = true;
        completionReason = "Campaign hit its target — that's a wrap.";
      }

      if (!shouldComplete && campaign.status === "live") {
        const Transaction = require("../models/Transaction");
        const released = await Transaction.aggregate([
          { $match: { campaignId: campaign._id, status: "released" } },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalReleased = released.length > 0 ? released[0].total : 0;
        if (totalReleased >= campaign.creatorPool) {
          shouldComplete = true;
          completionReason = "Campaign escrow has been fully released — that's a wrap.";
        }
      }

      if (shouldComplete) {
        campaign.status = "completed";
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

    const creatorPoolShare = campaign ? campaign.creatorPool / Math.max(campaign.viewsDelivered, 1) : 0;
    const payoutAmount = Math.round(submission.viewsDelivered * creatorPoolShare);

    res.json({
      id: submission._id,
      viewsDelivered: submission.viewsDelivered,
      payoutAmount,
      payoutStatus: submission.payoutStatus,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
