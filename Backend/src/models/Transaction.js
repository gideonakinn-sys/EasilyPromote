const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      default: null,
    },
    creatorHandle: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ["escrow_deposit", "release", "refund", "topup"],
      required: true,
    },
    views: {
      type: Number,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["escrow_deposit", "released", "refunded", "failed"],
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Escrow and refund lookups per campaign.
transactionSchema.index({ campaignId: 1, type: 1, status: 1 });
// Creator wallet: recent transactions for a handle.
transactionSchema.index({ creatorHandle: 1, date: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
