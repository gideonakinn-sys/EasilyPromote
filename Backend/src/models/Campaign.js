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
    statusNote: {
      type: String,
      trim: true,
      default: null,
    },
    slotCount: {
      type: Number,
      default: 5,
      min: 1,
    },
    // What the brand wants: views only, or people taking an action in their app, which
    // adds referral tracking funded by a referral budget.
    objective: {
      type: String,
      enum: ["views", "actions"],
      default: "views",
    },
    // Total the current checkout charges: views price plus the referral budget.
    paymentAmount: {
      type: Number,
      default: 0,
    },
    // Referral tracking runs alongside the views campaign.
    referral: {
      enabled: {
        type: Boolean,
        default: false,
      },
      eventType: {
        type: String,
        enum: ["install", "signup", "purchase", "deposit", "custom"],
        default: "signup",
      },
      // Every conversion type that counts; eventType mirrors the first one for older readers.
      eventTypes: {
        type: [{ type: String, enum: ["install", "signup", "purchase", "deposit", "custom"] }],
        default: undefined,
      },
      codeSource: {
        type: String,
        enum: ["easilypromote", "business"],
        default: "easilypromote",
      },
      // Referral budget the brand entered in the wizard, paid with the views price at checkout.
      requestedBudget: {
        type: Number,
        default: 0,
        min: 0,
      },
      conversions: {
        type: Number,
        default: 0,
      },
      // What a creator earns per counted conversion, set by the brand. Each conversion
      // stores the amount it was paid, so changing this only affects new conversions.
      rewardPerConversion: {
        type: Number,
        default: 0,
        min: 0,
      },
      // Referral budget, funded separately from the views budget.
      // budget = total paid in; platformFee = our share; pool = budget - platformFee.
      budget: {
        type: Number,
        default: 0,
      },
      platformFee: {
        type: Number,
        default: 0,
      },
      pool: {
        type: Number,
        default: 0,
      },
      // Pool not yet promised to a creator. Rewards are reserved from it atomically.
      poolRemaining: {
        type: Number,
        default: 0,
      },
      // Total promised to creators (reserved rewards, minus voided ones).
      earned: {
        type: Number,
        default: 0,
      },
      // Set the first time a conversion couldn't be paid, so the brand is told once.
      budgetExhaustedAt: {
        type: Date,
        default: null,
      },
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Brand dashboard: a brand's campaigns, newest first (plus its draft count).
campaignSchema.index({ businessId: 1, status: 1, createdAt: -1 });
// Marketplace and background syncs: every campaign in a given status.
campaignSchema.index({ status: 1, createdAt: -1 });

campaignSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "completed" && !this.completedAt) {
    this.completedAt = new Date();
  }
  if (this.isModified("targetViews") && !this._skipPriceRecalculation) {
    const { getPriceForViews } = require("../config/pricing");
    this.budget = getPriceForViews(this.targetViews);
    this.costPerView = Math.round((this.budget / this.targetViews) * 1000) / 1000;
  }
  if (this.isModified("budget") || this.isModified("platformFeePercent")) {
    this.platformFee = this.budget * (this.platformFeePercent / 100);
    this.creatorPool = this.budget - this.platformFee;
  }
  next();
});

module.exports = mongoose.model("Campaign", campaignSchema);
