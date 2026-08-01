const express = require("express");
const router = express.Router();
const Industry = require("../models/Industry");
const { seedIndustries } = require("../utils/seedIndustries");

// ─── GET /api/industries (public) ─────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    await seedIndustries();

    const includeDisabled = req.query.includeDisabled === "true";
    const filter = includeDisabled ? {} : { enabled: true };
    const industries = await Industry.find(filter).sort({ sortOrder: 1, name: 1 });
    res.json({
      industries: industries.map((i) => ({
        id: i._id,
        name: i.name,
        enabled: i.enabled,
        costPerView: i.costPerView ?? null,
        sortOrder: i.sortOrder,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
