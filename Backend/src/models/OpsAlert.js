const mongoose = require("mongoose");

const OPS_ALERT_KINDS = [
  "payout_failed",
  "withdrawal_stuck",
  "refund_stuck",
  "webhook_failing",
  "paystack_webhook_failing",
  "content_deadline_stuck",
  "application_expiry_stuck",
  "views_submission_stuck",
  "auto_refund_failed",
  "reconciliation_mismatch",
  "social_reconnect_needed",
];

// Something the ops team needs to look at, found by the ops alerts job (services/opsAlerts.js).
// One document per occurrence: while the condition keeps showing up the same document is seen
// again; once its subject is re-checked and the condition is gone the alert is resolved, and if
// it comes back later that's a new alert.
const opsAlertSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: OPS_ALERT_KINDS, required: true },
    // Kind + subject, e.g. "refund_stuck:<transaction id>". One active alert per key.
    key: { type: String, required: true },
    subjectType: {
      type: String,
      // "system" for alerts about the platform as a whole (subjectId is all zeros).
      // "connection": a creator's MetaConnection or TikTokConnection (one per creator + provider).
      enum: ["withdrawal", "transaction", "business", "campaign", "system", "connection"],
      required: true,
    },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // The campaign the alert is about, when there is one.
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
    message: { type: String, required: true, maxlength: 2000 },
    // Admin console path to act on it.
    link: { type: String, default: null },
    // What the problem looks like (amount, status, count). A change reopens an admin-resolved alert.
    signature: { type: String, default: null },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    // True while the condition is still found. Cleared conditions resolve the alert.
    active: { type: Boolean, default: true },
    clearedAt: { type: Date, default: null },
    // Set when the condition clears, or when an admin resolves it first. An admin-resolved alert
    // whose condition lasts reopens when the problem changes or 24 hours after it was resolved.
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reopenedAt: { type: Date, default: null },
    // Set once the email actually went out; cleared when the alert reopens.
    emailedAt: { type: Date, default: null },
    // When a send was last started, so two runs don't send the same alert at once.
    emailAttemptAt: { type: Date, default: null },
  },
  { timestamps: true }
);

opsAlertSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { active: true } });
opsAlertSchema.index({ resolvedAt: 1, firstSeenAt: -1 });
opsAlertSchema.index({ active: 1, kind: 1 });

module.exports = mongoose.model("OpsAlert", opsAlertSchema);
module.exports.OPS_ALERT_KINDS = OPS_ALERT_KINDS;
