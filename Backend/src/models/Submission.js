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
      required: true,
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
      enum: ["new", "approved", "rejected", "awaiting_post", "posted", "verifying", "appealed"],
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Submission", submissionSchema);
