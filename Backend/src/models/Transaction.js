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
    // Which pot the money belongs to. Views and referral budgets are funded and paid
    // out separately, so escrow checks and refunds must never mix them. Rows written
    // before referral budgets existed have no bucket and count as views.
    bucket: {
      type: String,
      enum: ["views", "referral"],
      default: "views",
    },
    // Set on releases so a payout can be credited to its creator without a submission
    // (referral payouts have none).
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Escrow and refund lookups per campaign.
transactionSchema.index({ campaignId: 1, type: 1, status: 1 });
transactionSchema.index({ campaignId: 1, bucket: 1, type: 1, status: 1 });
// One ledger row per payment reference and type, so concurrent confirmations of the
// same payment (webhook, polling, launch) can't book it twice. Rows without a
// reference (older refunds) are not constrained.
transactionSchema.index(
  { reference: 1, type: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: "string" } } }
);
// Creator wallet: recent transactions for a handle.
transactionSchema.index({ creatorHandle: 1, date: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
