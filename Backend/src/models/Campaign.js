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
    // Content campaigns pay per deliverable, so only performance campaigns need views.
    targetViews: {
      type: Number,
      required: [
        function () {
          // Update validators run against the query, not the document; edits keep what's stored.
          if (typeof this.getUpdate === "function") return false;
          return this.campaignModel !== "content";
        },
        "Target views is required",
      ],
      min: 1,
    },
    costPerView: {
      type: Number,
      default: 0,
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
    // The brand wizard step a draft was last saved on, so it reopens there.
    wizardStep: {
      type: Number,
      min: 1,
      max: 6,
    },
    // ── Campaign engine (ADR 0001): new fields beside the older ones below. ──
    campaignObjective: {
      type: String,
      enum: ["content", "views", "engagement", "downloads", "signups", "leads", "sales", "other"],
    },
    campaignModel: {
      type: String,
      enum: ["content", "performance"],
    },
    payShape: {
      type: String,
      enum: ["fixed", "performance", "hybrid"],
    },
    // Who sets what a creator earns per unit (ADR 0003).
    rateAuthority: {
      type: String,
      enum: ["brand", "admin", "platform"],
    },
    performanceMetric: {
      type: String,
      enum: ["views", "clicks", "downloads", "signups", "sales", "leads", "engagement", null],
      default: undefined,
    },
    // Content campaigns only: set by the brand.
    contentPay: {
      ratePerDeliverable: Number,
      deliverables: Number,
    },
    // Content campaigns: what the creator pool has promised and given back (ticket 09). Only
    // written by the atomic conditional updates in utils/fixedPay.js.
    fixedPay: {
      // One entry per submission whose fixed pay is credited; its length is deliverables paid.
      creditedSubmissions: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
      credited: { type: Number, default: undefined },
      // Capacity held by unused-budget refunds that are pending or succeeded, one entry per refund
      // row. The refund rows are the record; this is the lock credits check against.
      refundReservations: {
        type: [
          new mongoose.Schema(
            {
              refundId: { type: mongoose.Schema.Types.ObjectId, required: true },
              deliverables: { type: Number, required: true },
              creatorBudget: { type: Number, required: true },
              platformFee: { type: Number, required: true },
            },
            { _id: false }
          ),
        ],
        default: undefined,
      },
    },
    // Hybrid pay (ticket 10): a content campaign's performance bonus beside its base (contentPay).
    // The brand sets the metric, the pool and the per-creator cap (D4); the rate comes from the price
    // table (views) or admin's referral.rewardPerConversion (sign-ups, downloads), never the brand
    // (ADR 0003). The pool is paid at checkout into the "bonus" pot with the fee on top (D2). Runtime
    // fields are only written by the atomic conditional updates in utils/hybridBonus.js.
    hybridBonus: {
      type: new mongoose.Schema(
        {
          metric: { type: String, enum: ["views", "signups", "downloads"], required: true },
          pool: { type: Number, required: true, min: 0 },
          capPerCreator: { type: Number, required: true, min: 0 },
          platformFee: { type: Number, default: 0 },
          // Views: what a creator earns per 1,000 verified views, from the price table at setup.
          ratePerThousandViews: { type: Number, default: 0 },
          // Pool not yet promised to a creator or refunded.
          poolRemaining: { type: Number, default: 0 },
          // Promised to creators (credited bonus, less voided).
          reserved: { type: Number, default: 0 },
          // Given back to the brand by unused-bonus refunds.
          refundedPool: { type: Number, default: 0 },
          // What each creator has been promised, checked against the cap.
          creators: {
            type: [
              new mongoose.Schema(
                { creatorId: { type: mongoose.Schema.Types.ObjectId, required: true }, earned: { type: Number, default: 0 } },
                { _id: false }
              ),
            ],
            default: undefined,
          },
          // Reservations whose ledger row may not be written yet (a crash between the two); settled
          // by writing the row under the same reference and dropping the entry.
          pending: {
            type: [
              new mongoose.Schema(
                {
                  ref: { type: String, required: true },
                  creatorId: { type: mongoose.Schema.Types.ObjectId, required: true },
                  amount: { type: Number, required: true },
                  conversionId: { type: mongoose.Schema.Types.ObjectId, default: null },
                  at: { type: Date, required: true },
                },
                { _id: false }
              ),
            ],
            default: undefined,
          },
          // References of voided bonus credits already given back to the pool, so a repeat can't give
          // one back twice.
          returnedRefs: { type: [String], default: undefined },
          // One entry per unused-bonus refund: the pool it gave back and what the brand is refunded.
          refundClaims: {
            type: [
              new mongoose.Schema(
                { pool: { type: Number, required: true }, platformFee: { type: Number, required: true }, amount: { type: Number, required: true }, at: Date },
                { _id: false }
              ),
            ],
            default: undefined,
          },
        },
        { _id: false }
      ),
      default: undefined,
    },
    contentDestination: {
      type: String,
      enum: ["creator_page", "brand_page", "both"],
    },
    creatorAccess: {
      type: String,
      enum: ["open_call", "application_required"],
    },
    audienceTargeting: {
      locations: { type: [String], default: undefined },
      // Share of a creator's audience that must be in the locations above, combined.
      minLocationShare: Number,
      ageRanges: { type: [String], default: undefined },
      genders: { type: [String], default: undefined },
      interests: { type: [String], default: undefined },
      platforms: { type: [String], default: undefined },
    },
    creatorEligibility: {
      minFollowers: Number,
      minEngagementRate: Number,
      categories: { type: [String], default: undefined },
      verifiedOnly: Boolean,
      minRank: String,
      requiredBadges: { type: [String], default: undefined },
    },
    brief: {
      summary: String,
      dos: { type: [String], default: undefined },
      donts: { type: [String], default: undefined },
      hashtags: { type: [String], default: undefined },
      soundUrl: String,
      referenceVideos: { type: [String], default: undefined },
      tone: String,
      keyMessages: { type: [String], default: undefined },
      productInfo: String,
      approvalRequirements: String,
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
      // Back-pay in flight: each earlier conversion's reward is reserved from the pool together with
      // an entry here, so a retry after a crash finds the reservation instead of reserving twice.
      // Entries are removed once the conversion records its reward.
      payingConversions: {
        type: [
          {
            _id: false,
            conversionId: { type: mongoose.Schema.Types.ObjectId, required: true },
            attemptId: { type: mongoose.Schema.Types.ObjectId, required: true },
          },
        ],
        default: undefined,
      },
    },
    completedAt: {
      type: Date,
      default: null,
    },
    // Automatic unused-budget refunds (ticket 11): what went wrong on the last run, until a run succeeds.
    // Raised as the auto_refund_failed ops alert.
    autoRefund: {
      type: new mongoose.Schema({ error: String, failedAt: Date }, { _id: false }),
      default: undefined,
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
  if (this.campaignModel !== "content" && this.isModified("targetViews") && !this._skipPriceRecalculation) {
    const { getPriceForViews } = require("../config/pricing");
    this.budget = getPriceForViews(this.targetViews);
    this.costPerView = Math.round((this.budget / this.targetViews) * 1000) / 1000;
  }
  // Content campaigns add the fee on top of the creator budget (D2); their route sets all three.
  if (this.campaignModel !== "content" && (this.isModified("budget") || this.isModified("platformFeePercent"))) {
    this.platformFee = this.budget * (this.platformFeePercent / 100);
    this.creatorPool = this.budget - this.platformFee;
  }
  next();
});

module.exports = mongoose.model("Campaign", campaignSchema);
