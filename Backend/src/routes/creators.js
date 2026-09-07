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

router.post("/profile/socials", protect, async (req, res, next) => {
  try {
    const { platform, handle } = req.body;

    if (!platform || !handle) {
      return res.status(400).json({ error: "Platform and handle are required" });
    }

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
    } else {
      profile.socialAccounts.push({
        platform: platform.toLowerCase(),
        handle,
        verified: false,
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

router.put("/profile/me", protect, async (req, res, next) => {
  try {
    const { displayName, bio, country, avatar } = req.body;

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    if (displayName !== undefined) profile.displayName = displayName;
    if (bio !== undefined) profile.bio = bio;
    if (country !== undefined) profile.country = country;

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
      avatar: avatar !== undefined ? avatar : undefined,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const creators = await CreatorProfile.find().populate("userId", "name email");
    res.json(creators);
  } catch (error) {
    next(error);
  }
});

router.get("/leaderboard", async (req, res, next) => {
  try {
    const leaderboard = await CreatorProfile.find()
      .sort({ creatorScore: -1 })
      .limit(50)
      .populate("userId", "name");
    res.json(leaderboard);
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
router.post("/withdrawals", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { campaignId, amount } = req.body || {};
    if (!campaignId || !amount) {
      return res.status(400).json({ error: "campaignId and amount are required" });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile || !(profile.payoutAccount && profile.payoutAccount.paystackRecipientCode)) {
      return res.status(400).json({ error: "Add your bank account first" });
    }

    const slot = await Slot.findOne({ campaignId, creatorId: req.user._id }).populate({
      path: "campaignId",
      select: "name status targetViews costPerView viewsDelivered creatorPool businessId",
    });
    if (!slot || !slot.campaignId) {
      return res.status(404).json({ error: "Campaign not found for this creator" });
    }
    const campaign = slot.campaignId;

    if (!["completed", "live", "paused"].includes(campaign.status)) {
      return res.status(400).json({ error: "This campaign is not eligible for withdrawal yet" });
    }

    const submission = await Submission.findOne({ campaignId, creatorId: req.user._id });
    const views = submission ? submission.viewsDelivered || 0 : 0;

    // Cap against this creator's own slot, not the whole creator pool — otherwise
    // one high-performing creator can claim money owed to everyone else.
    const slotCeiling = slot.reward || 0;
    const earned = Math.min(views * (campaign.costPerView || 0), slotCeiling);

    // Anything already requested or paid for this campaign is spent entitlement.
    // Rejected requests are excluded: that money never left.
    const priorWithdrawals = await Withdrawal.find({
      campaignId,
      creatorId: req.user._id,
      status: { $in: ["pending", "processing", "released"] },
    });
    const alreadyClaimed = priorWithdrawals.reduce((sum, w) => sum + (w.amount || 0), 0);
    const available = Math.max(earned - alreadyClaimed, 0);

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }
    if (available <= 0) {
      return res.status(400).json({
        error: alreadyClaimed > 0
          ? `You've already withdrawn everything earned so far on this campaign (₦${alreadyClaimed.toLocaleString()}).`
          : "You haven't earned anything on this campaign yet.",
      });
    }
    if (amount > available) {
      return res.status(400).json({
        error: `You can only withdraw up to ₦${available.toLocaleString()} for this campaign`,
      });
    }

    const existing = await Withdrawal.findOne({
      campaignId,
      creatorId: req.user._id,
      status: { $in: ["pending", "processing"] },
    });
    if (existing) {
      return res.status(409).json({ error: "You already have a withdrawal being processed for this campaign" });
    }

    const withdrawal = await Withdrawal.create({
      creatorId: req.user._id,
      campaignId,
      businessId: campaign.businessId,
      submissionId: submission ? submission._id : null,
      amount,
      status: "pending",
      requestedAt: new Date(),
    });

    res.status(201).json({
      id: withdrawal._id,
      amount: withdrawal.amount,
      status: withdrawal.status,
      message: "Withdrawal request received. It is under review — we'll get back to you within 24 hours.",
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

    res.json({
      withdrawals: withdrawals.map((w) => ({
        id: w._id,
        campaignId: w.campaignId,
        campaignName: w.campaignId ? w.campaignId.name : "Campaign",
        amount: w.amount,
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
    const creator = await CreatorProfile.findById(req.params.id).populate(
      "userId",
      "name email"
    );
    if (!creator) {
      return res.status(404).json({ error: "Creator profile not found" });
    }
    res.json(creator);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
