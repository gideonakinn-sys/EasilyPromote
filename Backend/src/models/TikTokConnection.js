const mongoose = require("mongoose");

const tiktokConnectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    openId: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    avatarUrl: {
      type: String,
    },
    accessTokenEnc: {
      type: String,
      select: false,
    },
    refreshTokenEnc: {
      type: String,
      select: false,
    },
    tokenType: {
      type: String,
      default: "Bearer",
    },
    expiresAt: {
      type: Date,
    },
    refreshExpiresAt: {
      type: Date,
    },
    scopes: {
      type: [String],
      default: [],
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TikTokConnection", tiktokConnectionSchema);
