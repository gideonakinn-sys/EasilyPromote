const mongoose = require("mongoose");

const referralCodeSchema = new mongoose.Schema(
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
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Slot",
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 64,
    },
    source: {
      type: String,
      enum: ["easilypromote", "business"],
      default: "easilypromote",
    },
    // awaiting_business: issued by us, not yet confirmed loaded into the brand's app.
    status: {
      type: String,
      enum: ["awaiting_business", "active", "disabled"],
      default: "awaiting_business",
    },
    conversions: {
      type: Number,
      default: 0,
    },
    loadedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Webhook lookup: codes only need to be unique within one business.
referralCodeSchema.index({ businessId: 1, code: 1 }, { unique: true });
referralCodeSchema.index({ campaignId: 1 });
referralCodeSchema.index({ creatorId: 1 });
referralCodeSchema.index({ slotId: 1 });

module.exports = mongoose.model("ReferralCode", referralCodeSchema);
