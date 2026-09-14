const AdminActivity = require("../models/AdminActivity");

// Records an admin action after it has succeeded. A logging failure is reported but
// never undoes or blocks the action itself.
async function recordAdminActivity(
  req,
  { action, targetType, targetId, targetLabel = null, businessId = null, note = null, metadata = {} }
) {
  try {
    await AdminActivity.create({
      actorId: req.user._id,
      actorName: req.user.name || req.user.email || null,
      actorRole: req.user.role || null,
      action,
      targetType,
      targetId,
      targetLabel,
      businessId,
      note: note && String(note).trim() ? String(note).trim().slice(0, 1000) : null,
      metadata,
    });
  } catch (error) {
    console.error(`[AdminActivity] Failed to record ${action}:`, error.message);
  }
}

module.exports = { recordAdminActivity };
