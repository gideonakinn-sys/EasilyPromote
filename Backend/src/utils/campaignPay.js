// What a campaign looks like to a creator deciding whether to join: how it's paid, what one
// unit of work earns, and how much of the brief they see before and after joining.
const { OBJECTIVES, usesReferralTracking, objectiveForLegacy } = require("./campaignObjectives");
const { campaignEventTypes } = require("./referralCodes");

const CONVERSION_UNITS = {
  install: "download",
  signup: "sign-up",
  purchase: "purchase",
  deposit: "deposit",
  custom: "action",
};

// Campaigns from before the campaign engine read as views, performance, Open Call.
function campaignTerms(campaign) {
  const objective = campaign.campaignObjective || objectiveForLegacy(campaign);
  const definition = OBJECTIVES[objective] || OBJECTIVES.views;
  const campaignModel = campaign.campaignModel || definition.campaignModel;
  return {
    objective,
    campaignModel,
    payShape: campaign.payShape || (campaignModel === "content" ? "fixed" : "performance"),
    creatorAccess: campaign.creatorAccess || "open_call",
  };
}

const roundNaira = (value) => Math.round(value * 100) / 100;

// { amount, unit } where amount is null while admin hasn't set a sign-up reward yet.
// `slot` is the placement the creator would take (views campaigns price from it).
// Hybrid campaigns (ticket 10) add `bonus`: what it pays for, the rate per unit (null while admin
// hasn't set a sign-up or download reward) and the most one creator can earn.
function payPerUnit(campaign, slot) {
  const { objective, campaignModel, payShape } = campaignTerms(campaign);

  if (campaignModel === "content") {
    const rate = (campaign.contentPay && campaign.contentPay.ratePerDeliverable) || (slot && slot.reward) || null;
    const pay = { amount: rate, unit: "approved deliverable" };
    if (payShape === "hybrid" && campaign.hybridBonus && campaign.hybridBonus.metric) pay.bonus = bonusTerms(campaign);
    return pay;
  }

  if (usesReferralTracking(objective)) {
    const reward = (campaign.referral && campaign.referral.rewardPerConversion) || 0;
    const type = campaignEventTypes(campaign)[0];
    return { amount: reward > 0 ? reward : null, unit: CONVERSION_UNITS[type] || "action" };
  }

  const reward = slot ? slot.reward : 0;
  const views = slot ? slot.viewTarget : 0;
  return { amount: reward > 0 && views > 0 ? roundNaira((reward / views) * 1000) : null, unit: "1,000 views" };
}

const BONUS_UNITS = { views: "1,000 views", signups: "sign-up", downloads: "download" };

function bonusTerms(campaign) {
  const bonus = campaign.hybridBonus;
  const rate = bonus.metric === "views" ? bonus.ratePerThousandViews : campaign.referral && campaign.referral.rewardPerConversion;
  return {
    metric: bonus.metric,
    amount: rate > 0 ? rate : null,
    unit: BONUS_UNITS[bonus.metric],
    capPerCreator: bonus.capPerCreator,
    // Whether the pool still has bonus to give.
    available: (bonus.poolRemaining || 0) > 0,
  };
}

// Shown before joining.
function briefSummary(campaign) {
  return (campaign.brief && campaign.brief.summary) || campaign.contentBrief || "";
}

// Unlocked once the creator holds a placement.
function fullBrief(campaign) {
  const brief = campaign.brief || {};
  return {
    summary: briefSummary(campaign),
    dos: brief.dos || [],
    donts: brief.donts || [],
    hashtags: brief.hashtags || [],
    soundUrl: brief.soundUrl || null,
    referenceVideos: brief.referenceVideos || [],
    tone: brief.tone || null,
    keyMessages: brief.keyMessages || [],
    productInfo: brief.productInfo || null,
    approvalRequirements: brief.approvalRequirements || null,
  };
}

// Campaign engine: content approval (ticket 07). Content campaigns pay per approved deliverable.
function isContentCampaign(campaign) {
  return Boolean(campaign) && campaignTerms(campaign).campaignModel === "content";
}

module.exports = { campaignTerms, payPerUnit, briefSummary, fullBrief, isContentCampaign };
