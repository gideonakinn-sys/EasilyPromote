// Prices a campaign. Checkout and the brand wizard both use this, so what a brand is shown
// is exactly what they're charged.
const { getPriceForViews } = require("../config/pricing");
const { OBJECTIVES, usesReferralTracking } = require("../utils/campaignObjectives");
const { roundMoney } = require("../utils/referralEarnings");

const DEFAULT_PLATFORM_FEE_PERCENT = 30;

// Returns { quote: { creatorBudget, performanceBudget, platformFee, total } } or { error }.
// - content: brand's rate × deliverables for creators; the fee is added on top (D2)
// - views: price-table price with the fee inside it, as today
// - referral objectives: views price plus the referral budget, the fee inside each, as today
function quoteCampaign({
  objective,
  payShape,
  contentPay,
  targetViews,
  referralBudget = 0,
  platformFeePercent = DEFAULT_PLATFORM_FEE_PERCENT,
}) {
  const definition = OBJECTIVES[objective];
  if (!definition) return { error: "Choose what the campaign is for" };
  if (payShape === "hybrid") return { error: "Hybrid pay (base plus bonus) isn't available yet" };
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
    const creatorBudget = rate * deliverables;
    const platformFee = roundMoney(creatorBudget * feeRate);
    return { quote: { creatorBudget, performanceBudget: 0, platformFee, total: roundMoney(creatorBudget + platformFee) } };
  }

  const views = Number(targetViews);
  if (!Number.isFinite(views) || views <= 0) return { error: "Set how many views the campaign should reach" };
  const viewsPrice = getPriceForViews(views);
  const viewsFee = roundMoney(viewsPrice * feeRate);

  const referral = usesReferralTracking(objective) ? roundMoney(Number(referralBudget) || 0) : 0;
  const referralFee = roundMoney(referral * feeRate);

  return {
    quote: {
      creatorBudget: roundMoney(viewsPrice - viewsFee),
      performanceBudget: roundMoney(referral - referralFee),
      platformFee: roundMoney(viewsFee + referralFee),
      total: roundMoney(viewsPrice + referral),
    },
  };
}

module.exports = { quoteCampaign, DEFAULT_PLATFORM_FEE_PERCENT };
