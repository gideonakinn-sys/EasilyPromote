const express = require("express");
const BusinessProfile = require("../models/BusinessProfile");
const { protect, authorizeRoles } = require("../middleware/auth");
const { buildStats, listTransactions } = require("../services/businessDashboard");

const router = express.Router();

router.get("/me", protect, async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findOne({ userId: req.user._id }).populate(
      "userId",
      "name email avatar"
    );
    if (!profile) {
      return res.status(404).json({ error: "Business profile not found" });
    }
    res.json({
      id: profile._id,
      userId: profile.userId._id,
      companyName: profile.companyName,
      industry: profile.industry,
      phone: profile.phone,
      logo: profile.logo,
      cac: profile.cac,
      verificationStatus: profile.verificationStatus,
      website: profile.website,
      description: profile.description,
      contactName: profile.userId.name,
      contactEmail: profile.userId.email,
      avatar: profile.userId.avatar,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me/stats", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    res.json(await buildStats(req.user._id, { month: req.query.month }));
  } catch (error) {
    next(error);
  }
});

router.get("/me/transactions", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    res.json(await listTransactions(req.user._id));
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const profiles = await BusinessProfile.find().populate("userId", "name email");
    res.json(profiles);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findById(req.params.id).populate(
      "userId",
      "name email"
    );
    if (!profile) {
      return res.status(404).json({ error: "Business profile not found" });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

router.post("/", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const existing = await BusinessProfile.findOne({ userId: req.user._id });
    if (existing) {
      return res.status(400).json({ error: "Business profile already exists" });
    }

    const profile = await BusinessProfile.create({
      userId: req.user._id,
      ...req.body,
    });
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

router.put("/:id", protect, async (req, res, next) => {
  try {
    const profile = await BusinessProfile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Business profile not found" });
    }

    if (profile.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const updated = await BusinessProfile.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
