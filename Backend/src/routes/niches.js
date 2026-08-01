const express = require("express");
const router = express.Router();
const Niche = require("../models/Niche");

const DEFAULT_NICHES = [
  "Music",
  "Lifestyle",
  "Tech",
  "Beauty",
  "Fashion",
  "Gaming",
  "Food",
  "Fitness",
  "Travel",
  "Comedy",
  "Education",
  "Sports",
  "Photography",
  "Art",
  "Pets",
  "DIY",
  "Finance",
  "Health",
  "Vlogs",
  "Dance",
];

// ─── GET /api/niches (public) ────────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const count = await Niche.countDocuments();
    if (count === 0) {
      await Niche.insertMany(
        DEFAULT_NICHES.map((name, i) => ({ name, sortOrder: i, enabled: true }))
      );
    }

    const includeDisabled = req.query.includeDisabled === "true";
    const filter = includeDisabled ? {} : { enabled: true };
    const niches = await Niche.find(filter).sort({ sortOrder: 1, name: 1 });
    res.json({
      niches: niches.map((n) => ({
        id: n._id,
        name: n.name,
        enabled: n.enabled,
        sortOrder: n.sortOrder,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
