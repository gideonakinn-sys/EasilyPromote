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
    // Set when the provider refuses the token for good (revoked, password changed, expired past
    // refresh). The sync jobs skip the connection until the creator connects again, which clears it.
    needsReconnect: {
      type: Boolean,
    },
    needsReconnectAt: {
      type: Date,
    },
    needsReconnectReason: {
      type: String,
    },
    lastSyncedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TikTokConnection", tiktokConnectionSchema);
