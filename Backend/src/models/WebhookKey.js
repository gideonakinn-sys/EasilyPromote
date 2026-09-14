const mongoose = require("mongoose");

// Per-business signing key for the conversions webhook. The secret is stored
// encrypted (not hashed) because verifying an HMAC needs the plaintext.
const webhookKeySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    keyId: {
      type: String,
      required: true,
      unique: true,
    },
    secretEncrypted: {
      type: String,
      required: true,
    },
    last4: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expiring", "revoked"],
      default: "active",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

webhookKeySchema.index({ businessId: 1, status: 1 });

// A key signs requests while active, or while expiring inside its grace window.
webhookKeySchema.methods.isUsable = function (now = new Date()) {
  if (this.status === "active") return true;
  if (this.status === "expiring") return Boolean(this.expiresAt && this.expiresAt > now);
  return false;
};

module.exports = mongoose.model("WebhookKey", webhookKeySchema);
