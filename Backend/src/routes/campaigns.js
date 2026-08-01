const express = require("express");
const Campaign = require("../models/Campaign");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const { protect, authorizeRoles } = require("../middleware/auth");
const { initializeTransaction, verifyTransaction } = require("../services/paystack");
const { ensureCampaignSlots } = require("../utils/ensureSlots");

const router = express.Router();

router.get("/pricing", async (req, res, next) => {
  try {
    const { COST_PER_VIEW } = require("../config/pricing");
    const Industry = require("../models/Industry");
    const categories = { ...COST_PER_VIEW.categories };
    const industries = await Industry.find({ enabled: true, costPerView: { $gt: 0 } });
    for (const ind of industries) {
      categories[ind.name] = ind.costPerView;
    }
    res.json({
      default: COST_PER_VIEW.default,
      categories,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", protect, async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { businessId: req.user._id };

    if (status && status !== "all") {
      if (status === "review_needed") {
        filter.status = "live";
      } else {
        filter.status = status;
      }
    }

    const campaigns = await Campaign.find(filter).sort({ createdAt: -1 });

    const draftCount = await Campaign.countDocuments({
      businessId: req.user._id,
      status: "draft",
    });

    const campaignsResponse = campaigns.map((c) => {
      const progressPercent =
        c.targetViews > 0
          ? Math.min(Math.round((c.viewsDelivered / c.targetViews) * 100), 100)
          : 0;

      return {
        id: c._id,
        name: c.name,
        coverImageUrl: c.coverImageUrl,
        category: c.category,
        status: c.status,
        reviewNeeded: c.status === "live" && c.viewsDelivered < c.targetViews,
        targetViews: c.targetViews,
        viewsDelivered: c.viewsDelivered,
        budget: c.budget,
        costPerView: c.costPerView,
        progressPercent,
        startDate: c.startDate,
        endDate: c.endDate,
        contentBrief: c.contentBrief,
      };
    });

    res.json({ campaigns: campaignsResponse, draftCount });
  } catch (error) {
    next(error);
  }
});

router.post("/", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { coverImageUrl, name, category, targetViews, contentBrief, keyMessageCta, whatToAvoid, platforms, contentStyle, niches, scriptUrl, scriptFileName } = req.body;

    const { getEffectiveCostPerView } = require("../config/pricing");
    const costPerView = await getEffectiveCostPerView(category);
    const budget = targetViews * costPerView;

    const campaign = await Campaign.create({
      businessId: req.user._id,
      coverImageUrl: coverImageUrl || null,
      name,
      category,
      targetViews,
      costPerView,
      budget,
      contentBrief: contentBrief || null,
      keyMessageCta: keyMessageCta || null,
      whatToAvoid: whatToAvoid || null,
      platforms: platforms || [],
      contentStyle: contentStyle ? (Array.isArray(contentStyle) ? contentStyle : contentStyle.split(",").map(s => s.trim()).filter(Boolean)) : [],
      niches: niches || [],
      scriptUrl: scriptUrl || null,
      scriptFileName: scriptFileName || null,
      status: "draft",
    });

    res.status(201).json({
      id: campaign._id,
      status: campaign.status,
      budget: campaign.budget,
      costPerView: campaign.costPerView,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/pay", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Campaign cannot be paid" });
    }

    const reference = `ep_${campaign._id}_${Date.now()}`;

    const origin = req.headers.origin || process.env.PAYSTACK_CALLBACK_URL || "http://localhost:3000";
    const callback_url = `${origin.replace(/\/$/, "")}/dashboard/brand?payment=success&campaignId=${campaign._id}&reference=${reference}`;

    const paymentData = await initializeTransaction({
      email: req.user.email,
      amount: campaign.budget,
      reference,
      metadata: {
        campaignId: campaign._id.toString(),
        businessId: req.user._id.toString(),
        campaignName: campaign.name,
      },
      callback_url,
    });

    campaign.status = "pending_payment";
    campaign.paymentReference = reference;
    await campaign.save();

    res.json({
      authorization_url: paymentData.authorization_url,
      access_code: paymentData.access_code,
      reference,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/payment-status", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (campaign.status === "pending_payment") {
      const transaction = await Transaction.findOne({
        campaignId: campaign._id,
        type: "escrow_deposit",
      });

      if (transaction) {
        campaign.status = "live";
        await campaign.save();
        await ensureCampaignSlots(campaign);
      } else if (campaign.paymentReference) {
        try {
          const paystackData = await verifyTransaction(campaign.paymentReference);
          if (paystackData.status === "success") {
            campaign.status = "live";
            await campaign.save();
            await ensureCampaignSlots(campaign);

            await Transaction.create({
              campaignId: campaign._id,
              type: "escrow_deposit",
              amount: campaign.budget,
              status: "escrow_deposit",
              reference: campaign.paymentReference,
              date: new Date(),
            });

            await Notification.create({
              businessId: campaign.businessId,
              campaignId: campaign._id,
              type: "campaign_live",
              title: "Campaign is live",
              body: "Your campaign is now live. Creators can start claiming slots.",
            });
          }
        } catch {
          // paystack verification failed, status stays pending
        }
      }
    }

    res.json({
      status: campaign.status,
      isPaid: ["under_review", "live", "completed", "paused"].includes(campaign.status),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only edit draft campaigns" });
    }

    const allowedFields = [
      "coverImageUrl",
      "name",
      "category",
      "startDate",
      "endDate",
      "targetViews",
      "contentBrief",
      "keyMessageCta",
      "whatToAvoid",
      "scriptUrl",
      "scriptFileName",
      "platforms",
      "contentStyle",
      "niches",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] =
          field === "contentStyle" && typeof req.body[field] === "string"
            ? req.body[field].split(",").map((s) => s.trim()).filter(Boolean)
            : req.body[field];
      }
    }

    const updated = await Campaign.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/save-and-close", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only save draft campaigns" });
    }

    const { step, data } = req.body;
    const updates = {};

    if (step === 1) {
      if (data.coverImageUrl !== undefined) updates.coverImageUrl = data.coverImageUrl;
      if (data.name !== undefined) updates.name = data.name;
      if (data.category !== undefined) updates.category = data.category;
      if (data.startDate !== undefined) updates.startDate = data.startDate;
      if (data.endDate !== undefined) updates.endDate = data.endDate;
      if (data.targetViews !== undefined) {
        updates.targetViews = data.targetViews;
        const { getEffectiveCostPerView } = require("../config/pricing");
        updates.costPerView = await getEffectiveCostPerView(data.category || campaign.category);
      }
      if (data.scriptUrl !== undefined) updates.scriptUrl = data.scriptUrl;
      if (data.scriptFileName !== undefined) updates.scriptFileName = data.scriptFileName;
    } else if (step === 2) {
      if (data.contentBrief !== undefined) updates.contentBrief = data.contentBrief;
      if (data.keyMessageCta !== undefined) updates.keyMessageCta = data.keyMessageCta;
      if (data.whatToAvoid !== undefined) updates.whatToAvoid = data.whatToAvoid;
      if (data.platforms !== undefined) updates.platforms = data.platforms;
      if (data.contentStyle !== undefined) updates.contentStyle = data.contentStyle;
      if (data.niches !== undefined) updates.niches = data.niches;
    }

    const updated = await Campaign.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ id: updated._id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/review", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({
      id: campaign._id,
      name: campaign.name,
      targetViews: campaign.targetViews,
      budget: campaign.budget,
      platforms: campaign.platforms,
      contentBrief: campaign.contentBrief,
      scriptUrl: campaign.scriptUrl,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/launch", protect, async (req, res, next) => {
  try {
    const { paystackReference } = req.body;

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaign.status !== "draft") {
      return res.status(400).json({ error: "Can only launch draft campaigns" });
    }

    if (paystackReference) {
      const verification = await verifyTransaction(paystackReference);
      if (verification.status !== "success") {
        return res.status(400).json({ error: "Payment verification failed" });
      }
    }

    campaign.status = "live";
    await campaign.save();
    await ensureCampaignSlots(campaign);

    await Transaction.create({
      campaignId: campaign._id,
      type: "escrow_deposit",
      amount: campaign.budget,
      status: "escrow_deposit",
      date: new Date(),
    });

    await Notification.create({
      businessId: req.user._id,
      campaignId: campaign._id,
      type: "campaign_live",
      title: "Campaign is live",
      body: "Your campaign is now live. Creators can start claiming slots.",
    });

    res.json({
      id: campaign._id,
      status: campaign.status,
      message: "Your campaign is now live.",
      escrow: {
        totalEscrowed: campaign.budget,
        platformFee: campaign.platformFee,
        creatorPool: campaign.creatorPool,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/topup-init", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["live", "under_review", "paused"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only top up active campaigns" });
    }

    const reference = `ep_topup_${campaign._id}_${Date.now()}`;

    const origin = req.headers.origin || process.env.PAYSTACK_CALLBACK_URL || "http://localhost:3000";
    const callback_url = `${origin.replace(/\/$/, "")}/dashboard/brand/campaign/${campaign._id}?topup=success&reference=${reference}&amount=${amount}`;

    const paymentData = await initializeTransaction({
      email: req.user.email,
      amount,
      reference,
      metadata: {
        campaignId: campaign._id.toString(),
        businessId: req.user._id.toString(),
        campaignName: campaign.name,
        type: "topup",
      },
      callback_url,
    });

    res.json({
      authorization_url: paymentData.authorization_url,
      reference,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/topup", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { amount, paystackReference } = req.body;

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["live", "under_review", "paused"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only top up active campaigns" });
    }

    if (paystackReference) {
      const verification = await verifyTransaction(paystackReference);
      if (verification.status !== "success") {
        return res.status(400).json({ error: "Payment verification failed" });
      }
    }

    campaign.targetViews += Math.round(amount / campaign.costPerView);
    campaign.budget += amount;
    const platformFeePercent = campaign.platformFeePercent || 0.3;
    campaign.platformFee = Math.round(campaign.budget * platformFeePercent);
    campaign.creatorPool = campaign.budget - campaign.platformFee;
    await campaign.save();

    await Transaction.create({
      campaignId: campaign._id,
      type: "topup",
      amount,
      status: "escrow_deposit",
      date: new Date(),
    });

    res.json({
      budget: campaign.budget,
      creatorPool: campaign.creatorPool,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/pause", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaign.status !== "live") {
      return res.status(400).json({ error: "Can only pause live campaigns" });
    }

    campaign.status = "paused";
    await campaign.save();

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/resume", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaign.status !== "paused") {
      return res.status(400).json({ error: "Can only resume paused campaigns" });
    }

    campaign.status = "live";
    await campaign.save();
    await ensureCampaignSlots(campaign);

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/cancel", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (["completed", "cancelled"].includes(campaign.status)) {
      return res.status(400).json({ error: "Cannot cancel this campaign" });
    }

    campaign.status = "cancelled";
    await campaign.save();

    const unreleased = await Transaction.aggregate([
      { $match: { campaignId: campaign._id, status: "escrow_deposit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const refundAmount = unreleased.length > 0 ? unreleased[0].total : 0;
    if (refundAmount > 0) {
      await Transaction.create({
        campaignId: campaign._id,
        type: "refund",
        amount: refundAmount,
        status: "refunded",
        date: new Date(),
      });
    }

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const progressPercent =
      campaign.targetViews > 0
        ? Math.min(Math.round((campaign.viewsDelivered / campaign.targetViews) * 100), 100)
        : 0;

    const submissionsReceived = await Submission.countDocuments({
      campaignId: campaign._id,
    });
    const submissionsApproved = await Submission.countDocuments({
      campaignId: campaign._id,
      status: { $in: ["approved", "awaiting_post", "posted"] },
    });
    const submissionsAwaitingReview = await Submission.countDocuments({
      campaignId: campaign._id,
      status: "new",
    });

    res.json({
      id: campaign._id,
      name: campaign.name,
      category: campaign.category,
      coverImageUrl: campaign.coverImageUrl,
      targetViews: campaign.targetViews,
      budget: campaign.budget,
      costPerView: campaign.costPerView,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      status: campaign.status,
      viewsDelivered: campaign.viewsDelivered,
      progressPercent,
      contentBrief: campaign.contentBrief,
      keyMessageCta: campaign.keyMessageCta,
      whatToAvoid: campaign.whatToAvoid,
      scriptUrl: campaign.scriptUrl,
      scriptFileName: campaign.scriptFileName,
      platforms: campaign.platforms,
      contentStyle: campaign.contentStyle,
      niches: campaign.niches,
      platformFeePercent: campaign.platformFeePercent,
      platformFee: campaign.platformFee,
      creatorPool: campaign.creatorPool,
      submissionsReceived,
      submissionsApproved,
      submissionsAwaitingReview,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only delete draft or pending payment campaigns" });
    }

    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ message: "Campaign deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
