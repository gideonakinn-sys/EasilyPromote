const express = require("express");
const mongoose = require("mongoose");
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
const Industry = require("../models/Industry");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const { hasDependents } = require("../utils/cleanupCancelled");
const { seedIndustries } = require("../utils/seedIndustries");
const { protect, authorizeRoles } = require("../middleware/auth");
const { ensureCampaignSlots, syncCampaignSlots } = require("../utils/ensureSlots");
const { emitCampaignUpdate, emitCampaignStatus, emitPlacesLeft } = require("../utils/campaignUpdates");
const Withdrawal = require("../models/Withdrawal");
const paystack = require("../services/paystack");
const { campaignEscrowBalance, refundViewsEscrow } = require("../utils/escrow");
const { settleRelease } = require("../utils/payouts");
const { reconcilePayouts } = require("../utils/reconcilePayouts");
const { recalculateCreator, recalculateAllCreators } = require("../services/creatorScore");
const { recordEvent, listEventsForCampaign, labelFor } = require("../services/submissionEvents");
const { timeAgo } = require("../utils/timeAgo");
const { recordAdminActivity } = require("../services/adminActivity");
const { refundUnusedReferralBudget } = require("../utils/referralEarnings");
const { hasConnectedSocial } = require("../utils/creatorVerification");
// Campaign engine: content approval (ticket 07)
const contentApproval = require("../services/contentApproval");
// Fixed pay payouts and the money trail (ticket 09)
const {
  RefundError,
  contentBudgetSummary,
  refundUnusedContentBudget,
  retryContentRefund,
  voidUndeliveredPay,
  reopenClosedPlaces,
} = require("../utils/fixedPay");
const { reconcileCampaignById } = require("../services/campaignReconciliation");
const { completeCampaign, CompletionError, COMPLETE_ROLES } = require("../services/campaignCompletion");
const { campaignHasPayments } = require("../utils/campaignPayments");

const adminGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
// Moving money (paying or reviewing withdrawals, the payout run and payout check, refunds, voids,
// cancelling a paid campaign, which refunds it): finance admins and super admins only.
const MONEY_ROLES = ["finance_admin", "super_admin"];
const moneyGuard = [protect, authorizeRoles(...MONEY_ROLES)];
const completeGuard = [protect, authorizeRoles(...COMPLETE_ROLES)];

// Answers a completion, or its refusal.
async function answerCompletion(req, res, next, { campaignId, note }) {
  try {
    const { campaign, closedPlaces } = await completeCampaign({ campaignId, req, note });
    res.json({ success: true, status: campaign.status, closedPlaces });
  } catch (error) {
    if (error instanceof CompletionError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
}

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
      // Creator payouts only; Paystack transfer fees are also "released" rows.
      Transaction.aggregate([
        { $match: { type: "release", status: "released" } },
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
    if (status && status !== "all") {
      if (status === "pending_approval") {
        filter.status = { $in: ["pending_payment", "under_review"] };
      } else {
        filter.status = status;
      }
    }
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

    // Creators whose niches overlap each campaign's niches or category, counted in the database in
    // one query rather than by loading every creator profile.
    const nichesOf = (c) =>
      [...(Array.isArray(c.niches) ? c.niches : []), c.category]
        .map((n) => (n ? String(n).trim().toLowerCase() : ""))
        .filter(Boolean);
    const withNiches = campaigns.map((c, index) => ({ key: `c${index}`, niches: nichesOf(c) })).filter((c) => c.niches.length > 0);
    const creatorCounts = new Map();
    if (withNiches.length > 0) {
      const [facets] = await CreatorProfile.aggregate([
        { $match: { "niches.0": { $exists: true } } },
        {
          $project: {
            niches: {
              $map: { input: "$niches", as: "n", in: { $toLower: { $trim: { input: { $toString: "$$n" } } } } },
            },
          },
        },
        {
          $facet: Object.fromEntries(
            withNiches.map((c) => [c.key, [{ $match: { niches: { $in: c.niches } } }, { $count: "n" }]])
          ),
        },
      ]);
      for (const c of withNiches) creatorCounts.set(c.key, facets && facets[c.key][0] ? facets[c.key][0].n : 0);
    }

    res.json({
      campaigns: campaigns.map((c, index) => {
        const creatorCount = creatorCounts.get(`c${index}`) || 0;

        return {
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
        creatorCount,
        progressPercent: c.targetViews > 0
          ? Math.min(Math.round(((c.viewsDelivered || 0) / c.targetViews) * 100), 100)
          : 0,
        coverImageUrl: c.coverImageUrl,
        contentBrief: c.contentBrief || (c.brief && c.brief.summary) || null,
        platforms: c.platforms,
        contentStyle: c.contentStyle,
        niches: c.niches,
        slotCount: c.slotCount || 5,
        statusNote: c.statusNote,
        campaignModel: c.campaignModel || "performance",
        contentPay: c.campaignModel === "content" ? c.contentPay : undefined,
        createdAt: c.createdAt,
        brand: c.businessId
          ? { id: c.businessId._id, name: c.businessId.name, email: c.businessId.email }
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

// ─── GET /api/admin/campaigns/:id ─────────────────────────────────────────────
router.get("/campaigns/:id", adminGuard, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate("businessId", "name email");
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const [slots, submissions, hasPayments] = await Promise.all([
      Slot.find({ campaignId: campaign._id }).populate("creatorId", "name email"),
      Submission.find({ campaignId: campaign._id }).populate("creatorId", "name email"),
      campaignHasPayments(campaign._id),
    ]);

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.name,
        category: campaign.category,
        contentBrief: campaign.contentBrief || (campaign.brief && campaign.brief.summary) || null,
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
        statusNote: campaign.statusNote,
        viewsDelivered: campaign.viewsDelivered || 0,
        progressPercent: campaign.targetViews > 0 ? Math.min(Math.round(((campaign.viewsDelivered || 0) / campaign.targetViews) * 100), 100) : 0,
        slotCount: campaign.slotCount || 5,
        campaignModel: campaign.campaignModel || "performance",
        hasPayments,
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

// ─── Content campaigns: fixed pay and unused budget (ticket 09) ──────────────
function sendRefundError(res, error, next) {
  if (error instanceof RefundError) {
    return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
  }
  return next(error);
}

// Deliverables bought / completed / owed / unused, what's refundable now, and whether the
// campaign's books balance.
router.get("/campaigns/:id/content-budget", adminGuard, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
    const loaded = await contentBudgetSummary(req.params.id);
    if (!loaded) return res.status(404).json({ error: "Content campaign not found" });
    const reconciliation = await reconcileCampaignById(req.params.id);
    res.json({ ...loaded.summary, reconciliation });
  } catch (err) {
    next(err);
  }
});


// Logs a refund attempt, tells the brand once Paystack has it, and answers with the real outcome:
// 200 when sent or refunded, 502 when it failed or couldn't be sent (retryable).
async function answerRefund(req, res, { refund, campaignId, action, note }) {
  const campaign = await Campaign.findById(campaignId).select("name businessId");
  await recordAdminActivity(req, {
    action,
    targetType: "campaign",
    targetId: campaignId,
    targetLabel: campaign ? campaign.name : null,
    businessId: campaign ? campaign.businessId : null,
    note,
    metadata: {
      refundId: refund.id,
      amount: refund.amount,
      deliverables: refund.deliverables,
      creatorBudget: refund.creatorBudget,
      platformFee: refund.platformFee,
      state: refund.state,
      error: refund.error,
    },
  });
  if (campaign && ["sent", "refunded"].includes(refund.state)) {
    await Notification.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      type: "campaign_refund",
      title: "Unused budget refunded",
      body: `₦${refund.amount.toLocaleString()} for ${refund.deliverables} unused deliverable${refund.deliverables === 1 ? "" : "s"} on "${campaign.name}" is being refunded to your payment method.`,
    });
  }
  const summary = await contentBudgetSummary(campaignId);
  const wentThrough = ["sent", "refunded"].includes(refund.state);
  res.status(wentThrough ? 200 : 502).json({
    success: wentThrough,
    refund,
    summary: summary ? summary.summary : null,
  });
}

// D5 at launch: admin refunds a finished content campaign's unused deliverables to the brand.
// The body carries the amount the admin confirmed, so a stale screen can't refund something else.
router.post("/campaigns/:id/refund-unused", moneyGuard, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
    const expected = req.body && req.body.expectedAmount;
    if (!(Number(expected) > 0)) {
      return res.status(400).json({ error: "Confirm the amount to refund", code: "AMOUNT_REQUIRED" });
    }
    const note = String((req.body && req.body.note) || "").trim() || null;
    let result;
    try {
      result = await refundUnusedContentBudget({ campaignId: req.params.id, expectedAmount: Number(expected), note });
    } catch (error) {
      return sendRefundError(res, error, next);
    }
    await answerRefund(req, res, { refund: result.refund, campaignId: result.campaign._id, action: "campaign.unused_budget_refunded", note });
  } catch (err) {
    next(err);
  }
});

// Retries a failed or interrupted unused-budget refund from its own row.
router.post("/campaigns/:id/refunds/:refundId/retry", moneyGuard, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
    let result;
    try {
      result = await retryContentRefund({ campaignId: req.params.id, refundId: req.params.refundId });
    } catch (error) {
      return sendRefundError(res, error, next);
    }
    await answerRefund(req, res, { refund: result.refund, campaignId: req.params.id, action: "campaign.unused_budget_refund_retried", note: null });
  } catch (err) {
    next(err);
  }
});

// Voids fixed pay for approved brand-page content never delivered (14 days after approval, or on a
// cancelled campaign). Idempotent; the creator is told and the action logged once.
router.post("/submissions/:id/void-undelivered", moneyGuard, async (req, res, next) => {
  try {
    let result;
    try {
      result = await voidUndeliveredPay({ submissionId: req.params.id, voidedBy: req.user._id });
    } catch (error) {
      return sendRefundError(res, error, next);
    }
    const { voided, amount, submission, campaign } = result;
    if (voided) {
      const note = String((req.body && req.body.note) || "").trim() || null;
      await recordEvent(await Submission.findById(submission._id), {
        type: "fixed_pay_voided",
        actor: "admin",
        actorId: req.user._id,
        actorName: req.user.name,
        reason: note,
        metadata: { amount },
      });
      await Notification.create({
        creatorId: submission.creatorId,
        campaignId: campaign._id,
        type: "content_not_delivered",
        title: "Pay removed: content not delivered",
        body: `Your approved content for "${campaign.name}" was never delivered to the brand, so its ₦${amount.toLocaleString()} fixed pay was removed.`,
      });
      await recordAdminActivity(req, {
        action: "submission.fixed_pay_voided",
        targetType: "submission",
        targetId: submission._id,
        targetLabel: `${submission.creatorHandle || "Creator"} · ${campaign.name}`,
        businessId: campaign.businessId,
        note,
        metadata: { amount, campaignId: campaign._id, creatorId: submission.creatorId },
      });
    }
    res.json({ success: true, voided, amount });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/campaigns/:id (edit details) ─────────────────────────────
router.patch("/campaigns/:id", adminGuard, async (req, res, next) => {
  try {
    const { category, platforms, contentStyle, niches, slotCount } = req.body;
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

    await campaign.save();

    // Rebuild available slots when the slot count is changed (e.g. while live). Content
    // campaigns have one placement per deliverable bought, so their count can't change here.
    if (slotCount !== undefined && campaign.campaignModel !== "content") {
      await syncCampaignSlots(campaign, slotCount);
      await emitPlacesLeft(campaign._id);
    }

    res.json({
      success: true,
      campaign: {
        id: campaign._id,
        category: campaign.category,
        costPerView: campaign.costPerView,
        platforms: campaign.platforms,
        contentStyle: campaign.contentStyle,
        niches: campaign.niches,
        slotCount: campaign.slotCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/campaigns/:id/complete ───────────────────────────────────
// Ends a live or paused campaign: open places close, the brand is told, and a content campaign's
// unused budget becomes refundable.
router.post("/campaigns/:id/complete", completeGuard, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Campaign not found" });
  return answerCompletion(req, res, next, { campaignId: req.params.id, note: req.body && req.body.note });
});

// ─── PATCH /api/admin/campaigns/:id/status ────────────────────────────────────
router.patch("/campaigns/:id/status", adminGuard, async (req, res, next) => {
  try {
    const { status, note } = req.body;
    const allowed = ["live", "paused", "cancelled", "under_review", "completed"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (["under_review", "cancelled"].includes(status) && !(note && String(note).trim())) {
      return res.status(400).json({ error: "A reason is required to reject or cancel a campaign" });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    // Transition guards to prevent invalid state jumps (M4)
    const ALLOWED_TRANSITIONS = {
      draft: ["cancelled"],
      pending_payment: ["cancelled"],
      under_review: ["live", "cancelled"],
      live: ["paused", "completed", "under_review", "cancelled"],
      paused: ["live", "completed", "under_review", "cancelled"],
      completed: [],
      cancelled: [],
    };

    const allowedNext = ALLOWED_TRANSITIONS[campaign.status] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition campaign from "${campaign.status}" to "${status}"`,
      });
    }

    // Completing closes open places and opens the unused-budget refund: the same path as Complete Campaign.
    if (status === "completed") {
      if (!COMPLETE_ROLES.includes(req.user.role)) return res.status(403).json({ error: "Not authorized for this action" });
      return answerCompletion(req, res, next, { campaignId: campaign._id, note });
    }

    // Cancelling a paid campaign refunds its views and referral budget automatically.
    if (status === "cancelled" && !MONEY_ROLES.includes(req.user.role)) {
      const paid = await campaignHasPayments(campaign._id);
      if (paid) {
        return res.status(403).json({
          error: "Only finance admins and super admins can cancel a paid campaign, because cancelling sends refunds",
          code: "MONEY_ROLE_REQUIRED",
        });
      }
    }

    if (status === "live") {
      const depositExists = await Transaction.exists({
        campaignId: campaign._id,
        type: "escrow_deposit",
        status: "escrow_deposit",
      });
      if (!depositExists) {
        return res.status(400).json({
          error: "Cannot set campaign to live: no confirmed escrow deposit was found for this campaign",
        });
      }
    }

    const prevStatus = campaign.status;
    campaign.status = status;
    if (status === "completed" && !campaign.completedAt) {
      campaign.completedAt = new Date();
    }
    campaign.statusNote = ["under_review", "cancelled", "paused"].includes(status)
      ? String(note || "").trim()
      : null;
    await campaign.save();

    if (status === "live") {
      await ensureCampaignSlots(campaign);
      // Places closed by a void while it wasn't live come back.
      await reopenClosedPlaces(campaign);
    }

    if (status === "cancelled") {
      await refundViewsEscrow(campaign._id);
    }

    if (status === "cancelled") {
      await refundUnusedReferralBudget(campaign._id);
    }

    await emitCampaignStatus(campaign);

    await Notification.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      type: `campaign_${status}`,
      title: `Campaign Status Updated`,
      body: `Your campaign "${campaign.name}" status was updated from ${prevStatus} to ${status}.${note ? ` Note: ${note}` : ""}`,
    });

    await recordAdminActivity(req, {
      action: "campaign.status_changed",
      targetType: "campaign",
      targetId: campaign._id,
      targetLabel: campaign.name,
      businessId: campaign.businessId,
      note,
      metadata: { from: prevStatus, to: status },
    });

    res.json({ success: true, status: campaign.status });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/campaigns/:id ──────────────────────────────────────────
router.delete("/campaigns/:id", adminGuard, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const deletable = ["draft", "pending_payment", "cancelled"];
    if (!deletable.includes(campaign.status)) {
      return res.status(400).json({ error: "Only draft, pending payment, or cancelled campaigns can be deleted" });
    }
    // Payments, placements, content and conversions back refunds and pay owed, so a campaign
    // with any of them is kept (cancelled) rather than deleted.
    if (await hasDependents(campaign._id)) {
      return res.status(409).json({
        error: "This campaign has payments, creators or content on record, so it can't be deleted. It stays cancelled.",
        code: "CAMPAIGN_HAS_RECORDS",
      });
    }

    await Slot.deleteMany({ campaignId: campaign._id, creatorId: null });
    await campaign.deleteOne();

    res.json({ success: true, message: "Campaign deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/submissions ───────────────────────────────────────────────
router.get("/submissions", adminGuard, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== "all") {
      const statuses = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) filter.status = statuses[0];
      else if (statuses.length > 1) filter.status = { $in: statuses };
    }

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
    if (status === "rejected" && !(rejectionReason && String(rejectionReason).trim())) {
      return res.status(400).json({ error: "A rejection reason is required" });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    // Campaign engine: content approval (ticket 07): content is only reviewed while it waits for
    // review, through the same guarded transitions the brand uses.
    const contentCampaign = await Campaign.findById(submission.campaignId);
    if (contentApproval.isContentCampaign(contentCampaign)) {
      if (submission.status !== "new") {
        return res.status(409).json({ error: "This content isn't waiting for review", code: "NOT_AWAITING_REVIEW" });
      }
      try {
        const actor = { kind: "admin", user: req.user };
        const reviewed = status === "approved"
          ? await contentApproval.approveContent({ submission, campaign: contentCampaign, actor })
          : await contentApproval.rejectContent({ submission, campaign: contentCampaign, actor, reason: rejectionReason });
        if (adminNotes) await Submission.updateOne({ _id: reviewed._id }, { $set: { adminNotes } });
        return res.json({ success: true, submission: reviewed });
      } catch (error) {
        if (error instanceof contentApproval.ContentApprovalError) {
          return res.status(error.status === 400 ? 409 : error.status).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    }

    submission.status = status === "approved" ? "awaiting_post" : "rejected";
    if (rejectionReason) submission.rejectionReason = rejectionReason;
    if (adminNotes) submission.adminNotes = adminNotes;
    submission.reviewedAt = new Date();
    await submission.save();

    await recordEvent(submission, {
      type: status === "approved" ? "approved" : "rejected",
      actor: "admin",
      actorId: req.user._id,
      actorName: req.user.name,
      reason: status === "rejected" ? rejectionReason : null,
      metadata: adminNotes ? { adminNotes } : {},
    });

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

    emitCampaignUpdate(submission);

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
    if (decision === "reject" && !(notes && String(notes).trim())) {
      return res.status(400).json({ error: "A note/reason is required to uphold a rejection" });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ error: "Submission not found" });

    // Campaign engine: content approval (ticket 07): only an open appeal can be decided; upholding
    // one takes the creator's place back only if it's still free.
    const contentCampaign = await Campaign.findById(submission.campaignId);
    if (contentApproval.isContentCampaign(contentCampaign)) {
      try {
        const decided = await contentApproval.decideAppeal({ submission, campaign: contentCampaign, admin: req.user, decision, notes });
        return res.json({ success: true, submission: decided });
      } catch (error) {
        if (error instanceof contentApproval.ContentApprovalError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        throw error;
      }
    }

    if (decision === "approve") {
      submission.status = "awaiting_post";
      submission.adminNotes = notes || "Appeal approved by Admin";
    } else {
      submission.status = "rejected";
      submission.adminNotes = notes || "Appeal rejected by Admin";
    }
    await submission.save();

    await recordEvent(submission, {
      type: decision === "approve" ? "appeal_approved" : "appeal_rejected",
      actor: "admin",
      actorId: req.user._id,
      actorName: req.user.name,
      reason: notes || null,
    });

    emitCampaignUpdate(submission);

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
    const creatorIds = users.filter((u) => u.role === "creator").map((u) => u._id);
    const [tiktokConnections, metaConnections] = creatorIds.length
      ? await Promise.all([
          TikTokConnection.find({ userId: { $in: creatorIds } }).select("userId username").lean(),
          MetaConnection.find({ userId: { $in: creatorIds } }).select("userId provider username").lean(),
        ])
      : [[], []];
    // Connected social accounts per creator: what verification (D13) requires.
    const connectedMap = {};
    for (const c of tiktokConnections) (connectedMap[c.userId.toString()] ||= []).push({ platform: "tiktok", username: c.username || null });
    for (const c of metaConnections) (connectedMap[c.userId.toString()] ||= []).push({ platform: c.provider || "meta", username: c.username || null });

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
                rankOverride: cp.rankOverride,
                creatorScore: cp.creatorScore,
                verifiedViews: cp.verifiedViews,
                standingUpdatedAt: cp.standingUpdatedAt,
                lifetimeEarnings: cp.lifetimeEarnings,
                socialAccounts: cp.socialAccounts,
                niches: cp.niches,
                verifiedAt: cp.verifiedAt || null,
                connectedAccounts: connectedMap[u._id.toString()] || [],
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

    const wasActive = user.isActive;
    user.isActive = Boolean(isActive);
    await user.save();

    await recordAdminActivity(req, {
      action: user.isActive ? "user.activated" : "user.deactivated",
      targetType: "user",
      targetId: user._id,
      targetLabel: user.email,
      businessId: user.role === "business" ? user._id : null,
      metadata: { from: wasActive, to: user.isActive, role: user.role },
    });

    res.json({ success: true, isActive: user.isActive });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/users/:id (cascade delete account) ────────────────────
router.delete("/users/:id", adminGuard, async (req, res, next) => {
  try {
    const targetId = req.params.id;

    if (String(targetId) === String(req.user._id)) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    const user = await User.findById(targetId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.role === "super_admin") {
      return res.status(400).json({ error: "Super admin accounts cannot be deleted" });
    }

    const userId = user._id;

    if (user.role === "business") {
      const campaignIds = await Campaign.find({ businessId: userId }).distinct("_id");
      if (campaignIds.length > 0) {
        await Promise.all([
          Slot.deleteMany({ campaignId: { $in: campaignIds } }),
          Submission.deleteMany({ campaignId: { $in: campaignIds } }),
          Transaction.deleteMany({ campaignId: { $in: campaignIds } }),
          Notification.deleteMany({ campaignId: { $in: campaignIds } }),
        ]);
      }
      await Campaign.deleteMany({ businessId: userId });
      await BusinessProfile.deleteMany({ userId });
    } else if (user.role === "creator") {
      const campaignIds = await Submission.find({ creatorId: userId }).distinct("campaignId");
      await Promise.all([
        Slot.deleteMany({ creatorId: userId }),
        Submission.deleteMany({ creatorId: userId }),
        Transaction.deleteMany({ campaignId: { $in: campaignIds } }),
        CreatorProfile.deleteMany({ userId }),
      ]);
    }

    await Notification.deleteMany({ $or: [{ businessId: userId }, { creatorId: userId }] });
    await User.findByIdAndDelete(userId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/rank ─────────────────────────────────────────
router.patch("/users/:id/rank", adminGuard, async (req, res, next) => {
  try {
    const { rank, creatorScore, rankOverride } = req.body;
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

    // A hand-set rank pins the creator until an admin clears the override, so the
    // nightly recalculation can't silently undo it.
    if (rank && validRanks.includes(rank)) {
      profile.rank = rank;
      profile.rankOverride = true;
    }
    if (typeof creatorScore === "number") profile.creatorScore = Math.max(0, Math.min(100, creatorScore));
    if (typeof rankOverride === "boolean") profile.rankOverride = rankOverride;

    await profile.save();

    if (profile.rankOverride === false) {
      await recalculateCreator(profile);
    }

    res.json({
      success: true,
      rank: profile.rank,
      creatorScore: profile.creatorScore,
      rankOverride: profile.rankOverride,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/creators/:id/verification ──────────────────────────────
// :id is the creator's user id, like the other /admin/users routes. Verified means admin
// checked the creator's identity and they have at least one connected social account (D13).
router.patch("/creators/:id/verification", adminGuard, async (req, res, next) => {
  try {
    const { verified } = req.body || {};
    if (typeof verified !== "boolean") {
      return res.status(400).json({ error: "verified must be true or false" });
    }

    const profile = await CreatorProfile.findOne({ userId: req.params.id });
    if (!profile) return res.status(404).json({ error: "Creator not found" });

    if (verified) {
      if (!(await hasConnectedSocial(profile.userId))) {
        return res.status(409).json({
          error: "This creator needs a connected TikTok, Instagram or Facebook account before they can be verified",
          code: "SOCIAL_ACCOUNT_REQUIRED",
        });
      }
      if (!profile.verifiedAt) {
        profile.verifiedAt = new Date();
        profile.verifiedBy = req.user._id;
      }
    } else {
      profile.verifiedAt = null;
      profile.verifiedBy = null;
    }
    await profile.save();

    await recordAdminActivity(req, {
      action: verified ? "creator.verified" : "creator.unverified",
      targetType: "user",
      targetId: profile.userId,
      targetLabel: profile.displayName || profile.username,
    });

    res.json({ verified: Boolean(profile.verifiedAt), verifiedAt: profile.verifiedAt });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/campaigns/:id/activity ───────────────────────────────────
router.get("/campaigns/:id/activity", adminGuard, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate("businessId", "name avatar");
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const [events, submissions, releasedGroups] = await Promise.all([
      listEventsForCampaign(campaign._id),
      Submission.find({ campaignId: campaign._id }).sort({ submittedAt: 1 }),
      // payoutAmount was never stored on submissions; settled views releases are the truth.
      Transaction.aggregate([
        {
          $match: {
            campaignId: campaign._id,
            type: "release",
            status: "released",
            bucket: { $nin: ["referral", "fixed"] },
            submissionId: { $ne: null },
          },
        },
        { $group: { _id: "$submissionId", total: { $sum: "$amount" } } },
      ]),
    ]);

    const submissionById = new Map(submissions.map((s) => [String(s._id), s]));
    const releasedBySubmission = new Map(releasedGroups.map((group) => [String(group._id), group.total]));

    res.json({
      campaign: {
        id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        brandName: campaign.businessId ? campaign.businessId.name : null,
        targetViews: campaign.targetViews,
        viewsDelivered: campaign.viewsDelivered,
        creatorPool: campaign.creatorPool,
        createdAt: campaign.createdAt,
      },
      submissions: submissions.map((s) => ({
        id: s._id,
        creatorId: s.creatorId,
        creatorHandle: s.creatorHandle,
        status: s.status,
        videoUrl: s.videoUrl,
        caption: s.caption,
        confidenceScore: s.confidenceScore,
        viewsDelivered: s.viewsDelivered,
        payoutAmount: releasedBySubmission.get(String(s._id)) || 0,
        payoutStatus: s.payoutStatus,
        rejectionReason: s.rejectionReason,
        adminNotes: s.adminNotes,
        postedPlatforms: s.postedPlatforms,
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
        postedAt: s.postedAt,
      })),
      events: events.map((e) => {
        const submission = submissionById.get(String(e.submissionId));
        return {
          id: e._id,
          submissionId: e.submissionId,
          type: e.type,
          label: labelFor(e.type),
          actor: e.actor,
          actorName: e.actorName || (e.actorId ? e.actorId.name : null),
          creatorHandle: submission ? submission.creatorHandle : null,
          statusAfter: e.statusAfter,
          reason: e.reason,
          metadata: e.metadata,
          at: e.createdAt,
          ago: timeAgo(e.createdAt),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/payouts/reconcile ───────────────────────────────────────
router.post("/payouts/reconcile", moneyGuard, async (req, res, next) => {
  try {
    const summary = await reconcilePayouts();
    res.json({ success: true, message: "Payout reconciliation completed", summary });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/rank/recalculate ────────────────────────────────────────
router.post("/rank/recalculate", adminGuard, async (req, res, next) => {
  try {
    const summary = await recalculateAllCreators();
    res.json({ success: true, message: "Creator ranking recalculated", summary });
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

// ─── GET /api/admin/industries ─────────────────────────────────────────────────
router.get("/industries", adminGuard, async (req, res, next) => {
  try {
    await seedIndustries();

    const industries = await Industry.find().sort({ sortOrder: 1, name: 1 });

    const creatorProfiles = await CreatorProfile.find({}, { niches: 1 });
    const creatorNiches = creatorProfiles.map((p) =>
      (p.niches || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)
    );

    res.json({
      industries: industries.map((i) => {
        const name = String(i.name).trim().toLowerCase();
        const creatorCount = creatorNiches.filter((pn) => pn.includes(name)).length;
        return {
          id: i._id,
          name: i.name,
          enabled: i.enabled,
          costPerView: i.costPerView ?? null,
          sortOrder: i.sortOrder,
          creatorCount,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/industries ─────────────────────────────────────────────────
router.post("/industries", adminGuard, async (req, res, next) => {
  try {
    const { name, enabled = true, sortOrder = 0, costPerView } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Industry name is required" });
    }

    const existing = await Industry.findOne({ name: { $regex: `^${name.trim()}$`, $options: "i" } });
    if (existing) {
      return res.status(400).json({ error: "Industry already exists" });
    }

    const industry = await Industry.create({
      name: name.trim(),
      enabled: Boolean(enabled),
      costPerView: costPerView === undefined || costPerView === "" ? null : Number(costPerView),
      sortOrder: Number(sortOrder) || 0,
    });

    res.status(201).json({
      success: true,
      industry: {
        id: industry._id,
        name: industry.name,
        enabled: industry.enabled,
        costPerView: industry.costPerView ?? null,
        sortOrder: industry.sortOrder,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/industries/:id ───────────────────────────────────────────
router.patch("/industries/:id", adminGuard, async (req, res, next) => {
  try {
    const { name, enabled, sortOrder, costPerView } = req.body;
    const industry = await Industry.findById(req.params.id);
    if (!industry) return res.status(404).json({ error: "Industry not found" });

    if (name !== undefined && name.trim()) industry.name = name.trim();
    if (enabled !== undefined) industry.enabled = Boolean(enabled);
    if (sortOrder !== undefined) industry.sortOrder = Number(sortOrder) || 0;
    if (costPerView !== undefined) {
      industry.costPerView = costPerView === "" || costPerView === null ? null : Number(costPerView);
    }

    await industry.save();
    res.json({
      success: true,
      industry: {
        id: industry._id,
        name: industry.name,
        enabled: industry.enabled,
        costPerView: industry.costPerView ?? null,
        sortOrder: industry.sortOrder,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/industries/:id ──────────────────────────────────────────
router.delete("/industries/:id", adminGuard, async (req, res, next) => {
  try {
    const industry = await Industry.findByIdAndDelete(req.params.id);
    if (!industry) return res.status(404).json({ error: "Industry not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
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
        { $group: { _id: { type: "$type", status: "$status" }, totalAmount: { $sum: "$amount" } } },
      ]),
    ]);

    // Status matters: a failed or in-flight release is not money paid out, and
    // top-ups are money deposited.
    const sumWhere = (predicate) =>
      stats
        .filter((s) => predicate(s._id.type, s._id.status))
        .reduce((total, s) => total + s.totalAmount, 0);

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
        escrowDeposited: sumWhere(
          (type, status) => ["escrow_deposit", "topup"].includes(type) && status === "escrow_deposit"
        ),
        releasedPayouts: sumWhere((type, status) => type === "release" && status === "released"),
        refunds: sumWhere((type) => type === "refund"),
      },
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/withdrawals ──────────────────────────────────────────────
router.get("/withdrawals", adminGuard, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status && ["pending", "processing", "rejected", "released"].includes(status)) {
      filter.status = status;
    }

    const [withdrawals, total, pendingCount] = await Promise.all([
      Withdrawal.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("businessId", "name")
        .populate("creatorId", "name")
        .populate("campaignId", "name targetViews viewsDelivered creatorPool costPerView status")
        .populate("submissionId", "viewsDelivered"),
      Withdrawal.countDocuments(filter),
      Withdrawal.countDocuments({ status: "pending" }),
    ]);

    const list = [];
    for (const w of withdrawals) {
      list.push({
        id: w._id,
        campaignId: w.campaignId,
        campaignName: w.campaignId ? w.campaignId.name : "Campaign",
        campaignStatus: w.campaignId ? w.campaignId.status : null,
        brandName: w.businessId ? w.businessId.name : "Brand",
        creatorId: w.creatorId,
        creatorName: w.creatorId ? w.creatorId.name : "Creator",
        amount: w.amount,
        status: w.status,
        adminNotes: w.adminNotes,
        targetViews: w.campaignId ? w.campaignId.targetViews : null,
        viewsDelivered: w.submissionId
          ? w.submissionId.viewsDelivered
          : w.campaignId
            ? w.campaignId.viewsDelivered
            : 0,
        kind: w.kind || "views",
        viewsAmount: w.kind === "campaign" ? w.viewsAmount : w.kind === "referral" ? 0 : w.amount,
        referralAmount: w.kind === "campaign" ? w.referralAmount : w.kind === "referral" ? w.amount : 0,
        fixedAmount: w.kind === "campaign" ? w.fixedAmount || 0 : 0,
        // Each part is paid from its own pot, so show the balances that will fund it.
        escrowBalance: w.campaignId ? await campaignEscrowBalance(w.campaignId, w.kind === "referral" ? "referral" : "views") : 0,
        referralEscrowBalance: w.campaignId && w.kind === "campaign" ? await campaignEscrowBalance(w.campaignId, "referral") : null,
        fixedEscrowBalance: w.campaignId && w.kind === "campaign" && (w.fixedAmount || 0) > 0 ? await campaignEscrowBalance(w.campaignId, "fixed") : null,
        requestedAt: w.requestedAt,
        reviewedAt: w.reviewedAt,
        releasedAt: w.releasedAt,
      });
    }

    res.json({ withdrawals: list, total, pendingCount, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/withdrawals/:id/review ──────────────────────────────────
const { payWithdrawal, rejectWithdrawal, withdrawalParts, estimateTransferFee } = require("../services/withdrawalPayouts");
const { payoutWeekStart, nextPayoutDate } = require("../utils/payoutSchedule");

router.post("/withdrawals/:id/review", moneyGuard, async (req, res, next) => {
  try {
    const { approve, note } = req.body || {};
    const result =
      approve === true
        ? await payWithdrawal({ withdrawalId: req.params.id, note, req })
        : await rejectWithdrawal({ withdrawalId: req.params.id, note, req });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// ─── Weekly payout run ───────────────────────────────────────────────────────
// Everything requested before this payout week began is due, grouped by campaign so each
// brand's payouts and Paystack fees are reviewed together.
async function buildPayoutRun(now) {
  const dueBefore = payoutWeekStart(now);
  const [due, upcomingGroups] = await Promise.all([
    Withdrawal.find({ status: "pending", requestedAt: { $lt: dueBefore } })
      .sort({ requestedAt: 1 })
      .populate("campaignId", "name status")
      .populate("businessId", "name")
      .populate("creatorId", "name"),
    Withdrawal.aggregate([
      { $match: { status: "pending", requestedAt: { $gte: dueBefore } } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
  ]);

  const groups = new Map();
  for (const w of due) {
    const campaign = w.campaignId;
    const key = campaign ? String(campaign._id) : "none";
    if (!groups.has(key)) {
      groups.set(key, {
        campaignId: campaign ? campaign._id : null,
        campaignName: campaign ? campaign.name : "Campaign",
        campaignStatus: campaign ? campaign.status : null,
        brandName: w.businessId ? w.businessId.name : "Brand",
        viewsEscrow: campaign ? await campaignEscrowBalance(campaign._id, "views") : 0,
        referralEscrow: campaign ? await campaignEscrowBalance(campaign._id, "referral") : 0,
        fixedEscrow: campaign ? await campaignEscrowBalance(campaign._id, "fixed") : 0,
        lines: [],
      });
    }
    const parts = withdrawalParts(w);
    groups.get(key).lines.push({
      id: w._id,
      creatorName: w.creatorId ? w.creatorId.name : "Creator",
      kind: w.kind || "views",
      viewsAmount: parts.filter((p) => p.bucket === "views").reduce((sum, p) => sum + p.amount, 0),
      referralAmount: parts.filter((p) => p.bucket === "referral").reduce((sum, p) => sum + p.amount, 0),
      fixedAmount: parts.filter((p) => p.bucket === "fixed").reduce((sum, p) => sum + p.amount, 0),
      amount: w.amount,
      estimatedFee: estimateTransferFee(w.amount),
      requestedAt: w.requestedAt,
      attempts: w.payoutAttempts || 0,
      adminNotes: w.adminNotes,
    });
  }

  const list = [...groups.values()].map((group) => ({
    ...group,
    amount: Math.round(group.lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
    estimatedFees: group.lines.reduce((sum, line) => sum + line.estimatedFee, 0),
  }));
  const upcoming = upcomingGroups[0] || { count: 0, amount: 0 };

  return {
    dueBefore,
    nextPayoutDate: nextPayoutDate(now),
    groups: list,
    totals: {
      count: due.length,
      amount: Math.round(list.reduce((sum, group) => sum + group.amount, 0) * 100) / 100,
      estimatedFees: list.reduce((sum, group) => sum + group.estimatedFees, 0),
    },
    upcoming: { count: upcoming.count, amount: upcoming.amount },
  };
}

// ─── GET /api/admin/payout-run ────────────────────────────────────────────────
router.get("/payout-run", adminGuard, async (req, res, next) => {
  try {
    const run = await buildPayoutRun(new Date());
    let paystackBalance = null;
    try {
      paystackBalance = await paystack.fetchBalance("NGN");
    } catch (err) {
      console.error("[Payout run] Balance lookup failed:", err.message);
    }
    res.json({ ...run, paystackBalance });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/payout-run/approve ───────────────────────────────────────
// Pays the chosen due withdrawals one by one after one Paystack balance check for the total.
router.post("/payout-run/approve", moneyGuard, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.withdrawalIds) ? req.body.withdrawalIds.map(String) : [];
    if (ids.length === 0) return res.status(400).json({ error: "Choose at least one withdrawal to pay" });
    if (ids.length > 200) return res.status(400).json({ error: "Pay at most 200 withdrawals at a time" });

    const due = await Withdrawal.find({
      _id: { $in: ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)) },
      status: "pending",
      requestedAt: { $lt: payoutWeekStart(new Date()) },
    }).select("_id amount");
    if (due.length === 0) return res.status(400).json({ error: "None of those withdrawals are due in this payout run" });

    const total = due.reduce((sum, w) => sum + w.amount, 0);
    let paystackBalance = null;
    try {
      paystackBalance = await paystack.fetchBalance("NGN");
    } catch (err) {
      console.error("[Payout run] Balance lookup failed:", err.message);
    }
    if (paystackBalance !== null && total > paystackBalance) {
      return res.status(400).json({
        error: `Your Paystack balance is ₦${paystackBalance.toLocaleString()}, which doesn't cover this ₦${total.toLocaleString()} run. Fund the balance or pay fewer withdrawals.`,
        code: "INSUFFICIENT_PAYSTACK_BALANCE",
        paystackBalance,
      });
    }

    const note = String((req.body && req.body.note) || "").trim() || "Weekly payout run";
    const results = [];
    for (const w of due) {
      const result = await payWithdrawal({ withdrawalId: w._id, note, req, skipBalanceCheck: true });
      results.push({
        id: w._id,
        ok: result.status === 200,
        status: result.status === 200 ? result.body.withdrawal.status : "failed",
        error: result.status === 200 ? null : result.body.error,
      });
    }

    res.json({
      paid: results.filter((r) => r.ok && r.status === "released").length,
      processing: results.filter((r) => r.ok && r.status !== "released").length,
      failed: results.filter((r) => !r.ok).length,
      skipped: ids.length - due.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
