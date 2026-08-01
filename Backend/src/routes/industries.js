const express = require("express");
const router = express.Router();
const Industry = require("../models/Industry");

const DEFAULT_INDUSTRIES = [
  "Technology",
  "Music",
  "Apparel & Fashion",
  "E-commerce",
  "Food & Beverages",
  "Health & Beauty",
  "Finance",
  "Education",
  "Travel & Hospitality",
  "Gaming",
  "Real Estate",
  "Automotive",
];

// ─── GET /api/industries (public) ─────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const count = await Industry.countDocuments();
    if (count === 0) {
      await Industry.insertMany(
        DEFAULT_INDUSTRIES.map((name, i) => ({ name, sortOrder: i, enabled: true }))
      );
    }

    const includeDisabled = req.query.includeDisabled === "true";
    const filter = includeDisabled ? {} : { enabled: true };
    const industries = await Industry.find(filter).sort({ sortOrder: 1, name: 1 });
    res.json({
      industries: industries.map((i) => ({
        id: i._id,
        name: i.name,
        enabled: i.enabled,
        sortOrder: i.sortOrder,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
