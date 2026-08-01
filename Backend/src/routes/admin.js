const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const Submission = require("../models/Submission");
const CreatorProfile = require("../models/CreatorProfile");
const BusinessProfile = require("../models/BusinessProfile");
const Slot = require("../models/Slot");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const Platform = require("../models/Platform");
const { protect, authorizeRoles } = require("../middleware/auth");

const adminGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get("/stats", adminGuard, async (req, res, next) => {
  try {
    const [
      totalBrands,
      totalCreators,
      totalAdmins,
      campaignsByStatus,
      totalEscrowedAgg,
      totalReleasedAgg,
      pendingVerifications,
      openAppeals,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({ role: "business" }),
      User.countDocuments({ role: "creator" }),
      User.countDocuments({ role: { $in: ["admin", "super_admin", "finance_admin", "support"] } }),
      Campaign.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Campaign.aggregate([
        { $match: { status: { $in: ["live", "under_review", "paused"] } } },
        { $group: { _id: null, total: { $sum: "$budget" } } },
      ]),
      Transaction.aggregate([
        { $match: { status: "released" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Submission.countDocuments({ status: { $in: ["new", "verifying", "posted"] } }),
      Submission.countDocuments({ status: "appealed" }),
      User.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name email role createdAt isActive"),
    ]);

    const statusMap = {};
    campaignsByStatus.forEach(({ _id, count }) => {
      statusMap[_id] = count;
    });

    res.json({
      brands: totalBrands,
      creators: totalCreators,
      admins: totalAdmins,
      campaigns: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        under_review: statusMap.under_review || 0,
        live: statusMap.live || 0,
        draft: statusMap.draft || 0,
        paused: statusMap.paused || 0,
        completed: statusMap.completed || 0,
        cancelled: statusMap.cancelled || 0,
        pending_payment: statusMap.pending_payment || 0,
      },
      totalEscrowed: totalEscrowedAgg[0]?.total || 0,
      totalReleased: totalReleasedAgg[0]?.total || 0,
      pendingVerifications,
      openAppeals,
      recentUsers,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/campaigns ─────────────────────────────────────────────────
router.get("/campaigns", adminGuard, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, q } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (q) filter.name = { $regex: q, $options: "i" };

    const skip = (Number(page) - 1) * Number(limit);
    const [campaigns, total] = await Promise.all([
      Campaign.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("businessId", "name email"),
      Campaign.countDocuments(filter),
    ]);

    res.json({
      campaigns: campaigns.map((c) => ({
        id: c._id,
        name: c.name,
        category: c.category,
        status: c.status,
        budget: c.budget,
        costPerView: c.costPerView,
        creatorPool: c.creatorPool,
        platformFee: c.platformFee,
        targetViews: c.targetViews,
        viewsDelivered: c.viewsDelivered || 0,
        progressPercent: c.targetViews > 0
          ? Math.min(Math.round(((c.viewsDelivered || 0) / c.targetViews) * 100), 100)
          : 0,
        coverImageUrl: c.coverImageUrl,
        contentBrief: c.contentBrief,
        platforms: c.platforms,
        contentStyle: c.contentStyle,
        niches: c.niches,
        createdAt: c.createdAt,
        brand: c.businessId
          ? { id: c.businessId._id, name: c.businessId.name, email: c.businessId.email }
          : null,
      })),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/campaigns/:id ─────────────────────────────────────────────
router.get("/campaigns/:id", adminGuard, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate("businessId", "name email");
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const [slots, submissions] = await Promise.all([
      Slot.find({ campaignId: campaign._id }).populate("creatorId", "name email"),
      Submission.find({ campaignId: campaign._id }).populate("creatorId", "name email"),
    ]);

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.name,
        category: campaign.category,
        contentBrief: campaign.contentBrief,
        keyMessageCta: campaign.keyMessageCta,
        whatToAvoid: campaign.whatToAvoid,
        coverImageUrl: campaign.coverImageUrl,
        scriptUrl: campaign.scriptUrl,
        platforms: campaign.platforms,
        contentStyle: campaign.contentStyle,
        niches: campaign.niches,
        targetViews: campaign.targetViews,
        costPerView: campaign.costPerView,
        budget: campaign.budget,
        platformFee: campaign.platformFee,
        creatorPool: campaign.creatorPool,
        status: campaign.status,
        viewsDelivered: campaign.viewsDelivered || 0,
        createdAt: campaign.createdAt,
        brand: campaign.businessId
          ? { id: campaign.businessId._id, name: campaign.businessId.name, email: campaign.businessId.email }
          : null,
      },
      slots,
      submissions,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/campaigns/:id (edit details) ─────────────────────────────
router.patch("/campaigns/:id", adminGuard, async (req, res, next) => {
  try {
    const { category, platforms, contentStyle, niches } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    if (category !== undefined) campaign.category = category;
    if (platforms !== undefined) campaign.platforms = platforms;
    if (contentStyle !== undefined) {
      campaign.contentStyle = Array.isArray(contentStyle)
        ? contentStyle
        : contentStyle.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (niches !== undefined) campaign.niches = niches;

    if (category !== undefined) {
      const { getCostPerView } = require("../config/pricing");
      campaign.costPerView = getCostPerView(category);
    }

    await campaign.save();

    res.json({
      success: true,
      campaign: {
        id: campaign._id,
        category: campaign.category,
        costPerView: campaign.costPerView,
        platforms: campaign.platforms,
        contentStyle: campaign.contentStyle,
        niches: campaign.niches,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/campaigns/:id/status ────────────────────────────────────
router.patch("/campaigns/:id/status", adminGuard, async (req, res, next) => {
  try {
    const { status, note } = req.body;
    const allowed = ["live", "paused", "cancelled", "under_review", "completed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const prevStatus = campaign.status;
    campaign.status = status;
    await campaign.save();

    await Notification.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      type: `campaign_${status}`,
      title: `Campaign Status Updated`,
      body: `Your campaign "${campaign.name}" status was updated from ${prevStatus} to ${status}.${note ? ` Note: ${note}` : ""}`,
    });

    res.json({ success: true, status: campaign.status });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/submissions ───────────────────────────────────────────────
router.get("/submissions", adminGuard, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [submissions, total] = await Promise.all([
      Submission.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("campaignId", "name category coverImageUrl")
        .populate("creatorId", "name email"),
      Submission.countDocuments(filter),
    ]);

    res.json({
      submissions: submissions.map((s) => ({
        id: s._id,
        campaignId: s.campaignId?._id,
        campaignName: s.campaignId?.name || "Unknown Campaign",
        creatorId: s.creatorId?._id,
        creatorName: s.creatorId?.name || s.creatorHandle,
        creatorHandle: s.creatorHandle,
        videoUrl: s.videoUrl,
        caption: s.caption,
        status: s.status,
        rejectionReason: s.rejectionReason,
        appealReason: s.appealReason,
        adminNotes: s.adminNotes,
        confidenceScore: s.confidenceScore || 100,
        viewsDelivered: s.viewsDelivered || 0,
        postedPlatforms: s.postedPlatforms || [],
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
      })),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/submissions/:id/review ─────────────────────────────────
router.patch("/submissions/:id/review", adminGuard, async (req, res, next) => {
  try {
    const { status, rejectionReason, adminNotes } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be approved or rejected" });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    submission.status = status === "approved" ? "awaiting_post" : "rejected";
    if (rejectionReason) submission.rejectionReason = rejectionReason;
    if (adminNotes) submission.adminNotes = adminNotes;
    submission.reviewedAt = new Date();
    await submission.save();

    const campaign = await Campaign.findById(submission.campaignId);
    await Notification.create({
      creatorId: submission.creatorId,
      campaignId: submission.campaignId,
      type: status === "approved" ? "content_approved" : "content_rejected",
      title: status === "approved" ? "Content Approved" : "Content Rejected",
      body: status === "approved"
        ? `Your submission for "${campaign?.name || "Campaign"}" was approved by Admin.`
        : `Your submission for "${campaign?.name || "Campaign"}" was rejected by Admin.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
    });

    res.json({ success: true, submission });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/submissions/:id/appeal ─────────────────────────────────
router.patch("/submissions/:id/appeal", adminGuard, async (req, res, next) => {
  try {
    const { decision, notes } = req.body; // 'approve' or 'reject'
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be approve or reject" });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    if (decision === "approve") {
      submission.status = "approved";
      submission.adminNotes = notes || "Appeal approved by Admin";
    } else {
      submission.status = "rejected";
      submission.adminNotes = notes || "Appeal rejected by Admin";
    }
    await submission.save();

    res.json({ success: true, submission });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get("/users", adminGuard, async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20, q } = req.query;
    const filter = {};
    if (role && role !== "all") filter.role = role;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select("-password"),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((u) => u._id);
    const [campaignCounts, submissionCounts, creatorProfiles] = await Promise.all([
      Campaign.aggregate([
        { $match: { businessId: { $in: userIds } } },
        { $group: { _id: "$businessId", count: { $sum: 1 } } },
      ]),
      Submission.aggregate([
        { $match: { creatorId: { $in: userIds } } },
        { $group: { _id: "$creatorId", count: { $sum: 1 } } },
      ]),
      CreatorProfile.find({ userId: { $in: userIds } }),
    ]);

    const campaignMap = {};
    campaignCounts.forEach(({ _id, count }) => { campaignMap[_id.toString()] = count; });

    const submissionMap = {};
    submissionCounts.forEach(({ _id, count }) => { submissionMap[_id.toString()] = count; });

    const profileMap = {};
    creatorProfiles.forEach((p) => { profileMap[p.userId.toString()] = p; });

    res.json({
      users: users.map((u) => {
        const cp = profileMap[u._id.toString()];
        return {
          id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          emailVerified: u.emailVerified,
          walletBalance: u.walletBalance || 0,
          createdAt: u.createdAt,
          campaignCount: campaignMap[u._id.toString()] || 0,
          submissionCount: submissionMap[u._id.toString()] || 0,
          creatorProfile: cp
            ? {
                rank: cp.rank,
                creatorScore: cp.creatorScore,
                lifetimeEarnings: cp.lifetimeEarnings,
                socialAccounts: cp.socialAccounts,
                niches: cp.niches,
              }
            : null,
        };
      }),
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
router.get("/users/:id", adminGuard, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });

    let creatorProfile = null;
    let businessProfile = null;

    if (user.role === "creator") {
      creatorProfile = await CreatorProfile.findOne({ userId: user._id });
    } else if (user.role === "business") {
      businessProfile = await BusinessProfile.findOne({ userId: user._id });
    }

    res.json({ user, creatorProfile, businessProfile });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/status ───────────────────────────────────────
router.patch("/users/:id/status", adminGuard, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.isActive = Boolean(isActive);
    await user.save();

    res.json({ success: true, isActive: user.isActive });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/rank ─────────────────────────────────────────
router.patch("/users/:id/rank", adminGuard, async (req, res, next) => {
  try {
    const { rank, creatorScore } = req.body;
    const validRanks = ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"];

    let profile = await CreatorProfile.findOne({ userId: req.params.id });
    if (!profile) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });
      profile = new CreatorProfile({
        userId: user._id,
        username: user.email.split("@")[0],
        displayName: user.name,
      });
    }

    if (rank && validRanks.includes(rank)) profile.rank = rank;
    if (typeof creatorScore === "number") profile.creatorScore = Math.max(0, Math.min(100, creatorScore));

    await profile.save();
    res.json({ success: true, rank: profile.rank, creatorScore: profile.creatorScore });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/create-admin ─────────────────────────────────────────────
router.post("/create-admin", [protect, authorizeRoles("super_admin")], async (req, res, next) => {
  try {
    const { name, email, password, role = "admin" } = req.body;
    const allowedRoles = ["admin", "finance_admin", "support", "super_admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid admin role" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "User with this email already exists" });
    }

    const newAdmin = await User.create({
      name,
      email,
      password,
      role,
      emailVerified: true,
      isActive: true,
    });

    res.status(201).json({
      success: true,
      user: {
        id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/platforms ─────────────────────────────────────────────────
router.get("/platforms", adminGuard, async (req, res, next) => {
  try {
    const platforms = await Platform.find().sort({ sortOrder: 1, name: 1 });
    res.json({
      platforms: platforms.map((p) => ({
        id: p._id,
        name: p.name,
        enabled: p.enabled,
        sortOrder: p.sortOrder,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/platforms ─────────────────────────────────────────────────
router.post("/platforms", adminGuard, async (req, res, next) => {
  try {
    const { name, enabled = true, sortOrder = 0 } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Platform name is required" });
    }

    const existing = await Platform.findOne({ name: { $regex: `^${name.trim()}$`, $options: "i" } });
    if (existing) {
      return res.status(400).json({ error: "Platform already exists" });
    }

    const platform = await Platform.create({
      name: name.trim(),
      enabled: Boolean(enabled),
      sortOrder: Number(sortOrder) || 0,
    });

    res.status(201).json({
      success: true,
      platform: {
        id: platform._id,
        name: platform.name,
        enabled: platform.enabled,
        sortOrder: platform.sortOrder,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/platforms/:id ────────────────────────────────────────────
router.patch("/platforms/:id", adminGuard, async (req, res, next) => {
  try {
    const { name, enabled, sortOrder } = req.body;
    const platform = await Platform.findById(req.params.id);
    if (!platform) return res.status(404).json({ error: "Platform not found" });

    if (name !== undefined && name.trim()) platform.name = name.trim();
    if (enabled !== undefined) platform.enabled = Boolean(enabled);
    if (sortOrder !== undefined) platform.sortOrder = Number(sortOrder) || 0;

    await platform.save();
    res.json({
      success: true,
      platform: {
        id: platform._id,
        name: platform.name,
        enabled: platform.enabled,
        sortOrder: platform.sortOrder,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/platforms/:id ───────────────────────────────────────────
router.delete("/platforms/:id", adminGuard, async (req, res, next) => {
  try {
    const platform = await Platform.findByIdAndDelete(req.params.id);
    if (!platform) return res.status(404).json({ error: "Platform not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/payouts ───────────────────────────────────────────────────
router.get("/payouts", adminGuard, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [transactions, total, stats] = await Promise.all([
      Transaction.find()
        .sort({ date: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("campaignId", "name"),
      Transaction.countDocuments(),
      Transaction.aggregate([
        { $group: { _id: "$type", totalAmount: { $sum: "$amount" } } },
      ]),
    ]);

    const statsMap = {};
    stats.forEach((s) => { statsMap[s._id] = s.totalAmount; });

    res.json({
      transactions: transactions.map((t) => ({
        id: t._id,
        campaignName: t.campaignId?.name || "System",
        creatorHandle: t.creatorHandle || "N/A",
        type: t.type,
        amount: t.amount,
        status: t.status,
        views: t.views,
        date: t.date,
      })),
      total,
      summary: {
        escrowDeposited: statsMap.escrow_deposit || 0,
        releasedPayouts: statsMap.release || 0,
        refunds: statsMap.refund || 0,
      },
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
