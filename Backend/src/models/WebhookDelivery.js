const mongoose = require("mongoose");

// One conversion webhook request as the brand's developers would want to debug it:
// what arrived, what we answered and why. Kept 30 days. No PII — only the fields
// the webhook itself carries.
const webhookDeliverySchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    keyId: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ["webhook", "code_check", "dashboard_test"],
      default: "webhook",
    },
    statusCode: {
      type: Number,
      required: true,
    },
    // recorded | ignored | test_ok | valid | invalid | rejected
    result: {
      type: String,
      required: true,
    },
    error: {
      type: String,
      default: null,
    },
    eventId: {
      type: String,
      default: null,
    },
    code: {
      type: String,
      default: null,
    },
    eventType: {
      type: String,
      default: null,
    },
    isTest: {
      type: Boolean,
      default: false,
    },
    counted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

webhookDeliverySchema.index({ businessId: 1, createdAt: -1 });
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("WebhookDelivery", webhookDeliverySchema);
