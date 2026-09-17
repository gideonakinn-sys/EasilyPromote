// The pure rules of fixed pay (ticket 09), shared by the fixed pay service and reconciliation.
// No database access here.
const { toKobo, fromKobo } = require("./money");

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_HOLD_MS = 7 * DAY_MS;
// Rejected content can be appealed for this long; until then its deliverable isn't unused.
const APPEAL_WINDOW_MS = 7 * DAY_MS;
// Approved brand-page content not delivered this long after approval can have its pay voided.
const UNDELIVERED_VOID_AFTER_MS = 14 * DAY_MS;

// Where one credit stands for the creator: waiting for the brand to confirm delivery, in its
// 7-day hold after completion, or available to withdraw.
function fixedCreditState(submission, now = new Date()) {
  const completedAt = submission && submission.status === "completed" && submission.completedAt;
  if (!completedAt) return { state: "awaiting_delivery", availableAt: null };
  const availableAt = new Date(new Date(completedAt).getTime() + FIXED_HOLD_MS);
  return availableAt > now ? { state: "on_hold", availableAt } : { state: "available", availableAt };
}

// Whether a submission without a credit can still earn its fixed pay, so its deliverable isn't
// unused: anything still moving through review, delivery or an appeal, rejected content while it
// can still be appealed, and voided (not delivered) pay while its payout appeal is open or can still
// be filed (D23). Finally rejected content and voided pay past its appeal can't.
function canStillEarn(submission, now = new Date()) {
  if (!submission) return false;
  if (submission.status === "not_delivered") {
    return submission.voidAppealOpen === true || (Boolean(submission.voidAppealableUntil) && new Date(submission.voidAppealableUntil) > now);
  }
  if (submission.status === "rejected") {
    return Boolean(submission.appealableUntil) && new Date(submission.appealableUntil) > now;
  }
  return true;
}

// The unused part of a content campaign a brand gets back (D5): deliverables bought that are
// neither credited, still able to earn pay, nor already refunded (pending or succeeded), at the
// brand's rate plus the platform fee charged on them, pro rata and rounded down to the kobo.
// Paystack fees are NOT deducted, consistent with the views and referral refunds (lead decision;
// D5 is being amended to match).
function unusedBudgetRefund({ deliverables, ratePerDeliverable, platformFee, credited, inProgress, refundedDeliverables }) {
  const bought = Math.max(Number(deliverables) || 0, 0);
  const unused = Math.max(bought - (credited || 0) - (inProgress || 0) - (refundedDeliverables || 0), 0);
  return refundFor({ deliverables: unused, bought, ratePerDeliverable, platformFee });
}

// What refunding `deliverables` of `bought` returns.
function refundFor({ deliverables, bought, ratePerDeliverable, platformFee }) {
  if (!(deliverables > 0) || !(bought > 0)) return { deliverables: 0, creatorBudget: 0, platformFee: 0, amount: 0 };
  const creatorBudgetKobo = deliverables * toKobo(ratePerDeliverable);
  const feeKobo = Math.floor((toKobo(platformFee) * deliverables) / bought);
  return {
    deliverables,
    creatorBudget: fromKobo(creatorBudgetKobo),
    platformFee: fromKobo(feeKobo),
    amount: fromKobo(creatorBudgetKobo + feeKobo),
  };
}

// D2: the fee on a content campaign is added on top of the creator budget.
function contentPlatformFee(creatorPool, platformFeePercent) {
  const percent = Number.isFinite(platformFeePercent) ? platformFeePercent : 30;
  return fromKobo(Math.round((toKobo(creatorPool) * percent) / 100));
}

module.exports = {
  FIXED_HOLD_MS,
  APPEAL_WINDOW_MS,
  UNDELIVERED_VOID_AFTER_MS,
  fixedCreditState,
  canStillEarn,
  unusedBudgetRefund,
  refundFor,
  contentPlatformFee,
};
