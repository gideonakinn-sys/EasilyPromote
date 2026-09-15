const Transaction = require("../models/Transaction");
const Submission = require("../models/Submission");
const Withdrawal = require("../models/Withdrawal");
const CreatorProfile = require("../models/CreatorProfile");

async function findWithdrawalFor(transaction) {
  // A withdrawal paid from two pots has a release row per pot, each carrying the shared
  // transfer reference; older single-pot releases used the transfer reference directly.
  for (const reference of [transaction.transferReference, transaction.reference]) {
    if (!reference) continue;
    const byReference = await Withdrawal.findOne({ reference });
    if (byReference) return byReference;
  }
  if (transaction.submissionId) {
    // Newest first: a submission can accumulate several withdrawals over time.
    return Withdrawal.findOne({ submissionId: transaction.submissionId }).sort({ createdAt: -1 });
  }
  return null;
}

// Transfer landed. The status flip is an atomic conditional update, so a webhook
// racing the inline settle loses the claim and cannot double-credit earnings.
async function settleRelease(transaction) {
  if (!transaction) return false;

  const claimed = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: "escrow_deposit" },
    { $set: { status: "released" } },
    { new: true }
  );
  if (!claimed) return false;
  transaction = claimed;

  const submission = transaction.submissionId
    ? await Submission.findById(transaction.submissionId)
    : null;
  if (submission) {
    submission.payoutStatus = "released";
    await submission.save();
  }

  // Referral payouts have no submission; their release records the creator directly.
  const creatorId = submission ? submission.creatorId : transaction.creatorId;
  if (creatorId) {
    const profile = await CreatorProfile.findOne({ userId: creatorId });
    if (profile) {
      profile.lifetimeEarnings = (profile.lifetimeEarnings || 0) + (transaction.amount || 0);
      await profile.save();
    }
  }

  const withdrawal = await findWithdrawalFor(transaction);
  if (withdrawal && withdrawal.status !== "released") {
    withdrawal.status = "released";
    withdrawal.releasedAt = new Date();
    await withdrawal.save();
  }

  return true;
}

// Transfer failed or was reversed. Return the amount to escrow and put the
// withdrawal back in the queue so an admin can retry it.
async function revertRelease(transaction, reason) {
  if (!transaction) return false;

  // Same atomic claim; the pre-update doc tells us whether earnings were
  // already credited and therefore need backing out.
  const previous = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: { $ne: "failed" } },
    { $set: { status: "failed" } },
    { new: false }
  );
  if (!previous) return false;

  const wasSettled = previous.status === "released";
  transaction = previous;

  const submission = transaction.submissionId
    ? await Submission.findById(transaction.submissionId)
    : null;
  if (submission) {
    submission.payoutStatus = "pending";
    await submission.save();
  }

  const creatorId = submission ? submission.creatorId : transaction.creatorId;
  if (wasSettled && creatorId) {
    const profile = await CreatorProfile.findOne({ userId: creatorId });
    if (profile) {
      profile.lifetimeEarnings = Math.max(
        (profile.lifetimeEarnings || 0) - (transaction.amount || 0),
        0
      );
      await profile.save();
    }
  }

  const withdrawal = await findWithdrawalFor(transaction);
  if (withdrawal) {
    withdrawal.status = "pending";
    withdrawal.releasedAt = null;
    withdrawal.adminNotes = [withdrawal.adminNotes, reason].filter(Boolean).join(" | ");
    await withdrawal.save();
  }

  return true;
}

module.exports = { settleRelease, revertRelease };
