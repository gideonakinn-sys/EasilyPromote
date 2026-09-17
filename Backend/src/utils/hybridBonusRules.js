// The pure rules of hybrid pay's bonus (ticket 10), shared by the bonus service and reconciliation.
// No database access here.
const { toKobo, fromKobo } = require("./money");

const DAY_MS = 24 * 60 * 60 * 1000;
// Bonus is held 7 days from when it's credited, like referral rewards, so a fake conversion can be
// voided first.
const BONUS_HOLD_MS = 7 * DAY_MS;
// Conversions still count this long after a campaign completes (services/conversions.js), so a
// sign-up or download bonus pool can't be refunded before then.
const CONVERSION_GRACE_MS = 7 * DAY_MS;

// Where one bonus credit stands for the creator: in its hold, or available to withdraw.
function bonusCreditState(credit, now = new Date()) {
  const availableAt = new Date(new Date(credit.date).getTime() + BONUS_HOLD_MS);
  return availableAt > now ? { state: "on_hold", availableAt } : { state: "available", availableAt };
}

// A views bonus a creator is due in total, in kobo: verified views × the rate per 1,000, rounded
// down to the kobo, never more than the cap.
function viewsBonusDueKobo({ views, ratePerThousandViews, capPerCreator }) {
  const counted = Math.max(Math.floor(Number(views) || 0), 0);
  const due = Math.floor((counted * toKobo(ratePerThousandViews)) / 1000);
  return Math.min(due, toKobo(capPerCreator));
}

// What refunding `unusedPool` of a bonus pool returns: the unused pool plus the platform fee charged
// on it, pro rata and rounded down to the kobo (D5 amended; no Paystack fees deducted).
function unusedBonusRefund({ unusedPool, pool, platformFee }) {
  const unusedKobo = toKobo(unusedPool);
  const poolKobo = toKobo(pool);
  if (!(unusedKobo > 0) || !(poolKobo > 0)) return { pool: 0, platformFee: 0, amount: 0 };
  const feeKobo = Math.floor((toKobo(platformFee) * unusedKobo) / poolKobo);
  return { pool: fromKobo(unusedKobo), platformFee: fromKobo(feeKobo), amount: fromKobo(unusedKobo + feeKobo) };
}

// When a finished hybrid campaign's unused bonus pool can be refunded: at once when cancelled or for
// a views bonus (views stop counting at completion), after the conversion grace for sign-ups and
// downloads. Returns the date, or null while the campaign isn't finished.
function bonusRefundableFrom(campaign) {
  if (!campaign || !campaign.hybridBonus) return null;
  if (campaign.status === "cancelled") return new Date(0);
  if (campaign.status !== "completed") return null;
  const completedAt = new Date(campaign.completedAt || campaign.updatedAt || 0);
  return campaign.hybridBonus.metric === "views" ? completedAt : new Date(completedAt.getTime() + CONVERSION_GRACE_MS);
}

module.exports = { BONUS_HOLD_MS, CONVERSION_GRACE_MS, bonusCreditState, viewsBonusDueKobo, unusedBonusRefund, bonusRefundableFrom };
