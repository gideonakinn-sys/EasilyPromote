const express = require("express");
const { z } = require("zod");
const CreatorProfile = require("../models/CreatorProfile");
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Niche = require("../models/Niche");
const Withdrawal = require("../models/Withdrawal");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const paystack = require("../services/paystack");
const { protect, authorizeRoles } = require("../middleware/auth");

const router = express.Router();

function timeAgo(date) {
  if (!date) return undefined;
  const diffMs = Date.now() - new Date(date).getTime();
  if (diffMs < 60 * 1000) return "just now";
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

async function getCampaignAccess(userId) {
  const profile = await CreatorProfile.findOne({ userId });
  const niches = Array.isArray(profile && profile.niches) ? profile.niches : [];
  const hasTikTok = await TikTokConnection.exists({ userId });
  const hasMeta = await MetaConnection.exists({ userId });
  const hasSocial = Boolean(hasTikTok || hasMeta);
  const hasNiches = niches.length > 0;
  return { ok: hasSocial && hasNiches, hasSocial, hasNiches };
}

const ensureCampaignAccess = async (req, res, next) => {
  const access = await getCampaignAccess(req.user._id);
  if (access.ok) return next();
  const error = access.hasSocial && !access.hasNiches
    ? "Choose your niches to unlock campaigns"
    : "Connect a social account to unlock campaigns";
  return res.status(403).json({ error, code: "CAMPAIGN_ACCESS_LOCKED" });
};

router.get("/profile/me", protect, async (req, res, next) => {
  try {
    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ error: "Creator profile not found" });
    }

    const user = await User.findById(req.user._id);

    res.json({
      name: user.name,
      avatar: user.avatar || null,
      displayName: profile.displayName || user.name,
      username: profile.username,
      bio: profile.bio || "",
      country: profile.country || "",
      socialAccounts: profile.socialAccounts || [],
      niches: profile.niches || [],
      rank: profile.rank,
      creatorScore: profile.creatorScore,
      lifetimeEarnings: profile.lifetimeEarnings,
      completionRate: profile.completionRate,
    });
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

router.get("/marketplace", protect, authorizeRoles("creator"), ensureCampaignAccess, async (req, res, next) => {
  try {
    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    const creatorRank = profile ? profile.rank : "rank1";
    const profileNiches = (profile && Array.isArray(profile.niches) ? profile.niches : [])
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean);

    const activeSlots = await Slot.countDocuments({
      creatorId: req.user._id,
      status: { $in: ["claimed", "submitted", "verifying"] },
    });

    const claimedCampaignIds = await Slot.distinct("campaignId", {
      creatorId: req.user._id,
      status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
    });
    const claimedCampaignSet = new Set(claimedCampaignIds.map((id) => id.toString()));

    const maxSlots = 3;
    const canClaim = activeSlots < maxSlots;

    const campaigns = await Campaign.find({
      status: "live",
    })
      .populate("businessId", "name avatar")
      .sort({ createdAt: -1 });

    const marketplace = [];

    for (const campaign of campaigns) {
      if (claimedCampaignSet.has(campaign._id.toString())) {
        continue;
      }

      const availableSlots = await Slot.find({
        campaignId: campaign._id,
        status: "available",
      }).sort({ createdAt: -1 });

      if (availableSlots.length > 0) {
        const matchingSlot = availableSlots.find(
          (s) => !s.rankRequired || s.rankRequired === creatorRank
        ) || availableSlots[0];

        const daysLeft = campaign.endDate
          ? Math.max(Math.ceil((campaign.endDate - Date.now()) / (1000 * 60 * 60 * 24)), 1)
          : 7;
        const brand = campaign.businessId;

        const campaignNiches = (Array.isArray(campaign.niches) ? campaign.niches : [])
          .map((n) => String(n).trim().toLowerCase())
          .filter(Boolean);

        let matchScore = 0;
        if (profileNiches.length > 0) {
          const overlap = campaignNiches.filter((n) => profileNiches.includes(n)).length;
          matchScore += overlap * 3;
          if (campaign.category && profileNiches.includes(String(campaign.category).trim().toLowerCase())) {
            matchScore += 2;
          }
          if (campaignNiches.length === 0) matchScore += 1;
        }

        marketplace.push({
          id: campaign._id,
          title: campaign.name,
          category: campaign.category,
          niches: campaignNiches,
          reward: matchingSlot.reward,
          creatorPool: campaign.creatorPool,
          viewTarget: matchingSlot.viewTarget,
          slotId: matchingSlot._id,
          rankRequired: matchingSlot.rankRequired,
          slotsLeft: availableSlots.length,
          targetViews: campaign.targetViews,
          coverImageUrl: campaign.coverImageUrl,
          contentBrief: campaign.contentBrief,
          keyMessageCta: campaign.keyMessageCta,
          platforms: campaign.platforms,
          description: campaign.contentBrief || "",
          minViews: 1000,
          maxViews: matchingSlot.viewTarget,
          costPerView: campaign.costPerView,
          daysLeft,
          brandName: brand ? brand.name || "Brand" : "Brand",
          brandAvatar: brand ? brand.avatar || null : null,
          matchScore,
          recommended: matchScore > 0,
        });
      }
    }

    marketplace.sort((a, b) => {
      if (b.recommended !== a.recommended) return b.recommended - a.recommended;
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b.slotsLeft - a.slotsLeft;
    });

    res.json({
      campaigns: marketplace,
      activeSlots,
      maxSlots,
      canClaim,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/slots/mine", protect, authorizeRoles("creator"), ensureCampaignAccess, async (req, res, next) => {
  try {
    const slots = await Slot.find({ creatorId: req.user._id })
      .populate({
        path: "campaignId",
        select: "name category status coverImageUrl contentBrief keyMessageCta whatToAvoid goal competitors uniqueSellingPoint funFact platforms contentStyle startDate endDate targetViews viewsDelivered costPerView scriptUrl scriptFileName businessId",
        populate: { path: "businessId", select: "name avatar" },
      })
      .sort({ createdAt: -1 });

    const submissions = await Submission.find({
      creatorId: req.user._id,
    }).sort({ createdAt: -1 });

    const submissionMap = {};
    for (const sub of submissions) {
      submissionMap[sub.campaignId.toString()] = sub;
    }

    const campaigns = slots
      .filter((slot) => slot.campaignId)
      .map((slot) => {
        const campaign = slot.campaignId;
        const submission = submissionMap[campaign._id.toString()];

        let status;
        if (submission) {
          switch (submission.status) {
            case "new":
              status = "under_review";
              break;
            case "awaiting_post":
            case "approved":
              status = "approved_post";
              break;
            case "posted":
              if (submission.viewsDelivered >= campaign.targetViews) {
                status = "delivered";
              } else {
                status = "live_tracking";
              }
              break;
            case "rejected":
              status = "changes_requested";
              break;
            default:
              status = "under_review";
          }
        } else {
          status = "needs_content";
        }

        if (campaign.status === "cancelled") status = "cancelled";

        return {
          id: campaign._id,
          slotId: slot._id,
          title: campaign.name,
          category: campaign.category,
          coverImageUrl: campaign.coverImageUrl,
          status,
          reward: slot.reward,
          viewTarget: slot.viewTarget,
          minViews: 1000,
          maxViews: slot.viewTarget,
          costPerView: campaign.costPerView,
          submissionId: submission ? submission._id : null,
          comment: submission && submission.status === "rejected" ? submission.rejectionReason : undefined,
          progress: submission && submission.viewsDelivered > 0
            ? Math.min(Number(((submission.viewsDelivered / (slot.viewTarget || campaign.targetViews)) * 100).toFixed(3)), 100)
            : 0,
          currentViews: submission ? submission.viewsDelivered : undefined,
          targetViews: campaign.targetViews,
          videoUrl: submission ? submission.videoUrl : undefined,
          caption: submission ? submission.caption : undefined,
          videoDuration: submission && submission.durationSeconds
            ? `${Math.floor(submission.durationSeconds / 60)}m ${submission.durationSeconds % 60}s`
            : undefined,
          postedPlatforms: submission ? submission.postedPlatforms : undefined,
          contentBrief: campaign.contentBrief,
          description: campaign.contentBrief || undefined,
          keyMessageCta: campaign.keyMessageCta,
          whatToAvoid: campaign.whatToAvoid,
          goal: campaign.goal,
          competitors: campaign.competitors,
          uniqueSellingPoint: campaign.uniqueSellingPoint,
          funFact: campaign.funFact,
          platforms: campaign.platforms,
          contentStyle: campaign.contentStyle,
          scriptUrl: campaign.scriptUrl,
          scriptFileName: campaign.scriptFileName,
          brandName: campaign.businessId ? campaign.businessId.name || undefined : undefined,
          brandAvatar: campaign.businessId ? campaign.businessId.avatar || undefined : undefined,
          delivery: slot.status === "claimed"
            ? "Claimed"
            : submission && submission.status === "posted"
            ? "Live"
            : submission && (submission.status === "awaiting_post" || submission.status === "approved")
            ? "Awaiting Post"
            : "Submitted",
          submittedAgo: timeAgo(submission ? submission.submittedAt : undefined),
          reviewedAgo: timeAgo(submission ? submission.reviewedAt : undefined),
          postedAgo: timeAgo(submission ? submission.postedAt : undefined),
          timeline: submission
            ? [
                { key: "submitted", label: "Content submitted", time: timeAgo(submission.submittedAt) },
                ...(submission.reviewedAt
                  ? [{ key: "reviewed", label: "Reviewed by admin", time: timeAgo(submission.reviewedAt) }]
                  : []),
                ...(submission.postedAt
                  ? [{ key: "posted", label: "Posted on socials", time: timeAgo(submission.postedAt) }]
                  : []),
              ]
            : [],
        };
      });

    res.json({ campaigns });
  } catch (error) {
    next(error);
  }
});

router.get("/wallet", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const profile = await CreatorProfile.findOne({ userId: req.user._id });

    const handle = profile ? profile.username : user.name;

    const transactions = await Transaction.find({
      creatorHandle: handle,
    })
      .sort({ date: -1 })
      .limit(50);

    const myTransactions = await Submission.find({
      creatorId: req.user._id,
      payoutStatus: "released",
    });

    const totalReleased = myTransactions.reduce((sum, s) => sum + (s.payoutAmount || 0), 0);

    const slots = await Slot.find({ creatorId: req.user._id }).populate({
      path: "campaignId",
      select: "name status targetViews costPerView viewsDelivered",
    });
    const submissions = await Submission.find({ creatorId: req.user._id });

    const submissionMap = {};
    for (const sub of submissions) {
      submissionMap[sub.campaignId.toString()] = sub;
    }

    let withdrawableBalance = 0;
    const pendingByCampaign = [];

    for (const slot of slots) {
      const campaign = slot.campaignId;
      if (!campaign) continue;
      const submission = submissionMap[campaign._id.toString()];
      if (!submission) continue;

      const views = submission.viewsDelivered || 0;
      const costPerView = campaign.costPerView || 0;
      const earned = views * costPerView;

      if (campaign.status === "completed") {
        withdrawableBalance += earned;
      } else if (["live", "paused", "under_review"].includes(campaign.status)) {
        pendingByCampaign.push({
          id: campaign._id,
          title: campaign.name,
          views,
          viewTarget: slot.viewTarget,
          earned,
          status: campaign.status,
        });
      }
    }

    const pendingBalance = pendingByCampaign.reduce((sum, c) => sum + c.earned, 0);

    res.json({
      balance: withdrawableBalance,
      withdrawableBalance,
      pendingBalance,
      pendingByCampaign,
      hasBankAccount: !!(profile && profile.payoutAccount && profile.payoutAccount.paystackRecipientCode),
      bankName: profile && profile.payoutAccount ? profile.payoutAccount.bankName : null,
      accountName: profile && profile.payoutAccount ? profile.payoutAccount.accountName : null,
      maskedAccountNumber:
        profile && profile.payoutAccount && profile.payoutAccount.accountNumber
          ? `****${profile.payoutAccount.accountNumber.slice(-4)}`
          : null,
      lifetimeEarnings: profile ? profile.lifetimeEarnings : 0,
      completionRate: profile ? profile.completionRate : 0,
      totalReleased,
      recentTransactions: transactions.map((t) => ({
        id: t._id,
        createdAt: t.date,
        date: t.date,
        amount: t.amount,
        type: t.type,
        status: t.status,
        views: t.views,
      })),
    });
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
    const earned = Math.min(views * (campaign.costPerView || 0), campaign.creatorPool || 0);

    if (amount > earned) {
      return res.status(400).json({ error: `You can only withdraw up to ₦${earned.toLocaleString()} for this campaign` });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    const existing = await Withdrawal.findOne({
      campaignId,
      creatorId: req.user._id,
      status: "pending",
    });
    if (existing) {
      return res.status(409).json({ error: "You already have a pending withdrawal for this campaign" });
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
