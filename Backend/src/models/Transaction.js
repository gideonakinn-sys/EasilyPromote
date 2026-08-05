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
      enum: ["escrow_deposit", "released", "refunded"],
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
