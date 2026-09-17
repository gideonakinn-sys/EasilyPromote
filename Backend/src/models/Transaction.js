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
      // fixed_void: reverses a fixed credit that was never delivered; the amount goes back to the pool.
      // bonus_credit: a hybrid campaign's bonus owed to a creator (ticket 10), reserved from the bonus
      // pool as views or conversions are verified; "voided" when a conversion is voided in its hold.
      enum: ["escrow_deposit", "release", "refund", "topup", "unmatched_payment", "transfer_fee", "fixed_credit", "fixed_void", "bonus_credit"],
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
      // are "credited" while owed and "voided" once reversed.
      enum: ["escrow_deposit", "released", "refunded", "failed", "refund_pending", "refund_failed", "under_review", "credited", "voided"],
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
            // When Paystack accepted the refund request (fixed refunds; Paystack may not return an id).
            sentAt: { type: Date, default: null },
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
    // Rows written before referral budgets existed have no bucket and count as views. Hybrid
    // campaigns' bonus pools are the "bonus" pot (ticket 10).
    bucket: {
      type: String,
      enum: ["views", "referral", "fixed", "bonus"],
      default: "views",
    },
    // Deposits and top-ups: the platform fee inside the amount paid.
    feeAmount: {
      type: Number,
      default: undefined,
    },
    // Fixed refunds: set while a request is sending parts to Paystack, so two retries can't both send.
    refundSendingUntil: {
      type: Date,
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
    // Voided hybrid bonus credits: "pending" until the bonus is back in the pool, then "done". Older
    // voided credits have none (their bonus was returned when they were voided).
    bonusGiveBack: {
      type: String,
      enum: ["pending", "done"],
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
// Creator wallet and payouts: a creator's fixed credits and releases; older views releases by submission.
transactionSchema.index({ creatorId: 1, type: 1, status: 1 });
transactionSchema.index({ submissionId: 1, type: 1 });
// Ops alerts: refunds still pending or failed, oldest first; campaigns with recent money movement.
transactionSchema.index({ type: 1, status: 1, createdAt: 1 });
transactionSchema.index({ updatedAt: -1 });
// Creator wallet: recent transactions for a handle.
transactionSchema.index({ creatorHandle: 1, date: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
