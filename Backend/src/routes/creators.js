const express = require("express");
const { z } = require("zod");
const CreatorProfile = require("../models/CreatorProfile");
const User = require("../models/User");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Niche = require("../models/Niche");
const { protect, authorizeRoles } = require("../middleware/auth");

const router = express.Router();

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

router.get("/marketplace", protect, authorizeRoles("creator"), async (req, res, next) => {
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

router.get("/slots/mine", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const slots = await Slot.find({ creatorId: req.user._id })
      .populate({
        path: "campaignId",
        select: "name category status coverImageUrl contentBrief keyMessageCta whatToAvoid goal competitors uniqueSellingPoint funFact platforms contentStyle startDate endDate targetViews viewsDelivered scriptUrl scriptFileName businessId",
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
            ? Math.min(Math.round((submission.viewsDelivered / campaign.targetViews) * 100), 100)
            : undefined,
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
          submittedAgo: submission ? submission.submittedAt : undefined,
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

    res.json({
      balance: user.walletBalance,
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
