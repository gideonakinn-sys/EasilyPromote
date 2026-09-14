const express = require("express");
const AdminActivity = require("../models/AdminActivity");
const { protect, authorizeRoles } = require("../middleware/auth");
const { paging, pageMeta, isObjectId, searchRegex, parseDate } = require("../utils/adminQuery");

const router = express.Router();

const viewGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
const TARGET_TYPES = AdminActivity.schema.path("targetType").enumValues;

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
router.get("/", viewGuard, async (req, res, next) => {
  try {
    const pageOptions = paging(req.query, 50);
    const filter = {};
    if (TARGET_TYPES.includes(req.query.targetType)) filter.targetType = req.query.targetType;
    if (typeof req.query.action === "string" && /^[a-z_.]{1,64}$/.test(req.query.action)) filter.action = req.query.action;
    if (isObjectId(req.query.actorId)) filter.actorId = req.query.actorId;
    if (isObjectId(req.query.businessId)) filter.businessId = req.query.businessId;
    if (isObjectId(req.query.targetId)) filter.targetId = req.query.targetId;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = from;
      if (to) filter.createdAt.$lte = to;
    }

    const rx = searchRegex(req.query.q);
    if (rx) filter.$or = [{ targetLabel: rx }, { note: rx }, { actorName: rx }];

    const [entries, total] = await Promise.all([
      AdminActivity.find(filter).sort({ createdAt: -1 }).skip(pageOptions.skip).limit(pageOptions.limit).lean(),
      AdminActivity.countDocuments(filter),
    ]);

    res.json({
      activity: entries.map((entry) => ({
        id: entry._id,
        createdAt: entry.createdAt,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        targetLabel: entry.targetLabel,
        businessId: entry.businessId,
        note: entry.note,
        metadata: entry.metadata || {},
        actor: { id: entry.actorId, name: entry.actorName, role: entry.actorRole },
      })),
      ...pageMeta(total, pageOptions),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
