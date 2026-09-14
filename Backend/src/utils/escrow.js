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

module.exports = { campaignEscrowBalance, escrowBalanceFrom };
