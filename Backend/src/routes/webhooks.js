const express = require("express");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const Submission = require("../models/Submission");
const Notification = require("../models/Notification");
const { verifyWebhookSignature } = require("../services/paystack");
const { emitToUser } = require("../config/socket");
const { ensureCampaignSlots } = require("../utils/ensureSlots");

const router = express.Router();

router.post("/paystack", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.body.toString("utf8");
    const payload = JSON.parse(rawBody);

    if (!verifyWebhookSignature(payload, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const { event, data } = payload;

    if (event === "charge.success") {
      const reference = data.reference;
      const metadata = data.metadata || {};

      if (metadata.campaignId) {
        const campaign = await Campaign.findById(metadata.campaignId);
        if (campaign && campaign.status === "pending_payment") {
          campaign.status = "live";
          await campaign.save();
          await ensureCampaignSlots(campaign);

          await Transaction.create({
            campaignId: campaign._id,
            type: "escrow_deposit",
            amount: campaign.budget,
            status: "escrow_deposit",
            date: new Date(),
          });

          await Notification.create({
            businessId: campaign.businessId,
            campaignId: campaign._id,
            type: "campaign_live",
            title: "Campaign is live",
            body: "Your campaign is now live. Creators can start claiming slots.",
          });

          emitToUser(campaign.businessId, "payment-success", {
            campaignId: campaign._id,
            status: "live",
          });
        }
      }
    }

    if (event === "transfer.success") {
      const { reference, amount } = data;

      const transaction = await Transaction.findOne({
        type: "release",
        status: "escrow_deposit",
      }).sort({ createdAt: -1 });

      if (transaction) {
        transaction.status = "released";
        await transaction.save();

        if (transaction.submissionId) {
          const submission = await Submission.findById(transaction.submissionId);
          if (submission) {
            submission.payoutStatus = "released";
            await submission.save();
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
