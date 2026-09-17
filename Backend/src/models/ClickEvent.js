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
    // 24-hour window number (ms since epoch / 24h): one paid click per visitor per link per window.
    windowStart: {
      type: Number,
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

// The idempotency guard: a second click in the same window fails this insert and isn't paid.
clickEventSchema.index({ code: 1, visitorHash: 1, windowStart: 1 }, { unique: true });

module.exports = mongoose.model("ClickEvent", clickEventSchema);
