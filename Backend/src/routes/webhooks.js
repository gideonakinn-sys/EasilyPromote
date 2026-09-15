const express = require("express");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const { verifyWebhookSignature } = require("../services/paystack");
const { emitToUser } = require("../config/socket");
const { ensureCampaignSlots } = require("../utils/ensureSlots");
const { settleRelease, revertRelease } = require("../utils/payouts");
const { creditTopup } = require("../utils/topups");
const { handleConversionWebhook, handleCodeCheck } = require("../services/conversions");
const { creditReferralTopup } = require("../utils/referralEarnings");
const { bookEscrowDeposit } = require("../utils/escrow");
const { recordUnmatchedPayment, applyRefundEvent } = require("../utils/refunds");

const router = express.Router();

router.post("/paystack", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const signature = req.headers["x-paystack-signature"];

    // Verify against the raw bytes before parsing anything.
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const payload = JSON.parse(req.body.toString("utf8"));
    const { event, data } = payload;

    if (event === "charge.success") {
      const reference = data.reference;
      const metadata = data.metadata || {};
      const paidAmount = (data.amount || 0) / 100;

      if (metadata.type === "topup" && metadata.campaignId) {
        if (String(data.currency || "").toUpperCase() !== "NGN") {
          await recordUnmatchedPayment({
            campaignId: metadata.campaignId,
            reference,
            amount: paidAmount,
            currency: data.currency,
            reason: "Top-up paid in a currency other than NGN.",
          });
          return res.sendStatus(200);
        }
        // Credit here rather than relying on the brand's browser making it back
        // to PATCH /topup. creditTopup is idempotent on the reference.
        const result = await creditTopup({
          campaignId: metadata.campaignId,
          reference,
          amount: paidAmount,
        });

        if (result.credited) {
          emitToUser(result.campaign.businessId, "topup-success", {
            campaignId: result.campaign._id,
            amount: paidAmount,
          });
        }
      } else if (metadata.type === "referral_topup" && metadata.campaignId) {
        if (String(data.currency || "").toUpperCase() !== "NGN") {
          await recordUnmatchedPayment({
            campaignId: metadata.campaignId,
            reference,
            amount: paidAmount,
            currency: data.currency,
            reason: "Referral budget paid in a currency other than NGN.",
          });
          return res.sendStatus(200);
        }
        // Referral budget payments are credited to their own pot; creditReferralTopup
        // is idempotent on the reference, so the brand's browser can race this safely.
        const result = await creditReferralTopup({
          campaignId: metadata.campaignId,
          reference,
          amount: paidAmount,
        });

        if (result.credited) {
          emitToUser(result.campaign.businessId, "referral-budget-topup", {
            campaignId: result.campaign._id,
            amount: paidAmount,
            poolRemaining: result.campaign.referral.poolRemaining,
          });
        }
      } else if (metadata.campaignId) {
        const campaign = await Campaign.findById(metadata.campaignId);
        const currency = String(data.currency || "").toUpperCase();

        if (campaign && campaign.status === "pending_payment") {
          // Compare paid amount to expected budget and check currency
          if (currency !== "NGN" || Math.round(paidAmount) !== Math.round(campaign.budget)) {
            // The campaign stays unpaid; the money waits for an admin to refund it.
            await recordUnmatchedPayment({
              campaignId: campaign._id,
              reference,
              amount: paidAmount,
              currency,
              reason: `Payment doesn't match the campaign budget of ₦${campaign.budget.toLocaleString()} NGN.`,
            });
            return res.sendStatus(200);
          }

          // The brand's payment-status poll may book the same payment concurrently;
          // the unique reference index lets exactly one of them record it.
          const booked = await bookEscrowDeposit({
            campaignId: campaign._id,
            amount: campaign.budget,
            reference,
          });

          // Move pending_payment -> live atomically
          const updated = await Campaign.findOneAndUpdate(
            { _id: campaign._id, status: "pending_payment" },
            { $set: { status: "live" } },
            { new: true }
          );

          if (updated) {
            await ensureCampaignSlots(updated);

            if (booked) {
              await Notification.create({
                businessId: updated.businessId,
                campaignId: updated._id,
                type: "campaign_live",
                title: "Campaign is live",
                body: "Your campaign is now live. Creators can start claiming placements.",
              });
            }

            emitToUser(updated.businessId, "payment-success", {
              campaignId: updated._id,
              status: "live",
            });
          }
        } else {
          // Usually the brand's payment-status check already booked this exact payment and
          // put the campaign live. Otherwise it's a second checkout or a payment that landed
          // after the campaign moved on, and an admin needs to refund it.
          const alreadyBooked = await Transaction.exists({ reference, type: { $in: ["escrow_deposit", "topup"] } });
          if (!alreadyBooked) {
            await recordUnmatchedPayment({
              campaignId: metadata.campaignId,
              reference,
              amount: paidAmount,
              currency,
              reason: campaign
                ? `Payment arrived while the campaign was "${campaign.status}".`
                : "Payment arrived for a campaign that no longer exists.",
            });
          }
        }
      }
    }

    if (event === "transfer.success") {
      const transaction = await Transaction.findOne({
        type: "release",
        reference: data.reference,
      });
      await settleRelease(transaction);
    }

    if (event === "transfer.failed" || event === "transfer.reversed") {
      const transaction = await Transaction.findOne({
        type: "release",
        reference: data.reference,
      });
      const label = event === "transfer.failed" ? "Transfer failed" : "Transfer reversed";
      await revertRelease(transaction, `${label}: ${data.reason || "no reason given by Paystack"}`);
    }

    if (event === "refund.processed" || event === "refund.failed") {
      await applyRefundEvent(event, data);
    }

    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

// Brands report referral conversions here. Accept any content type so the body
// always arrives as raw bytes — the signature is computed over those exact bytes.
router.post("/conversions", express.raw({ type: () => true, limit: "16kb" }), async (req, res, next) => {
  try {
    const result = await handleConversionWebhook({ headers: req.headers, rawBody: req.body });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// Brands' sign-up flows check a code here before accepting it, signed exactly like a
// conversion, so they never have to load creators' codes into their own systems.
router.post("/codes/validate", express.raw({ type: () => true, limit: "16kb" }), async (req, res, next) => {
  try {
    const result = await handleCodeCheck({ headers: req.headers, rawBody: req.body });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
