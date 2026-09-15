const mongoose = require("mongoose");

const businessProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
    },
    industry: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    logo: {
      type: String,
      default: null,
    },
    cac: {
      type: String,
      default: null,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    website: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      maxlength: 500,
    },
    // Set when the first validly signed request arrives from the brand's own server.
    referralConnectedAt: {
      type: Date,
      default: null,
    },
    // Proof the brand's app is wired up: a signed code check and a signed conversion
    // (test or real) from their server. Our dashboard's test sender never counts.
    // Verification is per brand and unlocks paying for referral campaigns.
    referralVerification: {
      codeCheckAt: { type: Date, default: null },
      conversionAt: { type: Date, default: null },
      verifiedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BusinessProfile", businessProfileSchema);
