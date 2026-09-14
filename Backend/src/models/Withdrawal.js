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
    status: {
      type: String,
      enum: ["pending", "processing", "rejected", "released"],
      default: "pending",
    },
    adminNotes: {
      type: String,
      default: null,
    },
    reference: {
      type: String,
      default: null,
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
    // Views earnings and referral earnings are separate entitlements with separate
    // escrow. Older withdrawals have no kind and are views withdrawals.
    kind: {
      type: String,
      enum: ["views", "referral"],
      default: "views",
    },
  },
  { timestamps: true }
);

withdrawalSchema.index({ creatorId: 1, status: 1 });
withdrawalSchema.index({ campaignId: 1, creatorId: 1, status: 1 });
withdrawalSchema.index({ creatorId: 1, kind: 1, campaignId: 1, status: 1 });

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
