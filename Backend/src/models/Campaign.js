const mongoose = require("mongoose");

const campaignSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    coverImageUrl: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      required: [true, "Campaign name is required"],
      trim: true,
      maxlength: 200,
    },
    category: {
      type: String,
      trim: true,
    },
    contentBrief: {
      type: String,
      maxlength: 2000,
    },
    keyMessageCta: {
      type: String,
      maxlength: 500,
    },
    whatToAvoid: {
      type: String,
      maxlength: 500,
    },
    goal: {
      type: String,
      maxlength: 1000,
    },
    competitors: {
      type: String,
      maxlength: 500,
    },
    uniqueSellingPoint: {
      type: String,
      maxlength: 1000,
    },
    funFact: {
      type: String,
      maxlength: 500,
    },
    scriptUrl: {
      type: String,
      default: null,
    },
    scriptFileName: {
      type: String,
      default: null,
    },
    paymentReference: {
      type: String,
      default: null,
    },
    platforms: {
      type: [String],
      default: [],
    },
    contentStyle: {
      type: [String],
      default: [],
    },
    niches: {
      type: [String],
      default: [],
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    targetViews: {
      type: Number,
      required: [true, "Target views is required"],
      min: 1,
    },
    costPerView: {
      type: Number,
      required: true,
      min: 0,
    },
    budget: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFeePercent: {
      type: Number,
      default: 30,
    },
    platformFee: {
      type: Number,
      default: 0,
    },
    creatorPool: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "pending_payment",
        "under_review",
        "live",
        "paused",
        "completed",
        "cancelled",
      ],
      default: "draft",
    },
    viewsDelivered: {
      type: Number,
      default: 0,
    },
    slotCount: {
      type: Number,
      default: 5,
      min: 1,
    },
  },
  { timestamps: true }
);

campaignSchema.pre("save", function (next) {
  if (this.isModified("targetViews") || this.isModified("costPerView")) {
    this.budget = this.targetViews * this.costPerView;
  }
  if (this.isModified("budget") || this.isModified("platformFeePercent")) {
    this.platformFee = this.budget * (this.platformFeePercent / 100);
    this.creatorPool = this.budget - this.platformFee;
  }
  next();
});

module.exports = mongoose.model("Campaign", campaignSchema);
