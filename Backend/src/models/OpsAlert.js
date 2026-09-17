const mongoose = require("mongoose");

const OPS_ALERT_KINDS = [
  "payout_failed",
  "withdrawal_stuck",
  "refund_stuck",
  "webhook_failing",
  "content_deadline_stuck",
  "application_expiry_stuck",
  "reconciliation_mismatch",
];

// Something the ops team needs to look at, found by the ops alerts job (services/opsAlerts.js).
// One document per occurrence: while the condition keeps showing up the same document is seen
// again; once it clears the alert is resolved, and if it comes back later that's a new alert.
const opsAlertSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: OPS_ALERT_KINDS, required: true },
    // Kind + subject, e.g. "refund_stuck:<transaction id>". One active alert per key.
    key: { type: String, required: true },
    subjectType: {
      type: String,
      enum: ["withdrawal", "transaction", "business", "campaign"],
      required: true,
    },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // The campaign the alert is about, when there is one.
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
    message: { type: String, required: true, maxlength: 2000 },
    // Admin console path to act on it.
    link: { type: String, default: null },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    // True while the condition is still found. Cleared conditions resolve the alert.
    active: { type: Boolean, default: true },
    clearedAt: { type: Date, default: null },
    // Set when the condition clears, or when an admin resolves it first (it then stays resolved
    // until the condition clears, instead of reopening every run).
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    emailedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

opsAlertSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { active: true } });
opsAlertSchema.index({ resolvedAt: 1, firstSeenAt: -1 });
opsAlertSchema.index({ active: 1, kind: 1 });

module.exports = mongoose.model("OpsAlert", opsAlertSchema);
module.exports.OPS_ALERT_KINDS = OPS_ALERT_KINDS;
