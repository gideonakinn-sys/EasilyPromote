// Prices a campaign (decisions D1–D14 are in docs/campaign-engine/SPEC.md). The brand wizard
// and checkout are meant to share this, so what a brand is shown
// is exactly what they are charged.
const { getPriceForViews, getTierPricing } = require("../config/pricing");
const { OBJECTIVES, usesReferralTracking } = require("../utils/campaignObjectives");
const { roundMoney } = require("../utils/referralEarnings");

const DEFAULT_PLATFORM_FEE_PERCENT = 30;
const MAX_DELIVERABLES = 100;
// Hybrid pay (ticket 10): the smallest bonus pool a brand can fund, and the metrics a bonus can pay for.
const MIN_BONUS_POOL = 1000;
const BONUS_METRICS = ["views", "signups", "downloads"];

// What a creator earns per 1,000 verified views of a hybrid bonus: the creator's share of the price
// table's first tier (ADR 0003: views are priced by EasilyPromote, never by the brand).
function bonusViewsRate(platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT) {
  const [tier] = getTierPricing();
  const creatorShareKobo = Math.round(tier.price * 100 * (1 - platformFeePercent / 100));
  return Math.floor((creatorShareKobo * 1000) / tier.views) / 100;
}

// Returns { quote: { creatorBudget, performanceBudget, platformFee, total } } or { error }.
// - content: brand's rate × deliverables for creators; the fee is added on top (D2)
// - hybrid (content only): the base as content, plus the bonus pool with the fee on top of it too
//   (D2 amended for hybrid); the quote adds bonusPool and bonusFee, and platformFee is both fees
// - views: price-table price with the fee inside it, as today
// - referral objectives: views price plus the referral budget, the fee inside each, as today; with no
//   views target (referrals only, D31) just the referral budget
function quoteCampaign({
  objective,
  payShape,
  contentPay,
  hybridBonus,
  targetViews,
  referralBudget = 0,
  platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT,
}) {
  const definition = OBJECTIVES[objective];
  if (!definition) return { error: "Choose what the campaign is for" };
  const feeRate = platformFeePercent / 100;

  if (definition.campaignModel === "content") {
    const rate = contentPay && contentPay.ratePerDeliverable;
    const deliverables = contentPay && contentPay.deliverables;
    if (!Number.isInteger(rate) || rate <= 0) {
      return { error: "Set what creators earn per approved deliverable, in whole naira" };
    }
    if (!Number.isInteger(deliverables) || deliverables <= 0) {
      return { error: "Set how many deliverables you're paying for" };
    }
    // Each deliverable is a placement, and a campaign holds at most 100.
    if (deliverables > MAX_DELIVERABLES) {
      return { error: `You can pay for up to ${MAX_DELIVERABLES} deliverables` };
    }
    const creatorBudget = rate * deliverables;
    const platformFee = roundMoney(creatorBudget * feeRate);
    if (payShape !== "hybrid") {
      return { quote: { creatorBudget, performanceBudget: 0, platformFee, total: roundMoney(creatorBudget + platformFee) } };
    }

    const bonus = checkHybridBonus(hybridBonus);
    if (bonus.error) return bonus;
    const bonusFee = roundMoney(bonus.pool * feeRate);
    return {
      quote: {
        creatorBudget,
        performanceBudget: 0,
        bonusPool: bonus.pool,
        bonusFee,
        platformFee: roundMoney(platformFee + bonusFee),
        total: roundMoney(creatorBudget + bonus.pool + platformFee + bonusFee),
      },
    };
  }
  if (payShape === "hybrid") return { error: "Hybrid pay is for content campaigns: a base per deliverable plus a bonus" };

  const referral = usesReferralTracking(objective) ? roundMoney(Number(referralBudget) || 0) : 0;
  const referralFee = roundMoney(referral * feeRate);
  // Referrals only (SPEC D31): a referral objective with no views target buys no views, just the
  // referral budget with the fee inside it. Views campaigns always need views.
  const noViews = targetViews === undefined || targetViews === null || Number(targetViews) === 0;
  // A draft can be saved before its budget is set, as a Hybrid one can; checkout refuses less than the minimum.
  if (usesReferralTracking(objective) && noViews) {
    return { quote: { creatorBudget: 0, performanceBudget: roundMoney(referral - referralFee), platformFee: referralFee, total: referral } };
  }

  const views = Number(targetViews);
  if (!Number.isFinite(views) || views <= 0) return { error: "Set how many views the campaign should reach" };
  const viewsPrice = getPriceForViews(views);
  const viewsFee = roundMoney(viewsPrice * feeRate);

  return {
    quote: {
      creatorBudget: roundMoney(viewsPrice - viewsFee),
      performanceBudget: roundMoney(referral - referralFee),
      platformFee: roundMoney(viewsFee + referralFee),
      total: roundMoney(viewsPrice + referral),
    },
  };
}

// The brand's side of a hybrid bonus: which results it pays for, the pool and the per-creator cap
// (D4). The rate per unit isn't the brand's to set (ADR 0003). Returns { metric, pool, capPerCreator } or { error }.
function checkHybridBonus(hybridBonus) {
  const { metric, pool, capPerCreator } = hybridBonus || {};
  if (!BONUS_METRICS.includes(metric)) return { error: "Choose what the bonus pays for: views, sign-ups or downloads" };
  if (!Number.isInteger(pool) || pool < MIN_BONUS_POOL) {
    return { error: `Fund a bonus pool of at least ₦${MIN_BONUS_POOL.toLocaleString()}, in whole naira` };
  }
  if (!Number.isInteger(capPerCreator) || capPerCreator <= 0) return { error: "Set the most one creator can earn in bonus, in whole naira" };
  if (capPerCreator > pool) return { error: "A creator's bonus cap can't be more than the bonus pool" };
  return { metric, pool, capPerCreator };
}

module.exports = { quoteCampaign, checkHybridBonus, bonusViewsRate, DEFAULT_PLATFORM_FEE_PERCENT, MAX_DELIVERABLES, MIN_BONUS_POOL, BONUS_METRICS };
