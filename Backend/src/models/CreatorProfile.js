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
        // Self-reported, or read from the platform when the account is connected (Instagram).
        followers: { type: Number, min: 0 },
        followersSource: { type: String, enum: ["self_reported", "api"] },
        followersSyncedAt: Date,
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
    // The badges the creator shows and eligibility's requiredBadges reads: the automatic ones
    // (badgesAuto) plus admin grants, less admin revocations (services/creatorBadges.js, M8).
    badges: {
      type: [{ type: String, enum: ["top_creator", "high_performer", "reliable_creator", "campaign_pro"] }],
      default: [],
    },
    // What the badge rules gave the creator at the last evaluation, with hysteresis (badgeRules.js).
    badgesAuto: {
      type: [{ type: String, enum: ["top_creator", "high_performer", "reliable_creator", "campaign_pro"] }],
      default: undefined,
    },
    // At most one per badge. source "migration": a badge held before automatic badges, kept as a
    // grant until an admin reviews it.
    badgeOverrides: {
      type: [
        {
          _id: false,
          badge: { type: String, enum: ["top_creator", "high_performer", "reliable_creator", "campaign_pro"], required: true },
          mode: { type: String, enum: ["grant", "revoke"], required: true },
          source: { type: String, enum: ["admin", "migration"], default: "admin" },
          note: { type: String, maxlength: 500 },
          setBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          setAt: Date,
        },
      ],
      default: undefined,
    },
    // Per badge: the checks behind the last evaluation and the metrics they read, so admins can see
    // why a creator has or lacks a badge.
    badgeEvaluation: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    badgesEvaluatedAt: {
      type: Date,
    },
    // Bumped on every badge write, so a recalculation and an admin override at the same moment
    // can't overwrite each other (or notify twice).
    badgesRevision: {
      type: Number,
    },
    // Visible (not hidden) brand ratings (M8, D24). Brands and the creator see the average only
    // from 3 ratings (utils/creatorProfile.js publicRating); admins always see it.
    brandRating: {
      average: { type: Number, default: null },
      count: { type: Number, default: 0 },
      updatedAt: Date,
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
