const express = require("express");
const { z } = require("zod");
const CreatorProfile = require("../models/CreatorProfile");
const User = require("../models/User");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Niche = require("../models/Niche");
const Withdrawal = require("../models/Withdrawal");
const paystack = require("../services/paystack");
const {
  loadContext,
  buildProfile,
  buildMarketplace,
  buildMyCampaigns,
  buildWallet,
  buildDashboard,
} = require("../services/creatorDashboard");
const { protect, authorizeRoles } = require("../middleware/auth");
const {
  audienceSchema,
  categoriesSchema,
  portfolioSchema,
  ownAudience,
  publicPortfolio,
  brandSafeProfile,
} = require("../utils/creatorProfile");

const router = express.Router();

router.get("/profile/me", protect, async (req, res, next) => {
  try {
    const ctx = await loadContext(req.user._id);
    const profile = buildProfile(req.user, ctx);
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// Everything the creator dashboard needs in one round trip: profile, claimed
// campaigns, marketplace, wallet and social connection state.
router.get("/dashboard", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const dashboard = await buildDashboard(req.user);
    if (!dashboard) {
      return res.status(404).json({ error: "Creator profile not found" });
    }
    res.json(dashboard);
  } catch (error) {
    next(error);
  }
});

const socialAccountSchema = z.object({
  platform: z.string({ required_error: "Platform and handle are required" }).trim().min(1, "Platform and handle are required"),
  handle: z.string({ required_error: "Platform and handle are required" }).trim().min(1, "Platform and handle are required"),
  // Self-reported; null clears it.
  followers: z.number().int("Followers must be a whole number").min(0).nullable().optional(),
});

router.post("/profile/socials", protect, async (req, res, next) => {
  try {
    const parsed = socialAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { platform, handle, followers } = parsed.data;

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    const existing = profile.socialAccounts.find(
      (s) => s.platform === platform.toLowerCase()
    );
    if (existing) {
      existing.handle = handle;
      existing.verified = false;
      if (followers !== undefined) existing.followers = followers === null ? undefined : followers;
    } else {
      profile.socialAccounts.push({
        platform: platform.toLowerCase(),
        handle,
        verified: false,
        followers: followers === null ? undefined : followers,
      });
    }

    await profile.save();

    res.json({
      socialAccounts: profile.socialAccounts,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/profile/niches", protect, async (req, res, next) => {
  try {
    const { niches } = req.body;

    if (!Array.isArray(niches)) {
      return res.status(400).json({ error: "Niches must be an array" });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    profile.niches = niches;
    await profile.save();

    // Upsert any user-added niches into the global niche list so they become
    // available to all creators.
    const uniqueNames = [...new Set(niches.map((n) => String(n).trim()).filter(Boolean))];
    if (uniqueNames.length > 0) {
      const existing = await Niche.find({
        name: { $in: uniqueNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) },
      });
      const existingLower = new Set(existing.map((e) => e.name.toLowerCase()));
      const missing = uniqueNames.filter((n) => !existingLower.has(n.toLowerCase()));
      if (missing.length > 0) {
        await Niche.insertMany(missing.map((name) => ({ name, enabled: true, sortOrder: 0 })));
      }
    }

    res.json({
      niches: profile.niches,
    });
  } catch (error) {
    next(error);
  }
});

const basicsSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  bio: z.string().max(300).optional(),
  country: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(60).optional(),
  legalName: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(30).optional(),
  avatar: z.string().optional(),
  categories: categoriesSchema.optional(),
});

router.put("/profile/me", protect, async (req, res, next) => {
  try {
    const parsed = basicsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { displayName, bio, country, city, state, legalName, phone, avatar, categories } = parsed.data;

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    if (displayName !== undefined) profile.displayName = displayName;
    if (bio !== undefined) profile.bio = bio;
    if (country !== undefined) profile.country = country;
    if (city !== undefined) profile.city = city;
    if (state !== undefined) profile.state = state;
    if (legalName !== undefined) profile.legalName = legalName;
    if (phone !== undefined) profile.phone = phone;
    if (categories !== undefined) profile.categories = categories;

    await profile.save();

    const userUpdates = {};
    if (displayName !== undefined) userUpdates.name = displayName;
    if (avatar !== undefined) userUpdates.avatar = avatar;
    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(req.user._id, userUpdates);
    }

    res.json({
      displayName: profile.displayName,
      bio: profile.bio,
      country: profile.country,
      city: profile.city || "",
      state: profile.state || "",
      legalName: profile.legalName || "",
      phone: profile.phone || "",
      categories: profile.categories || [],
      avatar: avatar !== undefined ? avatar : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// Replaces the creator's audience breakdown. Each part sent overwrites that part only.
router.put("/profile/audience", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const parsed = audienceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    const { locations, ages, genders, proofUrl } = parsed.data;
    // Self-reported numbers need a screenshot of the creator's analytics (D7).
    if (!proofUrl && !(profile.audience && profile.audience.proofUrl)) {
      return res.status(400).json({ error: "Add a screenshot of your analytics as proof" });
    }
    if (locations !== undefined) profile.set("audience.locations", locations);
    if (ages !== undefined) profile.set("audience.ages", ages);
    if (genders !== undefined) profile.set("audience.genders", genders);
    if (proofUrl !== undefined) profile.set("audience.proofUrl", proofUrl);
    profile.set("audience.source", "self_reported");
    profile.set("audience.updatedAt", new Date());
    await profile.save();

    res.json({ audience: ownAudience(profile.audience) });
  } catch (error) {
    next(error);
  }
});

// Replaces the whole portfolio, so one call adds, removes or reorders items.
router.put("/profile/portfolio", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const parsed = portfolioSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    profile.portfolio = parsed.data.items;
    await profile.save();

    res.json({ portfolio: publicPortfolio(profile.portfolio) });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const creators = await CreatorProfile.find().populate("userId", "name avatar");
    res.json(creators.map((c) => brandSafeProfile(c, c.userId)));
  } catch (error) {
    next(error);
  }
});

router.get("/leaderboard", async (req, res, next) => {
  try {
    const leaderboard = await CreatorProfile.find()
      .sort({ creatorScore: -1 })
      .limit(50)
      .populate("userId", "name avatar");
    res.json(leaderboard.map((c) => brandSafeProfile(c, c.userId)));
  } catch (error) {
    next(error);
  }
});

router.get("/marketplace", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const ctx = await loadContext(req.user._id);
    res.json(await buildMarketplace(ctx));
  } catch (error) {
    next(error);
  }
});

router.get("/slots/mine", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const ctx = await loadContext(req.user._id);
    res.json(await buildMyCampaigns(ctx));
  } catch (error) {
    next(error);
  }
});

router.get("/wallet", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const ctx = await loadContext(req.user._id);
    res.json(await buildWallet(req.user, ctx));
  } catch (error) {
    next(error);
  }
});

// ─── GET /creators/banks ─────────────────────────────────────────────────────
router.get("/banks", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const banks = await paystack.listBanks();
    const seen = new Set();
    const nigerian = banks
      .filter((b) => {
        if (b.country && b.country.toLowerCase() !== "nigeria") return false;
        if (b.active === false) return false;
        const code = b.code;
        if (seen.has(code)) return false;
        seen.add(code);
        return true;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    res.json({
      banks: nigerian.map((b) => ({
        name: b.name,
        code: b.code,
        slug: b.slug || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /creators/bank-account ──────────────────────────────────────────────
router.get("/bank-account", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    const acc = profile && profile.payoutAccount;
    res.json({
      hasBankAccount: !!(acc && acc.paystackRecipientCode && acc.accountNumber),
      accountName: acc ? acc.accountName : null,
      bankName: acc ? acc.bankName : null,
      maskedAccountNumber: acc && acc.accountNumber ? `****${acc.accountNumber.slice(-4)}` : null,
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /creators/bank-account ─────────────────────────────────────────────
router.post("/bank-account", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { accountNumber, bankCode, bankName, accountName } = req.body || {};
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ error: "Account number and bank code are required" });
    }
    if (!/^\d{10}$/.test(String(accountNumber))) {
      return res.status(400).json({ error: "Account number must be 10 digits" });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    let recipientCode = null;
    let resolvedName = accountName || null;
    let resolvedBankName = bankName || null;
    try {
      const recipient = await paystack.createRecipient({
        name: resolvedName || req.user.name || "Creator",
        account_number: String(accountNumber),
        bank_code: String(bankCode),
      });
      recipientCode = recipient.recipient_code || null;
      resolvedName = (recipient.details && recipient.details.account_name) || resolvedName;
      resolvedBankName = (recipient.details && recipient.details.bank_name) || resolvedBankName;
    } catch (err) {
      console.error("[Bank Account] Paystack recipient creation failed:", err.message);
      return res.status(422).json({ error: "Could not validate this bank account. Check the details and try again." });
    }

    profile.payoutAccount = {
      accountName: resolvedName || req.user.name,
      accountNumber: String(accountNumber),
      bankCode: String(bankCode),
      bankName: resolvedBankName,
      paystackRecipientCode: recipientCode,
    };
    await profile.save();

    res.json({
      hasBankAccount: true,
      accountName: profile.payoutAccount.accountName,
      bankName: profile.payoutAccount.bankName,
      maskedAccountNumber: `****${String(accountNumber).slice(-4)}`,
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /creators/bank-account ───────────────────────────────────────────
router.delete("/bank-account", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }
    profile.payoutAccount = undefined;
    await profile.save();
    res.json({ success: true, hasBankAccount: false });
  } catch (error) {
    next(error);
  }
});

// ─── POST /creators/withdrawals ──────────────────────────────────────────────
// Creators withdraw once a week per campaign: views earnings and referral earnings past
// their hold go out together, and are paid on the Friday that ends the payout week.
router.post("/withdrawals", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { MIN_CAMPAIGN_WITHDRAWAL, payoutWeekStart, nextPayoutDate, formatPayoutDate } = require("../utils/payoutSchedule");
    const { creatorViewsEarnings, floorKobo } = require("../utils/earnings");
    const { creatorReferralEarnings } = require("../utils/referralEarnings");

    const { campaignId } = req.body || {};
    // Older clients still send a kind and amount; they withdraw only that part.
    const onlyKind = req.body && ["views", "referral"].includes(req.body.kind) ? req.body.kind : null;
    const requestedAmount = onlyKind && req.body.amount !== undefined ? Number(req.body.amount) : null;
    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }
    if (requestedAmount !== null && !(requestedAmount > 0)) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile || !(profile.payoutAccount && profile.payoutAccount.paystackRecipientCode)) {
      return res.status(400).json({ error: "Add your bank account first" });
    }

    const slot = await Slot.findOne({ campaignId, creatorId: req.user._id }).populate({
      path: "campaignId",
      select: "name status businessId",
    });
    if (!slot || !slot.campaignId) {
      return res.status(404).json({ error: "Campaign not found for this creator" });
    }
    const campaign = slot.campaignId;

    // Referral earnings stay owed after a cancellation, so they remain withdrawable.
    const viewsEligible = ["completed", "live", "paused"].includes(campaign.status);
    const referralEligible = viewsEligible || campaign.status === "cancelled";
    if (!referralEligible) {
      return res.status(400).json({ error: "This campaign is not eligible for withdrawal yet" });
    }

    const now = new Date();
    const payoutDate = nextPayoutDate(now);
    // Checked before balances: with a request in flight, "nothing left" would mislead.
    const [inFlight, thisWeek] = await Promise.all([
      Withdrawal.findOne({ campaignId, creatorId: req.user._id, status: { $in: ["pending", "processing"] } }),
      Withdrawal.findOne({
        campaignId,
        creatorId: req.user._id,
        status: { $ne: "rejected" },
        requestedAt: { $gte: payoutWeekStart(now) },
      }),
    ]);
    if (inFlight) {
      return res.status(409).json({ error: "You already have a withdrawal being processed for this campaign" });
    }
    if (thisWeek) {
      return res.status(409).json({
        error: `You've already withdrawn from this campaign this week. You can withdraw again from ${formatPayoutDate(payoutDate)}.`,
      });
    }

    const key = String(campaign._id);
    const [viewsMap, referralMap] = await Promise.all([
      creatorViewsEarnings(req.user._id, { campaignIds: [campaign._id] }),
      creatorReferralEarnings(req.user._id, { campaignIds: [campaign._id] }),
    ]);
    const views = viewsMap.get(key);
    const referral = referralMap.get(key);

    let viewsAmount = viewsEligible && onlyKind !== "referral" && views ? views.availableToWithdraw : 0;
    let referralAmount = onlyKind !== "views" && referral ? referral.availableToWithdraw : 0;
    if (requestedAmount !== null) {
      const cap = onlyKind === "referral" ? referralAmount : viewsAmount;
      if (requestedAmount > cap) {
        return res.status(400).json({
          error: `You can only withdraw up to ₦${cap.toLocaleString()} ${onlyKind === "referral" ? "of referral earnings " : ""}for this campaign`,
        });
      }
      if (onlyKind === "referral") referralAmount = floorKobo(requestedAmount);
      else viewsAmount = floorKobo(requestedAmount);
    }

    const amount = floorKobo(viewsAmount + referralAmount);
    if (amount <= 0) {
      const onHold = referral ? referral.pending : 0;
      const withdrawn = (views ? views.withdrawn : 0) + (referral ? referral.withdrawn : 0);
      return res.status(400).json({
        error:
          onHold > 0
            ? `₦${onHold.toLocaleString()} of your referral earnings on this campaign is still in the 7-day hold.`
            : withdrawn > 0
              ? "You've already withdrawn everything earned so far on this campaign."
              : "You haven't earned anything on this campaign yet.",
      });
    }
    if (amount < MIN_CAMPAIGN_WITHDRAWAL) {
      return res.status(400).json({
        error: `You need at least ₦${MIN_CAMPAIGN_WITHDRAWAL.toLocaleString()} to withdraw from a campaign. You have ₦${amount.toLocaleString()}, which carries over until you reach it.`,
        code: "BELOW_MINIMUM",
      });
    }

    const submission = await Submission.findOne({ campaignId, creatorId: req.user._id }).sort({ createdAt: -1 });

    let withdrawal;
    try {
      withdrawal = await Withdrawal.create({
        creatorId: req.user._id,
        campaignId,
        businessId: campaign.businessId,
        submissionId: submission ? submission._id : null,
        kind: "campaign",
        amount,
        viewsAmount: floorKobo(viewsAmount),
        referralAmount: floorKobo(referralAmount),
        status: "pending",
        requestedAt: now,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: "You already have a withdrawal being processed for this campaign" });
      }
      throw err;
    }

    res.status(201).json({
      id: withdrawal._id,
      kind: withdrawal.kind,
      amount: withdrawal.amount,
      viewsAmount: withdrawal.viewsAmount,
      referralAmount: withdrawal.referralAmount,
      status: withdrawal.status,
      payoutDate,
      message: `Withdrawal requested. It's paid on ${formatPayoutDate(payoutDate)}.`,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /creators/withdrawals ───────────────────────────────────────────────
router.get("/withdrawals", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.find({ creatorId: req.user._id })
      .sort({ createdAt: -1 })
      .populate("campaignId", "name targetViews");

    const { nextPayoutDate } = require("../utils/payoutSchedule");
    res.json({
      withdrawals: withdrawals.map((w) => ({
        id: w._id,
        campaignId: w.campaignId,
        campaignName: w.campaignId ? w.campaignId.name : "Campaign",
        kind: w.kind || "views",
        amount: w.amount,
        viewsAmount: w.kind === "campaign" ? w.viewsAmount : w.kind === "referral" ? 0 : w.amount,
        referralAmount: w.kind === "campaign" ? w.referralAmount : w.kind === "referral" ? w.amount : 0,
        // Requests are paid on the Friday that ends the week they were made in.
        payoutDate: ["pending", "processing"].includes(w.status) ? nextPayoutDate(w.requestedAt) : null,
        status: w.status,
        adminNotes: w.adminNotes,
        requestedAt: w.requestedAt,
        reviewedAt: w.reviewedAt,
        releasedAt: w.releasedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const creator = await CreatorProfile.findById(req.params.id).populate("userId", "name avatar");
    if (!creator) {
      return res.status(404).json({ error: "Creator profile not found" });
    }
    res.json(brandSafeProfile(creator, creator.userId));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
