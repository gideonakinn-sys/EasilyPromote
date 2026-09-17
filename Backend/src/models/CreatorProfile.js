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
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    // Private: shown to the creator and admin only, never to brands.
    legalName: {
      type: String,
      trim: true,
      maxlength: 150,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    socialAccounts: [
      {
        platform: {
          type: String,
          enum: ["instagram", "tiktok", "youtube", "twitter", "facebook"],
        },
        handle: String,
        verified: { type: Boolean, default: false },
        // Self-reported until follower counts can be read from the platform APIs.
        followers: { type: Number, min: 0 },
      },
    ],
    niches: {
      type: [String],
      default: [],
    },
    categories: {
      type: [String],
      default: [],
    },
    portfolio: {
      type: [
        {
          _id: false,
          url: { type: String, required: true },
          thumbnailUrl: String,
          platform: String,
          title: { type: String, trim: true },
          views: { type: Number, min: 0 },
          category: String,
        },
      ],
      default: [],
    },
    // Where the creator's followers are. Campaign targeting matches on this, never on
    // where the creator lives. Self-reported with a proof screenshot until API data exists.
    audience: {
      locations: {
        type: [{ _id: false, name: { type: String, trim: true }, percentage: Number }],
        default: undefined,
      },
      ages: {
        type: [{ _id: false, range: String, percentage: Number }],
        default: undefined,
      },
      genders: {
        female: Number,
        male: Number,
        other: Number,
      },
      source: {
        type: String,
        enum: ["self_reported", "api"],
      },
      proofUrl: String,
      updatedAt: Date,
    },
    // Set by admin after an identity check, only for creators with a connected social account.
    verifiedAt: {
      type: Date,
      default: null,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    badges: {
      type: [{ type: String, enum: ["top_creator", "high_performer", "reliable_creator", "campaign_pro"] }],
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
    // Recalculated with the creator's standing from their delivered submissions.
    stats: {
      avgViews: { type: Number, default: 0 },
      engagementRate: { type: Number, default: null },
      pastCampaigns: { type: Number, default: 0 },
      totalCampaignViews: { type: Number, default: 0 },
      updatedAt: Date,
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
