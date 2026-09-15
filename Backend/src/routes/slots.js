const express = require("express");
const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const { protect, authorizeRoles } = require("../middleware/auth");
const { rankAtLeast } = require("../services/creatorScore");

const router = express.Router();

router.get("/campaign/:campaignId", async (req, res, next) => {
  try {
    const slots = await Slot.find({ campaignId: req.params.campaignId })
      .populate("creatorId", "name")
      .sort({ createdAt: -1 });
    res.json(slots);
  } catch (error) {
    next(error);
  }
});

router.get("/my", protect, async (req, res, next) => {
  try {
    const slots = await Slot.find({ creatorId: req.user._id })
      .populate("campaignId", "name status")
      .sort({ createdAt: -1 });
    res.json(slots);
  } catch (error) {
    next(error);
  }
});

router.post("/claim", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { slotId, campaignId, committedViews } = req.body;
    const CreatorProfile = require("../models/CreatorProfile");
    const TikTokConnection = require("../models/TikTokConnection");
    const MetaConnection = require("../models/MetaConnection");

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    const niches = Array.isArray(profile && profile.niches) ? profile.niches : [];
    const hasTikTok = await TikTokConnection.exists({ userId: req.user._id });
    const hasMeta = await MetaConnection.exists({ userId: req.user._id });
    const hasSocial = Boolean(hasTikTok || hasMeta);
    if (!hasSocial || niches.length === 0) {
      return res.status(403).json({ error: "Connect a social account and choose your niches to claim campaigns", code: "CAMPAIGN_ACCESS_LOCKED" });
    }
    const creatorRank = profile ? profile.rank : "rank1";

    const activeSlots = await Slot.countDocuments({
      creatorId: req.user._id,
      status: { $in: ["claimed", "submitted", "verifying"] },
    });
    if (activeSlots >= 3) {
      return res.status(400).json({ error: "Placement limit reached — complete active campaigns to claim more" });
    }

    let slot;
    let targetCampaignId = campaignId;

    if (slotId) {
      slot = await Slot.findById(slotId);
      if (!slot) {
        return res.status(404).json({ error: "Placement not found" });
      }
      targetCampaignId = slot.campaignId;
    }

    if (!targetCampaignId) {
      return res.status(400).json({ error: "slotId or campaignId is required" });
    }

    const campaign = await Campaign.findById(targetCampaignId);
    if (!campaign || campaign.status !== "live") {
      return res.status(404).json({ error: "Campaign not found or not live" });
    }

    // Check if creator already claimed a placement on this campaign (both for slotId and campaignId paths)
    const alreadyClaimed = await Slot.findOne({
      campaignId: campaign._id,
      creatorId: req.user._id,
      status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
    });
    if (alreadyClaimed) {
      return res.status(400).json({ error: "You have already claimed a placement for this campaign" });
    }

    if (!slot) {
      const availableSlots = await Slot.find({ campaignId: campaign._id, status: "available" }).sort({ createdAt: 1 });
      if (availableSlots.length === 0) {
        return res.status(404).json({ error: "No available placements for this campaign" });
      }
      slot = availableSlots.find((s) => rankAtLeast(creatorRank, s.rankRequired));
      if (!slot) {
        return res.status(403).json({
          error: "Your rank doesn't meet the requirement for the remaining placements on this campaign",
          code: "RANK_LOCKED",
        });
      }
    }

    if (slot.status !== "available") {
      return res.status(400).json({ error: "Placement is not available" });
    }
    if (!rankAtLeast(creatorRank, slot.rankRequired)) {
      return res.status(403).json({
        error: `This placement requires ${slot.rankRequired}`,
        code: "RANK_LOCKED",
      });
    }

    // Check pool capacity so total claimed rewards cannot exceed creatorPool (H1)
    const otherClaimed = await Slot.find({
      campaignId: campaign._id,
      _id: { $ne: slot._id },
      status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
    }).select("reward viewTarget");

    const alreadyCommittedPool = otherClaimed.reduce((sum, s) => sum + (s.reward || 0), 0);
    const alreadyCommittedViews = otherClaimed.reduce((sum, s) => sum + (s.viewTarget || 0), 0);
    const poolRemaining = Math.max((campaign.creatorPool || 0) - alreadyCommittedPool, 0);
    const viewsRemaining = Math.max((campaign.targetViews || 0) - alreadyCommittedViews, 0);

    if (poolRemaining <= 0 || viewsRemaining <= 0) {
      return res.status(400).json({ error: "The creator pool for this campaign is fully claimed" });
    }

    let finalViewTarget = Math.min(slot.viewTarget || Math.ceil(campaign.targetViews / 5), viewsRemaining);
    let finalReward = Math.min(slot.reward || Math.floor(campaign.creatorPool / 5), poolRemaining);

    if (committedViews !== undefined && committedViews !== null && committedViews !== "") {
      const target = campaign.targetViews || 0;
      const minViews = Math.min(Math.ceil(target * 0.2), viewsRemaining);
      const maxViews = Math.min(Math.ceil(target * 0.5), viewsRemaining);
      const views = Number(committedViews);
      if (!Number.isFinite(views) || views < minViews || views > maxViews) {
        return res.status(400).json({
          error: `Committed views must be between ${minViews} and ${maxViews} for the remaining campaign pool`,
        });
      }
      finalViewTarget = views;
      const calculatedReward = Math.floor(((campaign.creatorPool || 0) * views) / (campaign.targetViews || 1));
      finalReward = Math.max(1, Math.min(calculatedReward, poolRemaining));
    }

    // Atomically claim the slot to prevent races (M2)
    const claimedSlot = await Slot.findOneAndUpdate(
      { _id: slot._id, status: "available" },
      {
        $set: {
          creatorId: req.user._id,
          status: "claimed",
          claimedAt: new Date(),
          viewTarget: finalViewTarget,
          reward: finalReward,
        },
      },
      { new: true }
    );

    if (!claimedSlot) {
      return res.status(409).json({ error: "This placement was just claimed by another creator" });
    }

    // The pool check above read other claims before this one was written, so two claims
    // at the same moment could both fit. Re-check with this claim in place, and give the
    // placement back if the pool is now over-promised or this creator got two.
    const [claimedTotals] = await Slot.aggregate([
      {
        $match: {
          campaignId: campaign._id,
          status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
        },
      },
      {
        $group: {
          _id: null,
          reward: { $sum: "$reward" },
          mine: { $sum: { $cond: [{ $eq: ["$creatorId", req.user._id] }, 1, 0] } },
        },
      },
    ]);
    if (claimedTotals && (claimedTotals.reward > (campaign.creatorPool || 0) || claimedTotals.mine > 1)) {
      await Slot.updateOne(
        { _id: claimedSlot._id, creatorId: req.user._id, status: "claimed" },
        {
          $set: {
            creatorId: null,
            status: "available",
            claimedAt: null,
            viewTarget: slot.viewTarget,
            reward: slot.reward,
          },
        }
      );
      return res.status(409).json({
        error:
          claimedTotals.mine > 1
            ? "You have already claimed a placement for this campaign"
            : "This campaign's creator pool just filled up. Refresh to see what's left.",
      });
    }

    // A code failure must never cost the creator their placement; backfill repairs it.
    let referralCode = null;
    if (campaign.referral && campaign.referral.enabled && campaign.referral.codeSource === "easilypromote") {
      try {
        const { createReferralCode } = require("../utils/referralCodes");
        const code = await createReferralCode({ slot: claimedSlot, campaign });
        referralCode = code ? code.code : null;
      } catch (error) {
        console.error(`[Referral] Code generation failed for slot ${claimedSlot._id}:`, error.message);
      }
    }

    res.json({
      id: claimedSlot._id,
      campaignId: claimedSlot.campaignId,
      status: claimedSlot.status,
      viewTarget: claimedSlot.viewTarget,
      reward: claimedSlot.reward,
      referralCode,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/submit", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const slot = await Slot.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ error: "Placement not found" });
    }
    if (slot.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (slot.status !== "claimed") {
      return res.status(400).json({ error: "Placement must be claimed before submitting" });
    }

    slot.submissionUrl = req.body.url;
    slot.status = "submitted";
    await slot.save();

    res.json(slot);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
