const mongoose = require("mongoose");

const creatorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    bio: {
      type: String,
      maxlength: 300,
    },
    country: {
      type: String,
      trim: true,
    },
    socialAccounts: [
      {
        platform: {
          type: String,
          enum: ["instagram", "tiktok", "youtube", "twitter", "facebook"],
        },
        handle: String,
        verified: { type: Boolean, default: false },
      },
    ],
    niches: {
      type: [String],
      default: [],
    },
    rank: {
      type: String,
      enum: ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"],
      default: "rank1",
    },
    rankOverride: {
      type: Boolean,
      default: false,
    },
    creatorScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    scoreBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    verifiedViews: {
      type: Number,
      default: 0,
    },
    standingUpdatedAt: {
      type: Date,
    },
    lifetimeEarnings: {
      type: Number,
      default: 0,
    },
    completionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    payoutAccount: {
      accountName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      bankCode: { type: String, trim: true },
      bankName: { type: String, trim: true },
      paystackRecipientCode: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CreatorProfile", creatorProfileSchema);
