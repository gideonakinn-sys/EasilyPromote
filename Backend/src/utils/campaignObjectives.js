// What each campaign objective means for the rest of the campaign: which campaign model it
// is, what performance is measured, and who sets the creator's rate (ADR 0003).
// `available: false` objectives show as "Coming soon" and can't be created yet.
const OBJECTIVES = {
  content: { campaignModel: "content", performanceMetric: null, rateAuthority: "brand", available: true },
  views: { campaignModel: "performance", performanceMetric: "views", rateAuthority: "platform", available: true },
  downloads: { campaignModel: "performance", performanceMetric: "downloads", rateAuthority: "admin", available: true },
  signups: { campaignModel: "performance", performanceMetric: "signups", rateAuthority: "admin", available: true },
  // Coming soon (SPEC, ticket 11): likes and comments sync for TikTok and Meta posts, but there's no
  // engagement price, payout, refund or reconciliation path, shares and saves aren't stored and
  // YouTube / X posts don't sync.
  engagement: { campaignModel: "performance", performanceMetric: "engagement", rateAuthority: "platform", available: false },
  // Ticket 11: leads (the `lead` conversion event) and sales (`purchase`) are tracked like sign-ups.
  leads: { campaignModel: "performance", performanceMetric: "leads", rateAuthority: "admin", available: true },
  sales: { campaignModel: "performance", performanceMetric: "sales", rateAuthority: "admin", available: true },
  // Coming soon (SPEC, ticket 11): the webhook's `custom` event carries no description of the action,
  // so creators couldn't be told what they're paid for, nor admin price a reward for it.
  other: { campaignModel: "performance", performanceMetric: null, rateAuthority: "admin", available: false },
};

const OBJECTIVE_NAMES = Object.keys(OBJECTIVES);

// Objectives paid through referral codes and admin-set rewards (the older `objective: "actions"`).
function usesReferralTracking(objective) {
  return OBJECTIVES[objective] ? OBJECTIVES[objective].rateAuthority === "admin" : false;
}

// Campaigns created before the campaign engine only know `objective` (views | actions) and
// the referral conversion types; this reads the objective they stand for.
function objectiveForLegacy(campaign) {
  if (campaign.objective !== "actions") return "views";
  const referral = campaign.referral || {};
  const types = referral.eventTypes && referral.eventTypes.length ? referral.eventTypes : [referral.eventType];
  if (types.includes("signup")) return "signups";
  if (types.includes("install")) return "downloads";
  if (types.includes("lead")) return "leads";
  if (types.includes("purchase") || types.includes("deposit")) return "sales";
  if (types.includes("custom")) return "other";
  return "signups";
}

module.exports = { OBJECTIVES, OBJECTIVE_NAMES, usesReferralTracking, objectiveForLegacy };
