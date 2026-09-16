const express = require("express");
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const { protect, authorizeRoles } = require("../middleware/auth");
const { initializeTransaction, verifyTransaction } = require("../services/paystack");
const { ensureCampaignSlots } = require("../utils/ensureSlots");
const { creditTopup } = require("../utils/topups");
const { emitCampaignStatus } = require("../utils/campaignUpdates");
const { parseReferralSettings, campaignEventTypes } = require("../utils/referralCodes");
const { refundUnusedReferralBudget } = require("../utils/referralEarnings");
const { refundViewsEscrow } = require("../utils/escrow");
const { recordUnmatchedPayment } = require("../utils/refunds");
const { expectedPaymentAmount, bookCampaignPayment, brandAppVerified } = require("../utils/campaignPayments");
const { MIN_REFERRAL_TOPUP } = require("../utils/referralEarnings");

function sendSetupError(res, setup) {
  return res.status(setup.status).json({ error: setup.error, ...(setup.code && { code: setup.code }) });
}

// Top-ups buy more views, which content campaigns don't have. Returns true when it refused.
function refuseContentTopup(res, campaign) {
  if (campaign.campaignModel !== "content") return false;
  res.status(409).json({
    error: "Top-ups buy more views, so they aren't available for content campaigns.",
    code: "TOPUP_NOT_FOR_CONTENT",
  });
  return true;
}

// True when an edit changes what the brand's open checkout should charge.
// People who came in through creators' codes, and how much of the referral budget they've used.
// The share is taken from the creator pool so the platform fee never shows.
function referralProgress(campaign) {
  const referral = campaign.referral || {};
  const pool = referral.pool || 0;
  return {
    conversions: referral.conversions || 0,
    eventTypes: campaignEventTypes(campaign),
    budgetUsedPercent: pool > 0 ? Math.min(100, Math.round(((pool - (referral.poolRemaining || 0)) / pool) * 100)) : 0,
  };
}

function changesPrice(campaign, { targetViews, objective, requestedBudget }) {
  if (targetViews !== undefined && Number(targetViews) !== campaign.targetViews) return true;
  const nextObjective = objective !== undefined ? objective : campaign.objective;
  if (nextObjective !== campaign.objective) return true;
  const currentBudget = (campaign.referral && campaign.referral.requestedBudget) || 0;
  return nextObjective === "actions" && requestedBudget !== undefined && Math.round(Number(requestedBudget)) !== currentBudget;
}
const { releasedViewsTotal } = require("../utils/earnings");
const { resolveCampaignSetup, editSetupUpdates, campaignSetupView } = require("../utils/campaignSetup");

const router = express.Router();

router.get("/pricing", async (req, res, next) => {
  try {
    const { COST_PER_VIEW, TIER_PRICING } = require("../config/pricing");
    const Industry = require("../models/Industry");
    const categories = { ...COST_PER_VIEW.categories };
    const industries = await Industry.find({ enabled: true, costPerView: { $gt: 0 } });
    for (const ind of industries) {
      categories[ind.name] = ind.costPerView;
    }
    res.json({
      default: COST_PER_VIEW.default,
      categories,
      tiers: TIER_PRICING,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/", protect, async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = { businessId: req.user._id };

    if (status && status !== "all") {
      if (status === "review_needed") {
        filter.status = "live";
      } else {
        filter.status = status;
      }
    }

    const [campaigns, draftCount, appVerified] = await Promise.all([
      Campaign.find(filter).sort({ createdAt: -1 }).lean(),
      Campaign.countDocuments({ businessId: req.user._id, status: "draft" }),
      brandAppVerified(req.user._id),
    ]);

    const campaignsResponse = campaigns.map((c) => {
      const progressPercent =
        c.targetViews > 0
          ? Math.min(Math.round((c.viewsDelivered / c.targetViews) * 100), 100)
          : 0;

      return {
        id: c._id,
        name: c.name,
        coverImageUrl: c.coverImageUrl,
        category: c.category,
        status: c.status,
        statusNote: c.statusNote,
        reviewNeeded: c.status === "live" && c.viewsDelivered < c.targetViews,
        targetViews: c.targetViews,
        viewsDelivered: c.viewsDelivered,
        budget: c.budget,
        costPerView: c.costPerView,
        progressPercent,
        startDate: c.startDate,
        endDate: c.endDate,
        contentBrief: c.contentBrief,
        objective: c.objective || "views",
        // A referral campaign can't be paid for until the brand's app is connected.
        needsAppConnection: c.objective === "actions" && ["draft", "pending_payment"].includes(c.status) && !appVerified,
        referral: c.objective === "actions" ? referralProgress(c) : null,
      };
    });

    res.json({ campaigns: campaignsResponse, draftCount });
  } catch (error) {
    next(error);
  }
});

router.post("/", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { coverImageUrl, name, category, targetViews, contentBrief, keyMessageCta, whatToAvoid, goal, competitors, uniqueSellingPoint, funFact, platforms, contentStyle, niches, scriptUrl, scriptFileName, referral, objective } = req.body;

    const setup = resolveCampaignSetup(req.body);
    if (setup.error) return sendSetupError(res, setup);

    const referralSettings = parseReferralSettings(referral);
    if (referralSettings.error) {
      return res.status(400).json({ error: referralSettings.error });
    }
    // Older clients send only `objective` (or referral.enabled); the setup maps both ways.
    const campaignObjective = setup.legacyObjective;
    const referralValues = { ...referralSettings.value, enabled: campaignObjective === "actions" };
    if (setup.referralEventTypes) {
      referralValues.eventTypes = setup.referralEventTypes;
      referralValues.eventType = setup.referralEventTypes[0];
    }
    if (campaignObjective === "views") referralValues.requestedBudget = 0;
    const isContent = setup.updates.campaignModel === "content";

    const campaign = await Campaign.create({
      businessId: req.user._id,
      coverImageUrl: coverImageUrl || null,
      name,
      category,
      targetViews: isContent ? undefined : targetViews,
      ...setup.updates,
      contentBrief: contentBrief || null,
      keyMessageCta: keyMessageCta || null,
      whatToAvoid: whatToAvoid || null,
      goal: goal || null,
      competitors: competitors || null,
      uniqueSellingPoint: uniqueSellingPoint || null,
      funFact: funFact || null,
      platforms: platforms || [],
      contentStyle: contentStyle ? (Array.isArray(contentStyle) ? contentStyle : contentStyle.split(",").map(s => s.trim()).filter(Boolean)) : [],
      niches: niches || [],
      scriptUrl: scriptUrl || null,
      scriptFileName: scriptFileName || null,
      objective: campaignObjective,
      referral: referralValues,
      status: "draft",
      wizardStep: req.body.wizardStep,
    });

    res.status(201).json({
      id: campaign._id,
      status: campaign.status,
      budget: campaign.budget,
      costPerView: campaign.costPerView,
      quote: setup.quote,
    });
  } catch (error) {
    next(error);
  }
});

// What the wizard shows the brand before saving: the same calculator checkout charges from.
// With a campaignId, the setup is quoted as an edit of that campaign, at its own platform fee.
router.post("/quote", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { campaignId, ...body } = req.body || {};
    let current = null;
    if (campaignId !== undefined) {
      current = mongoose.isValidObjectId(campaignId) ? await Campaign.findById(campaignId) : null;
      if (!current || current.businessId.toString() !== req.user._id.toString()) {
        return res.status(404).json({ error: "Campaign not found" });
      }
    }
    const setup = resolveCampaignSetup(body, current);
    if (setup.error) return sendSetupError(res, setup);
    res.json({ quote: setup.quote });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/pay", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Campaign cannot be paid" });
    }
    const isContent = campaign.campaignModel === "content";
    if (isContent && !(campaign.contentPay && campaign.contentPay.ratePerDeliverable)) {
      return res.status(400).json({ error: "Set what creators earn per deliverable before paying.", code: "CONTENT_PAY_REQUIRED" });
    }
    // Referral campaigns pay their referral budget in the same checkout, and only once the
    // brand's app is connected: Paystack can't hold the money while they finish setup.
    const referralAmount =
      campaign.objective === "actions" ? Math.round((campaign.referral && campaign.referral.requestedBudget) || 0) : 0;
    if (campaign.objective === "actions") {
      if (referralAmount < MIN_REFERRAL_TOPUP) {
        return res.status(400).json({
          error: `Add a referral budget of at least ₦${MIN_REFERRAL_TOPUP.toLocaleString()} before paying.`,
          code: "REFERRAL_BUDGET_REQUIRED",
        });
      }
      if (!(await brandAppVerified(req.user._id))) {
        return res.status(409).json({
          error: "Connect your app before paying for a referral campaign. We need a code check and a test conversion from your server.",
          code: "INTEGRATION_REQUIRED",
        });
      }
    }
    // A draft is charged the calculator's total as it stands, so one priced under an older
    // price table pays what the wizard quotes today. An open checkout keeps its price: a
    // payment still arriving from an earlier checkout tab must match it.
    let total = campaign.budget + referralAmount;
    if (campaign.status === "draft") {
      const setup = resolveCampaignSetup({}, campaign);
      if (setup.error) return sendSetupError(res, setup);
      for (const [field, value] of Object.entries(setup.money)) {
        if (field !== "contentPay") campaign[field] = value;
      }
      total = setup.quote.total;
    }

    const reference = `ep_${campaign._id}_${Date.now()}`;

    const origin = req.headers.origin || process.env.PAYSTACK_CALLBACK_URL || "http://localhost:3000";
    const callback_url = `${origin.replace(/\/$/, "")}/dashboard/brand?payment=success&campaignId=${campaign._id}&reference=${reference}`;

    const paymentData = await initializeTransaction({
      email: req.user.email,
      amount: total,
      reference,
      metadata: {
        campaignId: campaign._id.toString(),
        businessId: req.user._id.toString(),
        campaignName: campaign.name,
        // The campaign's own price (views price, or a content campaign's pay plus fee) and the
        // referral budget. viewsAmount stays for performance campaigns' older readers.
        campaignAmount: campaign.budget,
        ...(!isContent && { viewsAmount: campaign.budget }),
        referralAmount,
      },
      callback_url,
    });

    campaign.status = "pending_payment";
    campaign.paymentReference = reference;
    campaign.paymentAmount = total;
    await campaign.save();

    res.json({
      authorization_url: paymentData.authorization_url,
      access_code: paymentData.access_code,
      reference,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/payment-status", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (campaign.status === "pending_payment") {
      const transaction = await Transaction.findOne({
        campaignId: campaign._id,
        type: "escrow_deposit",
      });

      if (transaction) {
        const updated = await Campaign.findOneAndUpdate(
          { _id: campaign._id, status: "pending_payment" },
          { $set: { status: "live" } },
          { new: true }
        );
        if (updated) {
          await ensureCampaignSlots(updated);
          campaign.status = "live";
        }
      } else if (campaign.paymentReference) {
        try {
          const paystackData = await verifyTransaction(campaign.paymentReference);
          const paidAmount = (paystackData.amount || 0) / 100;
          const currency = String(paystackData.currency || "").toUpperCase();

          if (
            paystackData.status === "success" &&
            currency === "NGN" &&
            Math.round(paidAmount) === Math.round(expectedPaymentAmount(campaign))
          ) {
            // The webhook may be booking the same payment right now; only one wins.
            const booked = await bookCampaignPayment(campaign, campaign.paymentReference);

            const updated = await Campaign.findOneAndUpdate(
              { _id: campaign._id, status: "pending_payment" },
              { $set: { status: "live" } },
              { new: true }
            );

            if (updated) {
              campaign.status = "live";
              await ensureCampaignSlots(updated);
              if (booked) {
                await Notification.create({
                  businessId: campaign.businessId,
                  campaignId: campaign._id,
                  type: "campaign_live",
                  title: "Campaign is live",
                  body: "Your campaign is now live. Creators can start claiming placements.",
                });
              }
            }
          } else if (paystackData.status === "success") {
            // Paid, but not this campaign's price: it stays unpaid and an admin refunds it.
            await recordUnmatchedPayment({
              campaignId: campaign._id,
              reference: campaign.paymentReference,
              amount: paidAmount,
              currency,
              reason: `Payment doesn't match the checkout total of ₦${expectedPaymentAmount(campaign).toLocaleString()} NGN.`,
            });
          }
        } catch {
          // paystack verification failed, status stays pending
        }
      }
    }

    res.json({
      status: campaign.status,
      isPaid: ["under_review", "live", "completed", "paused"].includes(campaign.status),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only edit draft campaigns" });
    }

    // A new size or referral budget mid-checkout is a new price. The campaign goes back to
    // draft so the old checkout can't put it live; a payment still made on it is recorded for refund.
    const edit = editSetupUpdates(req.body, campaign);
    if (edit.error) return sendSetupError(res, edit);

    const allowedFields = [
      "coverImageUrl",
      "name",
      "category",
      "startDate",
      "endDate",
      "targetViews",
      "contentBrief",
      "keyMessageCta",
      "whatToAvoid",
      "goal",
      "competitors",
      "uniqueSellingPoint",
      "funFact",
      "scriptUrl",
      "scriptFileName",
      "platforms",
      "contentStyle",
      "niches",
      "wizardStep",
    ];
    const updates = {};
    for (const field of allowedFields) {
      // Content campaigns have no view target; the setup below owns targetViews for the rest.
      if (field === "targetViews") continue;
      if (req.body[field] !== undefined) {
        updates[field] =
          field === "contentStyle" && typeof req.body[field] === "string"
            ? req.body[field].split(",").map((s) => s.trim()).filter(Boolean)
            : req.body[field];
      }
    }

    if (req.body.referral !== undefined) {
      const referralSettings = parseReferralSettings(req.body.referral);
      if (referralSettings.error) {
        return res.status(400).json({ error: referralSettings.error });
      }
      // Dotted paths so the conversions counter is never overwritten.
      for (const [key, value] of Object.entries(referralSettings.value)) {
        updates[`referral.${key}`] = value;
      }
    }

    // Objective, setup and — only when size or pay changes — price, fee and creator pool from
    // one quote, so the pool can't go stale (findOneAndUpdate skips the model's save hook).
    Object.assign(updates, edit.updates);

    const repriced =
      campaign.status === "pending_payment" &&
      (edit.priceChanged ||
        changesPrice(campaign, {
          targetViews: edit.isContent ? undefined : req.body.targetViews,
          objective: updates.objective,
          requestedBudget: req.body.referral ? req.body.referral.requestedBudget : undefined,
        }));
    if (repriced) {
      updates.status = "draft";
      updates.paymentReference = null;
      updates.paymentAmount = 0;
    }

    // Only if the status is still what we checked, so a payment confirmed meanwhile isn't undone.
    const updated = await Campaign.findOneAndUpdate({ _id: campaign._id, status: campaign.status }, updates, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(409).json({ error: "This campaign's payment status just changed. Reload and try again." });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/save-and-close", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only save draft campaigns" });
    }

    const { step, data } = req.body;
    const updates = {};
    let priceChanged = false;

    if (step === 1) {
      if (data.coverImageUrl !== undefined) updates.coverImageUrl = data.coverImageUrl;
      if (data.name !== undefined) updates.name = data.name;
      if (data.category !== undefined) updates.category = data.category;
      if (data.startDate !== undefined) updates.startDate = data.startDate;
      if (data.endDate !== undefined) updates.endDate = data.endDate;
      if (data.targetViews !== undefined) {
        const edit = editSetupUpdates({ targetViews: data.targetViews }, campaign);
        if (edit.error) return sendSetupError(res, edit);
        Object.assign(updates, edit.updates);
        priceChanged = priceChanged || edit.priceChanged;
      }
      if (data.scriptUrl !== undefined) updates.scriptUrl = data.scriptUrl;
      if (data.scriptFileName !== undefined) updates.scriptFileName = data.scriptFileName;
    } else if (step === 2) {
      if (data.contentBrief !== undefined) updates.contentBrief = data.contentBrief;
      if (data.keyMessageCta !== undefined) updates.keyMessageCta = data.keyMessageCta;
      if (data.whatToAvoid !== undefined) updates.whatToAvoid = data.whatToAvoid;
      if (data.platforms !== undefined) updates.platforms = data.platforms;
      if (data.contentStyle !== undefined) updates.contentStyle = data.contentStyle;
      if (data.niches !== undefined) updates.niches = data.niches;
    } else if (step === 3) {
      if (data.objective !== undefined || data.referral !== undefined) {
        const edit = editSetupUpdates({ objective: data.objective, referral: data.referral }, campaign);
        if (edit.error) return sendSetupError(res, edit);
        Object.assign(updates, edit.updates);
        priceChanged = priceChanged || edit.priceChanged;
      }
      if (data.referral !== undefined) {
        const referralSettings = parseReferralSettings(data.referral);
        if (referralSettings.error) {
          return res.status(400).json({ error: referralSettings.error });
        }
        for (const key of ["eventType", "eventTypes", "requestedBudget"]) {
          if (referralSettings.value[key] !== undefined) updates[`referral.${key}`] = referralSettings.value[key];
        }
      }
    }

    // As in PATCH /:id: a new size or referral budget mid-checkout is a new price, so back to draft.
    if (
      campaign.status === "pending_payment" &&
      (priceChanged ||
        changesPrice(campaign, {
          targetViews: updates.targetViews,
          objective: updates.objective,
          requestedBudget: updates["referral.requestedBudget"],
        }))
    ) {
      updates.status = "draft";
      updates.paymentReference = null;
      updates.paymentAmount = 0;
    }

    const updated = await Campaign.findOneAndUpdate({ _id: campaign._id, status: campaign.status }, updates, {
      new: true,
      runValidators: true,
    });
    if (!updated) {
      return res.status(409).json({ error: "This campaign's payment status just changed. Reload and try again." });
    }

    res.json({ id: updated._id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/review", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({
      id: campaign._id,
      name: campaign.name,
      targetViews: campaign.targetViews,
      budget: campaign.budget,
      platforms: campaign.platforms,
      contentBrief: campaign.contentBrief,
      scriptUrl: campaign.scriptUrl,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
    });
  } catch (error) {
    next(error);
  }
});



router.post("/:id/topup-init", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["live", "under_review", "paused"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only top up active campaigns" });
    }
    if (refuseContentTopup(res, campaign)) return;

    const reference = `ep_topup_${campaign._id}_${Date.now()}`;

    const origin = req.headers.origin || process.env.PAYSTACK_CALLBACK_URL || "http://localhost:3000";
    const callback_url = `${origin.replace(/\/$/, "")}/dashboard/brand/campaign/${campaign._id}?topup=success&reference=${reference}&amount=${amount}`;

    const paymentData = await initializeTransaction({
      email: req.user.email,
      amount,
      reference,
      metadata: {
        campaignId: campaign._id.toString(),
        businessId: req.user._id.toString(),
        campaignName: campaign.name,
        type: "topup",
      },
      callback_url,
    });

    res.json({
      authorization_url: paymentData.authorization_url,
      reference,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/topup", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { amount, paystackReference } = req.body;

    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["live", "under_review", "paused"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only top up active campaigns" });
    }
    if (refuseContentTopup(res, campaign)) return;

    // The callback URL carries `amount` in the query string, so the request body
    // is not evidence of anything. Only Paystack decides what was paid, and only
    // a reference proves a payment happened at all.
    if (!paystackReference) {
      return res.status(400).json({ error: "A payment reference is required to top up" });
    }

    const verification = await verifyTransaction(paystackReference);
    if (!verification || verification.status !== "success") {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    // A reference from another campaign (or another brand) must not credit this one.
    const paidForCampaign = verification.metadata && verification.metadata.campaignId;
    if (paidForCampaign && String(paidForCampaign) !== String(campaign._id)) {
      return res.status(400).json({ error: "That payment belongs to a different campaign" });
    }

    if (verification.metadata?.type !== "topup") {
      return res.status(400).json({ error: "That payment is not a top-up" });
    }

    if (String(verification.currency || "").toUpperCase() !== "NGN") {
      return res.status(400).json({ error: "Payment must be in NGN" });
    }

    const existingOther = await Transaction.findOne({ reference: paystackReference, type: { $ne: "topup" } });
    if (existingOther) {
      return res.status(400).json({ error: "That payment reference has already been used for another transaction" });
    }

    const verifiedAmount = (verification.amount || 0) / 100;
    const result = await creditTopup({
      campaignId: campaign._id,
      reference: paystackReference,
      amount: verifiedAmount,
    });

    const current = result.campaign || campaign;

    res.json({
      budget: current.budget,
      creatorPool: current.creatorPool,
      targetViews: current.targetViews,
      amount: verifiedAmount,
      credited: result.credited === true,
      alreadyCredited: result.alreadyCredited === true,
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/pause", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaign.status !== "live") {
      return res.status(400).json({ error: "Can only pause live campaigns" });
    }

    campaign.status = "paused";
    await campaign.save();

    emitCampaignStatus(campaign);

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/resume", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaign.status !== "paused") {
      return res.status(400).json({ error: "Can only resume paused campaigns" });
    }

    campaign.status = "live";
    await campaign.save();
    await ensureCampaignSlots(campaign);

    emitCampaignStatus(campaign);

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/cancel", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (["completed", "cancelled"].includes(campaign.status)) {
      return res.status(400).json({ error: "Cannot cancel this campaign" });
    }

    campaign.status = "cancelled";
    await campaign.save();

    emitCampaignStatus(campaign);

    // Views escrow once, net of releases already committed to creators (in flight or
    // paid) — the same rule admin cancellation uses. Referral budget is refunded below.
    await refundViewsEscrow(campaign._id);

    await refundUnusedReferralBudget(campaign._id);

    res.json({ id: campaign._id, status: campaign.status });
  } catch (error) {
    next(error);
  }
});

// Open Call join: runs the creator's eligibility and reserves a placement in one step.
router.post("/:id/join", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { joinCampaign } = require("../services/placements");
    // Views campaigns may commit to a share of the views, as the older claim did.
    const committedViews = req.body ? req.body.committedViews : undefined;
    const result = await joinCampaign({ user: req.user, campaignId: req.params.id, committedViews });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const progressPercent =
      campaign.targetViews > 0
        ? Math.min(Math.round((campaign.viewsDelivered / campaign.targetViews) * 100), 100)
        : 0;

    const [submissionsReceived, submissionsApproved, submissionsAwaitingReview, creatorCount] =
      await Promise.all([
        Submission.countDocuments({ campaignId: campaign._id }),
        Submission.countDocuments({
          campaignId: campaign._id,
          // Campaign engine: content approval (ticket 07) adds verifying, the delivery statuses and completed.
          status: { $in: ["approved", "awaiting_post", "posted", "verifying", "awaiting_delivery", "awaiting_receipt", "completed"] },
        }),
        Submission.countDocuments({ campaignId: campaign._id, status: "new" }),
        Slot.distinct("creatorId", {
          campaignId: campaign._id,
          status: { $ne: "available" },
        }).then((ids) => ids.length),
      ]);

    const viewsReleased = await releasedViewsTotal({ campaignId: campaign._id });

    res.json({
      id: campaign._id,
      name: campaign.name,
      category: campaign.category,
      coverImageUrl: campaign.coverImageUrl,
      targetViews: campaign.targetViews,
      budget: campaign.budget,
      costPerView: campaign.costPerView,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      status: campaign.status,
      statusNote: campaign.statusNote,
      viewsDelivered: campaign.viewsDelivered,
      progressPercent,
      contentBrief: campaign.contentBrief,
      keyMessageCta: campaign.keyMessageCta,
      whatToAvoid: campaign.whatToAvoid,
      goal: campaign.goal,
      competitors: campaign.competitors,
      uniqueSellingPoint: campaign.uniqueSellingPoint,
      funFact: campaign.funFact,
      scriptUrl: campaign.scriptUrl,
      scriptFileName: campaign.scriptFileName,
      platforms: campaign.platforms,
      contentStyle: campaign.contentStyle,
      niches: campaign.niches,
      platformFeePercent: campaign.platformFeePercent,
      platformFee: campaign.platformFee,
      creatorPool: campaign.creatorPool,
      viewsReleased,
      submissionsReceived,
      submissionsApproved,
      submissionsAwaitingReview,
      creatorCount,
      objective: campaign.objective || "views",
      ...campaignSetupView(campaign),
      paymentAmount: campaign.paymentAmount || 0,
      wizardStep: campaign.wizardStep || null,
      referral: {
        requestedBudget: campaign.referral ? campaign.referral.requestedBudget || 0 : 0,
        enabled: Boolean(campaign.referral && campaign.referral.enabled),
        eventType: campaign.referral ? campaign.referral.eventType : "signup",
        eventTypes: campaignEventTypes(campaign),
        codeSource: campaign.referral ? campaign.referral.codeSource : "easilypromote",
        conversions: campaign.referral ? campaign.referral.conversions : 0,
        rewardPerConversion: campaign.referral ? campaign.referral.rewardPerConversion || 0 : 0,
        budget: campaign.referral ? campaign.referral.budget || 0 : 0,
        platformFee: campaign.referral ? campaign.referral.platformFee || 0 : 0,
        pool: campaign.referral ? campaign.referral.pool || 0 : 0,
        poolRemaining: campaign.referral ? campaign.referral.poolRemaining || 0 : 0,
        earned: campaign.referral ? campaign.referral.earned || 0 : 0,
        budgetUsedPercent: referralProgress(campaign).budgetUsedPercent,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["draft", "pending_payment"].includes(campaign.status)) {
      return res.status(400).json({ error: "Can only delete draft or pending payment campaigns" });
    }

    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ message: "Campaign deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
