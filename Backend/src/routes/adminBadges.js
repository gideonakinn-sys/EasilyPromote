// Admin: brand ratings and creator badges (M8, D24 and D25), mounted under /api/admin.
// Every admin role can read, hide or unhide a rating, and override a badge; each change needs a
// note and is audit-logged.
const express = require("express");
const { protect, authorizeRoles } = require("../middleware/auth");
const ratings = require("../services/creatorRatings");
const CreatorProfile = require("../models/CreatorProfile");
const { recalculateCreator } = require("../services/creatorScore");
const { BadgeError, badgeReport, creatorsToReview, setBadgeOverride } = require("../services/creatorBadges");
const { isValidObjectId } = require("mongoose");

const router = express.Router();
const adminGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
const send = (res, result) => res.status(result.status).json(result.body);
const badId = (res, what) => res.status(400).json({ error: `Invalid ${what} id`, code: "INVALID_ID" });

// ─── Ratings ──────────────────────────────────────────────────────────────────
router.get("/ratings", adminGuard, async (req, res, next) => {
  try {
    const { creatorId, hidden, page, limit } = req.query;
    if (creatorId && !isValidObjectId(creatorId)) return badId(res, "creator");
    send(res, await ratings.listForAdmin({ creatorId, hidden, page, limit }));
  } catch (error) {
    next(error);
  }
});

router.patch("/ratings/:id/visibility", adminGuard, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res, "rating");
    send(res, await ratings.setVisibility({ req, ratingId: req.params.id, input: req.body }));
  } catch (error) {
    next(error);
  }
});

// ─── Badges ───────────────────────────────────────────────────────────────────
// Creators whose badges were kept from before automatic badges and still need a review.
router.get("/badges/review", adminGuard, async (req, res, next) => {
  try {
    res.json({ creators: await creatorsToReview() });
  } catch (error) {
    next(error);
  }
});

// :id is the creator's user id, like the other creator routes.
router.get("/creators/:id/badges", adminGuard, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res, "creator");
    const report = await badgeReport(req.params.id);
    if (!report) return res.status(404).json({ error: "Creator not found", code: "NOT_FOUND" });
    res.json(report);
  } catch (error) {
    next(error);
  }
});

// Re-evaluates one creator now instead of at the nightly recalculation.
router.post("/creators/:id/badges/recalculate", adminGuard, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res, "creator");
    const profile = await CreatorProfile.findOne({ userId: req.params.id });
    if (!profile) return res.status(404).json({ error: "Creator not found", code: "NOT_FOUND" });
    await recalculateCreator(profile);
    res.json(await badgeReport(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Body: { mode: "grant" | "revoke" | "auto", note }.
router.put("/creators/:id/badges/:badge", adminGuard, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return badId(res, "creator");
    const { mode, note } = req.body || {};
    res.json(await setBadgeOverride({ req, userId: req.params.id, badge: req.params.badge, mode, note }));
  } catch (error) {
    if (error instanceof BadgeError) return res.status(error.status).json({ error: error.message, code: error.code });
    next(error);
  }
});

module.exports = router;
