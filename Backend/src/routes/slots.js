const express = require("express");
const Slot = require("../models/Slot");
const { protect, authorizeRoles } = require("../middleware/auth");
const { joinCampaign } = require("../services/placements");

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

// Older clients claim by campaignId or slotId; it is the same join as POST /api/campaigns/:id/join.
router.post("/claim", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { slotId, campaignId, committedViews, usageRightsAccepted } = req.body;
    const result = await joinCampaign({ user: req.user, slotId, campaignId, committedViews, usageRightsAccepted });
    res.status(result.status).json(result.body);
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
