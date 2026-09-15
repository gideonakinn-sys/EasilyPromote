const express = require("express");
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const { protect } = require("../middleware/auth");

const router = express.Router();

router.get("/campaign/:campaignId", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Unmatched payments wait for an admin refund and were never part of this campaign's budget.
    const allTransactions = await Transaction.find({ campaignId: campaign._id, type: { $ne: "unmatched_payment" } }).sort({
      date: -1,
    });
    // The views escrow and the referral budget are separate pots; these totals are views only.
    const transactions = allTransactions.filter((t) => t.bucket !== "referral");
    const referralTransactions = allTransactions.filter((t) => t.bucket === "referral");

    const deposited = transactions
      .filter((t) => t.status === "escrow_deposit")
      .reduce((sum, t) => sum + t.amount, 0);

    const released = transactions
      .filter((t) => t.status === "released")
      .reduce((sum, t) => sum + t.amount, 0);

    const refunded = transactions
      .filter((t) => t.status === "refunded")
      .reduce((sum, t) => sum + t.amount, 0);

    const sumReferral = (predicate) => referralTransactions.filter(predicate).reduce((sum, t) => sum + t.amount, 0);

    const pendingInEscrow = deposited - released;
    const refundable = pendingInEscrow > 0 && ["completed", "cancelled"].includes(campaign.status)
      ? pendingInEscrow
      : 0;

    const ledger = transactions.map((t) => ({
      date: t.date,
      creator: t.creatorHandle || null,
      views: t.views || null,
      amount: t.amount,
      status: t.status,
    }));

    res.json({
      totalEscrowed: deposited,
      creatorPool: campaign.creatorPool,
      released,
      pendingInEscrow: Math.max(pendingInEscrow, 0),
      refundable,
      platformFeePercent: campaign.platformFeePercent,
      platformFeeAmount: campaign.platformFee,
      ledger,
      referral: {
        funded: sumReferral((t) => t.type === "topup" && t.status === "escrow_deposit"),
        platformFee: (campaign.referral && campaign.referral.platformFee) || 0,
        earnedByCreators: (campaign.referral && campaign.referral.earned) || 0,
        paidOut: sumReferral((t) => t.type === "release" && t.status === "released"),
        refunded: sumReferral((t) => t.type === "refund"),
        poolRemaining: (campaign.referral && campaign.referral.poolRemaining) || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/campaign/:campaignId/statement", protect, async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaign.businessId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const transactions = await Transaction.find({ campaignId: campaign._id, type: { $ne: "unmatched_payment" } }).sort({
      date: 1,
    });

    const header = "Date,Creator,Views,Amount,Status\n";
    const rows = transactions
      .map((t) => {
        const date = t.date.toISOString().split("T")[0];
        const creator = t.creatorHandle || "";
        const views = t.views || "";
        return `${date},${creator},${views},${t.amount},${t.status}`;
      })
      .join("\n");

    const csv = header + rows;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="statement-${campaign.name.replace(/\s+/g, "_")}.csv"`
    );
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
