const express = require("express");
const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const { protect, authorizeRoles } = require("../middleware/auth");

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
      status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
    });
    if (activeSlots >= 3) {
      return res.status(400).json({ error: "Slot limit reached — complete active campaigns to claim more" });
    }

    let slot;
    if (slotId) {
      slot = await Slot.findById(slotId);
    } else if (campaignId) {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== "live") {
        return res.status(404).json({ error: "Campaign not found or not live" });
      }

      const alreadyClaimed = await Slot.findOne({
        campaignId,
        creatorId: req.user._id,
        status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
      });
      if (alreadyClaimed) {
        return res.status(400).json({ error: "Campaign already claimed" });
      }

      const availableSlots = await Slot.find({ campaignId, status: "available" }).sort({ createdAt: 1 });
      if (availableSlots.length === 0) {
        return res.status(404).json({ error: "No available slots for this campaign" });
      }
      slot = availableSlots.find(
        (s) => !s.rankRequired || s.rankRequired === creatorRank
      ) || availableSlots[0];
    } else {
      return res.status(400).json({ error: "slotId or campaignId is required" });
    }

    if (!slot) {
      return res.status(404).json({ error: "Slot not found" });
    }
    if (slot.status !== "available") {
      return res.status(400).json({ error: "Slot is not available" });
    }

    const campaign = await Campaign.findById(slot.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    if (committedViews !== undefined && committedViews !== null && committedViews !== "") {
      const target = campaign.targetViews || 0;
      const minViews = Math.ceil(target * 0.2);
      const maxViews = Math.ceil(target * 0.5);
      const views = Number(committedViews);
      if (!Number.isFinite(views) || views < minViews || views > maxViews) {
        return res.status(400).json({
          error: `Committed views must be between ${minViews} and ${maxViews} (20%–50% of the campaign target)`,
        });
      }
      slot.viewTarget = views;
      slot.reward = Math.max(1, Math.floor(((campaign.creatorPool || 0) * views) / (campaign.targetViews || 1)));
    }

    slot.creatorId = req.user._id;
    slot.status = "claimed";
    slot.claimedAt = new Date();
    await slot.save();

    res.json({
      id: slot._id,
      campaignId: slot.campaignId,
      status: slot.status,
      viewTarget: slot.viewTarget,
      reward: slot.reward,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/submit", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const slot = await Slot.findById(req.params.id);
    if (!slot) {
      return res.status(404).json({ error: "Slot not found" });
    }
    if (slot.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (slot.status !== "claimed") {
      return res.status(400).json({ error: "Slot must be claimed before submitting" });
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
