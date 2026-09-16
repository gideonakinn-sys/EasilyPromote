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
      // unmatched_payment: money Paystack collected that couldn't be applied to a campaign;
      // it never counts toward escrow and waits for an admin to refund it.
      // transfer_fee: Paystack's fee on a creator payout, paid by the platform and kept
      // against the campaign for its books; never part of escrow.
      // fixed_credit: a content campaign's fixed pay owed to a creator for one submission
      // (ticket 09), reserved from the creator pool and paid out later by a release.
      enum: ["escrow_deposit", "release", "refund", "topup", "unmatched_payment", "transfer_fee", "fixed_credit"],
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
    // The Paystack transfer a release belongs to. A campaign withdrawal is one transfer
    // with a release row per pot, so the rows share this.
    transferReference: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      // Refunds: refund_pending until Paystack confirms every part, refund_failed when any
      // part needs a manual refund. Unmatched payments sit in under_review. Fixed credits
      // are "credited" while owed.
      enum: ["escrow_deposit", "released", "refunded", "failed", "refund_pending", "refund_failed", "under_review", "credited"],
      required: true,
    },
    adminNotes: {
      type: String,
      default: null,
    },
    // A refund is sent to Paystack against each payment that funded the campaign.
    refundParts: {
      type: [
        new mongoose.Schema(
          {
            chargeReference: { type: String, default: null },
            amount: { type: Number, required: true },
            paystackRefundId: { type: String, default: null },
            status: { type: String, enum: ["pending", "processed", "failed"], default: "pending" },
            error: { type: String, default: null },
          },
          { _id: false }
        ),
      ],
      default: undefined,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    // Which pot the money belongs to. Views, referral and fixed (content campaign) budgets
    // are funded and paid out separately, so escrow checks and refunds must never mix them.
    // Rows written before referral budgets existed have no bucket and count as views.
    bucket: {
      type: String,
      enum: ["views", "referral", "fixed"],
      default: "views",
    },
    // Deposits and top-ups: the platform fee inside the amount paid.
    feeAmount: {
      type: Number,
      default: undefined,
    },
    // A content campaign's unused-budget refund: what the amount is made of.
    refundBreakdown: {
      type: new mongoose.Schema(
        {
          deliverables: { type: Number, required: true },
          creatorBudget: { type: Number, required: true },
          platformFee: { type: Number, required: true },
        },
        { _id: false }
      ),
      default: undefined,
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
// Transfer webhooks and reconciliation find every release row of one transfer.
transactionSchema.index({ transferReference: 1 }, { sparse: true });
// Paystack refund webhooks name the original payment.
transactionSchema.index({ "refundParts.chargeReference": 1 }, { sparse: true });
// Creator wallet: recent transactions for a handle.
transactionSchema.index({ creatorHandle: 1, date: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
