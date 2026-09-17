const mongoose = require("mongoose");

// A Paystack webhook we couldn't process (the handler threw). Paystack retries failed deliveries,
// so one failure is often harmless; several in an hour raise an ops alert. Kept 30 days.
const paystackWebhookFailureSchema = new mongoose.Schema(
  {
    event: { type: String, default: null },
    reference: { type: String, default: null },
    error: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

paystackWebhookFailureSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("PaystackWebhookFailure", paystackWebhookFailureSchema);
