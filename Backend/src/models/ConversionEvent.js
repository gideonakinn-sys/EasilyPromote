const mongoose = require("mongoose");

// One conversion reported by a business. Deliberately carries no PII.
const conversionEventSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    referralCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCode",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    eventId: {
      type: String,
      required: true,
      maxlength: 128,
    },
    eventType: {
      type: String,
      enum: ["install", "signup", "purchase", "deposit", "custom"],
      required: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    isTest: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Idempotency: a business re-sending the same event_id is never counted twice.
conversionEventSchema.index({ businessId: 1, eventId: 1 }, { unique: true });
conversionEventSchema.index({ campaignId: 1, occurredAt: -1 });
conversionEventSchema.index({ creatorId: 1, occurredAt: -1 });

module.exports = mongoose.model("ConversionEvent", conversionEventSchema);
