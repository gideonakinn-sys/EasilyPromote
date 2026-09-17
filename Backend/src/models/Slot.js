const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rankRequired: {
      type: String,
      enum: ["rank1", "rank2", "rank3", "rank4", "rank5", "elite", null],
      default: null,
    },
    // A views placement delivers a share of the campaign's views; a deliverable placement
    // (content campaigns) delivers one approved piece of content for a fixed reward.
    kind: {
      type: String,
      enum: ["views", "deliverable"],
      default: "views",
    },
    viewTarget: {
      type: Number,
      required: [
        function () {
          return this.kind !== "deliverable";
        },
        "View target is required",
      ],
      // 0 on a referrals-only campaign's places (SPEC D31): they carry no views.
      min: 0,
    },
    reward: {
      type: Number,
      required: [true, "Reward is required"],
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "available",
        "reserved",
        "claimed",
        "submitted",
        "verifying",
        "approved",
        "paid",
        // Nobody took it and the campaign ended (admin completed it), or its deliverable was voided
        // as not delivered and can't be offered again. Not active, not open.
        "closed",
      ],
      default: "available",
    },
    claimedAt: {
      type: Date,
    },
    submissionUrl: {
      type: String,
    },
    verificationResult: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: null,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    completedAt: {
      type: Date,
    },
    // M8 batch 7: records the version of the campaign's usage rights the creator accepted (SPEC D30).
    usageRightsAccepted: {
      version: { type: Number, default: null },
      acceptedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Creator dashboard: "my slots" and active-slot counts.
slotSchema.index({ creatorId: 1, status: 1 });
// Marketplace: open slots per live campaign, newest first.
slotSchema.index({ campaignId: 1, status: 1, createdAt: -1 });
// Marketplace Trending (ticket 11): places taken in the last 72 hours. Only taken places are indexed.
slotSchema.index({ claimedAt: -1, campaignId: 1, creatorId: 1 }, { partialFilterExpression: { claimedAt: { $type: "date" } } });

// A creator holds at most one placement per campaign; a released placement has no creator.
slotSchema.index(
  { campaignId: 1, creatorId: 1 },
  { unique: true, partialFilterExpression: { creatorId: { $type: "objectId" } } }
);

module.exports = mongoose.model("Slot", slotSchema);
