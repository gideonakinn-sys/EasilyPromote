const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const { refundCampaignBucket } = require("./refunds");

// Money paid in by the brand and still earmarked for this campaign.
const DEPOSIT_TYPES = ["escrow_deposit", "topup"];

// A release reserves escrow the moment the transfer is initiated. Both
// in-flight ("escrow_deposit") and settled ("released") releases are spent
// money — only a "failed" release returns its amount to the pool.
const COMMITTED_RELEASE_STATUSES = ["escrow_deposit", "released"];

// Views and referral budgets are separate pots. Rows from before referral
// budgets existed have no bucket and belong to views.
function bucketOf(transaction) {
  return transaction.bucket === "referral" ? "referral" : "views";
}

function escrowBalanceFrom(transactions, bucket = "views", creatorPool = null) {
  const inBucket = transactions.filter((t) => bucketOf(t) === bucket);

  const deposited = inBucket
    .filter((t) => DEPOSIT_TYPES.includes(t.type) && t.status === "escrow_deposit")
    .reduce((sum, t) => sum + t.amount, 0);

  // Every refund row counts, whatever Paystack's progress: that money is the brand's.
  const refunded = inBucket.filter((t) => t.type === "refund").reduce((sum, t) => sum + t.amount, 0);

  const committed = inBucket
    .filter((t) => t.type === "release" && COMMITTED_RELEASE_STATUSES.includes(t.status))
    .reduce((sum, t) => sum + t.amount, 0);

  // Views payouts come out of the creator pool, never the platform fee inside the deposit.
  const availableDeposits =
    bucket === "views" && creatorPool !== null ? Math.min(deposited, creatorPool) : deposited;

  return Math.max(availableDeposits - refunded - committed, 0);
}

async function campaignEscrowBalance(campaignId, bucket = "views") {
  const Campaign = require("../models/Campaign");
  const campaign = await Campaign.findById(campaignId).select("creatorPool").lean();

  const filter =
    bucket === "referral" ? { campaignId, bucket: "referral" } : { campaignId, bucket: { $ne: "referral" } };
  const transactions = await Transaction.find(filter);
  const pool = bucket === "views" && campaign ? campaign.creatorPool : null;
  return escrowBalanceFrom(transactions, bucket, pool);
}

// Books a campaign payment into escrow exactly once. The Paystack webhook and the brand's
// payment-status poll can confirm the same payment at once; the unique {reference, type}
// index makes every loser a no-op. Returns whether this call booked it.
async function bookEscrowDeposit({ campaignId, amount, reference }) {
  try {
    await Transaction.create({
      campaignId,
      type: "escrow_deposit",
      amount,
      status: "escrow_deposit",
      reference,
      date: new Date(),
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

// Refunds a cancelled campaign's unused views escrow once, back to the brand's Paystack
// payments. Money creators are owed stays in escrow so it can still be paid: releases in
// flight or paid, and views withdrawals they requested that aren't approved yet.
async function refundViewsEscrow(campaignId) {
  const alreadyRefunded = await Transaction.exists({ campaignId, type: "refund", bucket: { $ne: "referral" } });
  if (alreadyRefunded) return 0;

  const balance = await campaignEscrowBalance(campaignId);
  const [awaiting] = await Withdrawal.aggregate([
    {
      $match: {
        campaignId: new mongoose.Types.ObjectId(String(campaignId)),
        kind: { $ne: "referral" },
        status: "pending",
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const refundable = Math.round(Math.max(balance - (awaiting ? awaiting.total : 0), 0) * 100) / 100;
  if (refundable <= 0) return 0;

  const refund = await refundCampaignBucket({
    campaignId,
    bucket: "views",
    amount: refundable,
    note: `Unused budget from cancelled campaign ${campaignId}`,
  });
  return refund ? refundable : 0;
}

module.exports = { campaignEscrowBalance, escrowBalanceFrom, bookEscrowDeposit, refundViewsEscrow };
