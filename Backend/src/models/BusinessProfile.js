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
    // Set when the first validly signed conversion webhook (test or real) arrives.
    referralConnectedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BusinessProfile", businessProfileSchema);
