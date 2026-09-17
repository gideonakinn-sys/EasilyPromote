const mongoose = require("mongoose");

// Tracks public clicks through creators' referral redirect links (/r/:code).
// Used for deduplication (24h window) and rate limiting. Retained for 30 days via TTL index.
const clickEventSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    visitorHash: {
      type: String,
      required: true,
    },
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
    createdAt: {
      type: Date,
      default: Date.now,
      expires: "30d",
    },
  },
  { timestamps: false }
);

// Deduplication within 24h per code and visitor hash.
clickEventSchema.index({ code: 1, visitorHash: 1, createdAt: -1 });

module.exports = mongoose.model("ClickEvent", clickEventSchema);
