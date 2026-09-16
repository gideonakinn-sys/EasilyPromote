const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Campaign withdrawals pay views, referral and fixed pay together; each part is
    // paid from its own pot.
    fixedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    viewsAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "rejected", "released"],
      default: "pending",
    },
    adminNotes: {
      type: String,
      default: null,
    },
    // Reference of the latest transfer attempt; each attempt gets a new one.
    reference: {
      type: String,
      default: null,
    },
    payoutAttempts: {
      type: Number,
      default: 0,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    releasedAt: {
      type: Date,
      default: null,
    },
    // "campaign": the weekly per-campaign withdrawal, views and referral together.
    // "views" / "referral": older single-pot withdrawals. No kind means views.
    kind: {
      type: String,
      enum: ["views", "referral", "campaign"],
      default: "views",
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ creatorId: 1, status: 1 });
withdrawalSchema.index({ campaignId: 1, creatorId: 1, status: 1 });
withdrawalSchema.index({ creatorId: 1, kind: 1, campaignId: 1, status: 1 });
// At most one pending and one processing withdrawal per creator, campaign and kind, so
// parallel requests can't both be queued. Two equality filters instead of one $in, which
// partial indexes only accept on newer MongoDB versions; different key orders keep them
// distinct indexes.
withdrawalSchema.index(
  { creatorId: 1, campaignId: 1, kind: 1 },
  { name: "one_pending_withdrawal", unique: true, partialFilterExpression: { status: "pending" } }
);
withdrawalSchema.index(
  { campaignId: 1, creatorId: 1, kind: 1 },
  { name: "one_processing_withdrawal", unique: true, partialFilterExpression: { status: "processing" } }
);

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
