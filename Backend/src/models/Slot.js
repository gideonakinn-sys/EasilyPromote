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
      min: 1,
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
  },
  { timestamps: true }
);

// Creator dashboard: "my slots" and active-slot counts.
slotSchema.index({ creatorId: 1, status: 1 });
// Marketplace: open slots per live campaign, newest first.
slotSchema.index({ campaignId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Slot", slotSchema);
