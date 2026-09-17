const mongoose = require("mongoose");

// An append-only record of what admins did in the console, so any change to a brand,
// creator or payout can be traced to the person who made it and why. Written through
// services/adminActivity and never edited.
const adminActivitySchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorName: {
      type: String,
      default: null,
    },
    actorRole: {
      type: String,
      default: null,
    },
    // e.g. campaign.status_changed, referral_code.disabled, webhook_key.revoked
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String,
      enum: ["campaign", "user", "withdrawal", "referral_code", "webhook_key", "conversion", "submission"],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    targetLabel: {
      type: String,
      default: null,
    },
    // The brand affected, when there is one, so a brand's history can be pulled in one query.
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

adminActivitySchema.index({ createdAt: -1 });
adminActivitySchema.index({ targetType: 1, createdAt: -1 });
adminActivitySchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminActivitySchema.index({ actorId: 1, createdAt: -1 });
adminActivitySchema.index({ businessId: 1, createdAt: -1 });

module.exports = mongoose.model("AdminActivity", adminActivitySchema);
