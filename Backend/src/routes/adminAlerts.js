// Ops alerts for the admin console (M7): list what needs attention, resolve it by hand.
const express = require("express");
const mongoose = require("mongoose");
const OpsAlert = require("../models/OpsAlert");
const { protect, authorizeRoles } = require("../middleware/auth");
const { recordAdminActivity } = require("../services/adminActivity");
const { alertView, TITLES } = require("../services/opsAlerts");

const router = express.Router();

const viewGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
const resolveGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin")];
const MAX_ALERTS = 200;

// GET /api/admin/alerts?status=open|resolved|all — newest first.
router.get("/", viewGuard, async (req, res, next) => {
  try {
    const status = ["open", "resolved", "all"].includes(req.query.status) ? req.query.status : "open";
    const filter = status === "open" ? { resolvedAt: null } : status === "resolved" ? { resolvedAt: { $ne: null } } : {};
    const sort = status === "resolved" ? { resolvedAt: -1 } : { firstSeenAt: -1 };
    const [alerts, open] = await Promise.all([
      OpsAlert.find(filter).sort(sort).limit(MAX_ALERTS).lean(),
      status === "open" ? null : OpsAlert.countDocuments({ resolvedAt: null }),
    ]);
    res.json({ alerts: alerts.map(alertView), open: open === null ? alerts.length : open });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/alerts/:id/resolve — marks it handled. It stays resolved while the condition
// lasts; if the condition clears and comes back later, that's a new alert.
router.patch("/:id/resolve", resolveGuard, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Alert not found" });
    const now = new Date();
    const alert = await OpsAlert.findOneAndUpdate(
      { _id: req.params.id, resolvedAt: null },
      { $set: { resolvedAt: now, resolvedBy: req.user._id } },
      { new: true }
    ).lean();
    if (!alert) {
      const exists = await OpsAlert.exists({ _id: req.params.id });
      return exists ? res.status(409).json({ error: "This alert is already resolved" }) : res.status(404).json({ error: "Alert not found" });
    }
    await recordAdminActivity(req, {
      action: "ops_alert.resolved",
      targetType: "ops_alert",
      targetId: alert._id,
      targetLabel: TITLES[alert.kind] || alert.kind,
      note: req.body && req.body.note,
      metadata: { kind: alert.kind, subjectType: alert.subjectType, subjectId: String(alert.subjectId), stillActive: alert.active },
    });
    res.json(alertView(alert));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
