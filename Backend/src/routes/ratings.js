// Post-campaign brand ratings (M8, D24), mounted under /api/campaigns: the brand lists the
// creators it can rate on its campaign and rates (or, within 7 days, re-rates) one.
const express = require("express");
const { protect, authorizeRoles } = require("../middleware/auth");
const ratings = require("../services/creatorRatings");

const router = express.Router();
const send = (res, result) => res.status(result.status).json(result.body);

router.get("/:id/ratings", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    send(res, await ratings.listForBrand({ user: req.user, campaignId: req.params.id }));
  } catch (error) {
    next(error);
  }
});

router.put("/:id/ratings/:creatorId", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    send(res, await ratings.rateCreator({ user: req.user, campaignId: req.params.id, creatorId: req.params.creatorId, input: req.body }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
