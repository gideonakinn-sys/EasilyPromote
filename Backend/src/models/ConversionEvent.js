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
    // Whether this event matched the campaign's conversion type when it arrived.
    // null = recorded before this was stored; readers fall back to the campaign's type.
    counted: {
      type: Boolean,
      default: null,
    },
    // What the creator earned for this conversion, fixed when it was recorded.
    rewardAmount: {
      type: Number,
      default: 0,
    },
    // Why a counted conversion earned nothing.
    unpaidReason: {
      type: String,
      enum: ["not_counted", "rate_not_set", "budget_exhausted", null],
      default: null,
    },
    // Earnings are held until this date so fake or reversed conversions can be voided.
    availableAt: {
      type: Date,
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidedReason: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Idempotency: a business re-sending the same event_id is never counted twice.
conversionEventSchema.index({ businessId: 1, eventId: 1 }, { unique: true });
conversionEventSchema.index({ campaignId: 1, occurredAt: -1 });
conversionEventSchema.index({ creatorId: 1, occurredAt: -1 });
// Creator earnings: paid, non-voided conversions per campaign.
conversionEventSchema.index({ creatorId: 1, campaignId: 1, rewardAmount: 1 });

module.exports = mongoose.model("ConversionEvent", conversionEventSchema);
