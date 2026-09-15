const Transaction = require("../models/Transaction");

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

function escrowBalanceFrom(transactions, bucket = "views") {
  const inBucket = transactions.filter((t) => bucketOf(t) === bucket);

  const deposited = inBucket
    .filter((t) => DEPOSIT_TYPES.includes(t.type) && t.status === "escrow_deposit")
    .reduce((sum, t) => sum + t.amount, 0);

  const committed = inBucket
    .filter((t) => t.type === "release" && COMMITTED_RELEASE_STATUSES.includes(t.status))
    .reduce((sum, t) => sum + t.amount, 0);

  return Math.max(deposited - committed, 0);
}

async function campaignEscrowBalance(campaignId, bucket = "views") {
  const filter = bucket === "referral" ? { campaignId, bucket: "referral" } : { campaignId, bucket: { $ne: "referral" } };
  const transactions = await Transaction.find(filter);
  return escrowBalanceFrom(transactions, bucket);
}

// Books a campaign payment into escrow exactly once. The Paystack webhook, the brand's
// payment-status poll and launch can all confirm the same payment at once; the unique
// {reference, type} index makes every loser a no-op. Returns whether this call booked it.
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

// Refunds a cancelled campaign's unreleased views escrow once. The fixed reference
// lets the unique index stop a brand cancel and an admin cancel both refunding.
// Money already committed to releases (in flight or paid) is not refunded.
async function refundViewsEscrow(campaignId) {
  const alreadyRefunded = await Transaction.findOne({ campaignId, type: "refund", bucket: { $ne: "referral" } });
  if (alreadyRefunded) return 0;

  const balance = await campaignEscrowBalance(campaignId);
  if (balance <= 0) return 0;

  try {
    await Transaction.create({
      campaignId,
      type: "refund",
      amount: balance,
      status: "refunded",
      reference: `refund_views_${campaignId}`,
      date: new Date(),
    });
    return balance;
  } catch (error) {
    if (error.code === 11000) return 0;
    throw error;
  }
}

module.exports = { campaignEscrowBalance, escrowBalanceFrom, bookEscrowDeposit, refundViewsEscrow };
