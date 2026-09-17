const mongoose = require("mongoose");

const postedPlatformSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      required: true,
      trim: true,
    },
    postUrl: {
      type: String,
      default: "",
    },
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    comments: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

// Campaign engine: content approval (ticket 07)
const changeRequestSchema = new mongoose.Schema(
  {
    round: { type: Number, required: true },
    notes: { type: String, required: true, maxlength: 2000 },
    requestedAt: { type: Date, required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // The content the brand was looking at when it asked.
    videoUrl: String,
    caption: String,
    resubmittedAt: Date,
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    creatorHandle: {
      type: String,
      required: true,
      trim: true,
    },
    videoUrl: {
      type: String,
    },
    caption: {
      type: String,
      maxlength: 1000,
    },
    durationSeconds: {
      type: Number,
    },
    status: {
      type: String,
      // Campaign engine: content approval (ticket 07) adds changes_requested, awaiting_delivery,
      // awaiting_receipt and completed; views campaigns never use them. Content campaigns skip
      // "posted": sharing the live post link moves straight to "verifying" (the brand checks it),
      // and a confirmed receipt is the moment brand-page content counts as delivered.
      enum: [
        "new",
        "approved",
        "rejected",
        "awaiting_post",
        "posted",
        "verifying",
        "appealed",
        "changes_requested",
        "awaiting_delivery",
        "awaiting_receipt",
        "completed",
        "not_delivered",
      ],
      default: "new",
    },
    rejectionReason: {
      type: String,
    },
    appealReason: {
      type: String,
    },
    adminNotes: {
      type: String,
    },
    confidenceScore: {
      type: Number,
      default: 100,
    },
    postedPlatforms: {
      type: [postedPlatformSchema],
      default: [],
    },
    viewsDelivered: {
      type: Number,
      default: 0,
    },
    tiktokVideoId: {
      type: String,
      default: null,
    },
    payoutAmount: {
      type: Number,
      default: 0,
    },
    payoutStatus: {
      type: String,
      enum: ["pending", "escrow_deposit", "released"],
      default: "pending",
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
    },
    postedAt: {
      type: Date,
    },

    // ── Campaign engine: content approval (ticket 07). Content campaigns only. ──
    // The placement this content is for. One submission per creator per placement.
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Slot",
    },
    // When the submission started waiting on the brand (review, receipt or post verification):
    // the 72-hour clock after which it's done automatically (D10). Unset while nobody waits on the brand.
    awaitingBrandSince: {
      type: Date,
    },
    // Set once, atomically, when fixed pay became due (D1). The M6 crediting seam.
    fixedPayDueAt: {
      type: Date,
    },
    // One entry per change-request round, oldest first: what the brand reviewed, its notes,
    // and when the creator resubmitted (D11).
    changeRequests: {
      type: [changeRequestSchema],
      default: undefined,
    },
    autoApproved: {
      type: Boolean,
    },
    // Brand page / both: the download link the creator shared (D12).
    delivery: {
      url: String,
      sharedAt: Date,
      confirmedAt: Date,
      confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    // Brand page / both: the standard licence the creator accepted (D6).
    usageRights: {
      licence: String,
      acceptedAt: Date,
      acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    // Creator page / both: the caption the creator says the live post went out with.
    postedCaption: {
      type: String,
      maxlength: 5000,
    },
    postVerifiedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    // Rejected content can be appealed until then (7 days); an appeal decision closes it. While
    // it's open the deliverable isn't refundable (ticket 09).
    appealableUntil: {
      type: Date,
    },
    // Admin voided fixed pay for approved content that was never delivered to the brand.
    notDeliveredAt: {
      type: Date,
    },
    // The admin who voided it. The creator's placement is closed or reopened without a creator,
    // so this submission is the record of who held it.
    notDeliveredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Payout appeals (D23): voided pay can be appealed until then (7 days after the void); while an
    // appeal is open or can still be filed, the deliverable isn't refundable. Both are cleared when the
    // appeal is decided.
    voidAppealableUntil: {
      type: Date,
    },
    voidAppealOpen: {
      type: Boolean,
    },
    // Set when a payout appeal restored voided pay: the content went back to awaiting delivery.
    voidReinstatedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Creator dashboard and wallet: all of one creator's submissions, newest first.
submissionSchema.index({ creatorId: 1, createdAt: -1 });
// Brand campaign page: per-campaign counts by status; withdrawals: one creator's
// submission on one campaign.
submissionSchema.index({ campaignId: 1, status: 1 });
submissionSchema.index({ campaignId: 1, creatorId: 1 });
// Campaign engine: content approval (ticket 07)
// Deadline job: content waiting on the brand, oldest first.
submissionSchema.index({ status: 1, awaitingBrandSince: 1 });
// One content submission per creator per placement, even when two submits race.
submissionSchema.index(
  { slotId: 1, creatorId: 1 },
  { unique: true, partialFilterExpression: { slotId: { $type: "objectId" } } }
);

module.exports = mongoose.model("Submission", submissionSchema);
