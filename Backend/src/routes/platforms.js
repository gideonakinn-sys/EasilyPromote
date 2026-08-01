const express = require("express");
const router = express.Router();
const Platform = require("../models/Platform");

// ─── GET /api/platforms (public) ───────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const includeDisabled = req.query.includeDisabled === "true";
    const filter = includeDisabled ? {} : { enabled: true };
    const platforms = await Platform.find(filter).sort({ sortOrder: 1, name: 1 });
    res.json({
      platforms: platforms.map((p) => ({
        id: p._id,
        name: p.name,
        enabled: p.enabled,
        sortOrder: p.sortOrder,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
