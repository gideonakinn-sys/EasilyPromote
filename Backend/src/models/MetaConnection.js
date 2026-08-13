const mongoose = require("mongoose");

// A Facebook Page (and its optionally-linked Instagram business account) that the
// user granted access to during Facebook Login. Only used by the "facebook" provider.
const pageSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    name: { type: String, trim: true },
    accessTokenEnc: { type: String, select: false }, // long-lived Page access token
    igBusinessId: { type: String }, // linked IG business account id, if any
  },
  { _id: false }
);

const metaConnectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Which Meta login was used. "instagram" = Instagram API with Instagram Login
    // (direct professional-account login). "facebook" = Facebook Login + Graph API.
    provider: {
      type: String,
      enum: ["instagram", "facebook"],
      required: true,
    },
    // IG user_id (instagram) or app-scoped Facebook user id (facebook).
    providerUserId: {
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
    // Long-lived user token (IG long-lived token for instagram; long-lived user
    // access token for facebook). Encrypted at rest.
    accessTokenEnc: {
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
    scopes: {
      type: [String],
      default: [],
    },
    // Facebook only: pages the user manages (with per-page tokens used for insights).
    pages: {
      type: [pageSchema],
      default: undefined,
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

// One connection per provider per user.
metaConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model("MetaConnection", metaConnectionSchema);
