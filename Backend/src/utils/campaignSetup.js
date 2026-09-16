// Reads a brand's campaign setup (objective, pay, destination, access, targeting,
// eligibility, brief), enforces who may set which rate (ADR 0003) and prices it, returning
// the fields to store beside the older campaign fields (ADR 0001).
const { z } = require("zod");
const { OBJECTIVES, OBJECTIVE_NAMES, usesReferralTracking, objectiveForLegacy } = require("./campaignObjectives");
const { AGE_RANGES, CATEGORIES } = require("./creatorProfile");
const { quoteCampaign } = require("../services/campaignBudget");
const { roundMoney } = require("./referralEarnings");

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"];
const RANKS = ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"];
const BADGES = ["top_creator", "high_performer", "reliable_creator", "campaign_pro"];
const REFERRAL_EVENT_FOR = { signups: "signup", downloads: "install" };

const shortText = (max) => z.string().trim().max(max);
const textList = (maxItems, maxLength) => z.array(shortText(maxLength).min(1)).max(maxItems);

const setupSchema = z.object({
  campaignObjective: z.enum(OBJECTIVE_NAMES).optional(),
  payShape: z.enum(["fixed", "performance", "hybrid"]).optional(),
  contentPay: z.object({ ratePerDeliverable: z.number(), deliverables: z.number() }).optional(),
  contentDestination: z.enum(["creator_page", "brand_page", "both"]).optional(),
  creatorAccess: z.enum(["open_call", "application_required"]).optional(),
  audienceTargeting: z
    .object({
      locations: textList(10, 60).optional(),
      minLocationShare: z.number().int().min(0).max(100).optional(),
      ageRanges: z.array(z.enum(AGE_RANGES)).optional(),
      genders: z.array(z.enum(["all", "female", "male", "other"])).optional(),
      interests: textList(20, 40).optional(),
      platforms: z.array(z.enum(PLATFORMS)).optional(),
    })
    .optional(),
  creatorEligibility: z
    .object({
      minFollowers: z.number().int().min(0).optional(),
      minEngagementRate: z.number().min(0).max(100).optional(),
      categories: z.array(z.enum(CATEGORIES)).optional(),
      verifiedOnly: z.boolean().optional(),
      minRank: z.enum(RANKS).optional(),
      requiredBadges: z.array(z.enum(BADGES)).optional(),
    })
    .optional(),
  brief: z
    .object({
      summary: shortText(2000).optional(),
      dos: textList(10, 300).optional(),
      donts: textList(10, 300).optional(),
      hashtags: textList(20, 60).optional(),
      soundUrl: z.string().url().max(500).optional(),
      referenceVideos: z.array(z.string().url().max(500)).max(10).optional(),
      tone: shortText(100).optional(),
      keyMessages: textList(10, 300).optional(),
      productInfo: shortText(1000).optional(),
      approvalRequirements: shortText(500).optional(),
    })
    .optional(),
});

const rateError = (error) => ({ error, code: "RATE_NOT_BRAND_SET", status: 400 });
const badRequest = (error) => ({ error, status: 400 });

// `body` is the request; `current` is the stored campaign when editing (null when creating).
// Returns { error, code?, status } or { updates, quote, legacyObjective, referralEventTypes }.
function resolveCampaignSetup(body, current = null) {
  const parsed = setupSchema.safeParse(body || {});
  if (!parsed.success) return badRequest(parsed.error.errors[0].message);
  const input = parsed.data;
  const referralInput = (body && body.referral) || {};

  if (body.costPerView !== undefined) {
    return rateError("The price per view comes from EasilyPromote's price table and can't be set");
  }
  if (referralInput.rewardPerConversion !== undefined) {
    return rateError("The reward per conversion is set by the EasilyPromote team and can't be set by brands");
  }

  // Precedence: an objective from the new setup, then an older client changing `objective`
  // or the conversion types, then what's stored.
  const legacyChange = body.objective !== undefined || referralInput.enabled !== undefined || referralInput.eventTypes || referralInput.eventType;
  const legacyObjective = body.objective !== undefined ? body.objective : referralInput.enabled !== undefined ? (referralInput.enabled ? "actions" : "views") : current ? current.objective : "views";
  const objective =
    input.campaignObjective ||
    (legacyChange || !(current && current.campaignObjective)
      ? objectiveForLegacy({
          objective: legacyObjective,
          referral: referralInput.eventTypes || referralInput.eventType ? referralInput : current ? current.referral : {},
        })
      : current.campaignObjective);
  const definition = OBJECTIVES[objective];
  // Older clients can still create what they always could (e.g. purchase tracking); only
  // an objective chosen in the new setup has to be one that's open.
  if (!definition.available && input.campaignObjective) {
    return badRequest(`${objective[0].toUpperCase()}${objective.slice(1)} campaigns aren't available yet`);
  }
  if (definition.rateAuthority !== "brand" && input.contentPay !== undefined) {
    return rateError("Only content campaigns let the brand set what creators earn");
  }

  const isContent = definition.campaignModel === "content";
  const payShape = input.payShape || (current && current.campaignObjective === objective && current.payShape) || (isContent ? "fixed" : "performance");
  if (payShape !== "hybrid" && (payShape === "fixed") !== isContent) {
    return badRequest(isContent ? "Content campaigns pay a fixed rate per deliverable" : "Performance campaigns pay per verified result");
  }

  const contentPay = isContent ? input.contentPay || (current && current.contentPay && current.contentPay.ratePerDeliverable ? current.contentPay : undefined) : undefined;
  const targetViews = body.targetViews !== undefined ? body.targetViews : current ? current.targetViews : undefined;
  const referralBudget =
    referralInput.requestedBudget !== undefined ? referralInput.requestedBudget : current && current.referral ? current.referral.requestedBudget : 0;

  const priced = quoteCampaign({
    objective,
    payShape,
    contentPay: contentPay && { ratePerDeliverable: contentPay.ratePerDeliverable, deliverables: contentPay.deliverables },
    targetViews,
    referralBudget: usesReferralTracking(objective) ? referralBudget : 0,
    platformFeePercent: current && Number.isFinite(current.platformFeePercent) ? current.platformFeePercent : undefined,
  });
  if (priced.error) return badRequest(priced.error);
  const { quote } = priced;

  const classification = {
    campaignObjective: objective,
    campaignModel: definition.campaignModel,
    payShape,
    rateAuthority: definition.rateAuthority,
    performanceMetric: definition.performanceMetric,
  };

  const details = {
    contentDestination: input.contentDestination || (current && current.contentDestination) || "creator_page",
    creatorAccess: input.creatorAccess || (current && current.creatorAccess) || "open_call",
  };
  if (input.audienceTargeting !== undefined) details.audienceTargeting = input.audienceTargeting;
  if (input.creatorEligibility !== undefined) details.creatorEligibility = input.creatorEligibility;
  if (input.brief !== undefined) details.brief = input.brief;

  // Content: the quote as-is. Performance: `budget` stays the views price (the referral
  // budget is booked separately at payment), with the fee inside it.
  const money = {};
  if (isContent) {
    money.contentPay = { ratePerDeliverable: contentPay.ratePerDeliverable, deliverables: contentPay.deliverables };
    money.budget = quote.total;
    money.creatorPool = quote.creatorBudget;
    money.platformFee = quote.platformFee;
    money.costPerView = 0;
  } else {
    const referralPart = usesReferralTracking(objective) ? roundMoney(Number(referralBudget) || 0) : 0;
    money.budget = roundMoney(quote.total - referralPart);
    money.creatorPool = quote.creatorBudget;
    money.platformFee = roundMoney(money.budget - quote.creatorBudget);
    money.costPerView = Math.round((money.budget / targetViews) * 1000) / 1000;
  }

  return {
    classification,
    details,
    money,
    updates: { ...classification, ...details, ...money },
    quote,
    legacyObjective: usesReferralTracking(objective) ? "actions" : "views",
    // Only a newly chosen objective sets conversion types; older clients keep the ones they sent or stored.
    referralEventTypes:
      input.campaignObjective && REFERRAL_EVENT_FOR[objective] && !referralInput.eventTypes && !referralInput.eventType
        ? [REFERRAL_EVENT_FOR[objective]]
        : null,
  };
}

// Referral tracking follows the older objective: actions turn it on; views turn it off and
// clear the referral budget.
function legacyObjectiveUpdates(objective) {
  const next = objective === "actions" ? "actions" : "views";
  return {
    objective: next,
    "referral.enabled": next === "actions",
    ...(next === "views" && { "referral.requestedBudget": 0 }),
  };
}

// Updates for editing a stored campaign. Only what the request touches changes: a rename
// never reprices a campaign or resets its checkout. Returns { error, code?, status } or
// { updates, priceChanged }.
function editSetupUpdates(body, campaign) {
  const setup = resolveCampaignSetup(body, campaign);
  if (setup.error) return setup;
  const referral = body.referral || {};

  const objectiveChanged =
    body.campaignObjective !== undefined ||
    body.objective !== undefined ||
    referral.enabled !== undefined ||
    referral.eventTypes !== undefined ||
    referral.eventType !== undefined;
  const modelChanged = setup.classification.campaignModel !== campaign.campaignModel;
  const isContent = setup.classification.campaignModel === "content";
  const moneyChanged =
    modelChanged ||
    body.contentPay !== undefined ||
    body.payShape !== undefined ||
    (!isContent && body.targetViews !== undefined);

  const updates = {};
  const needsClassification = objectiveChanged || modelChanged || body.payShape !== undefined || !campaign.campaignObjective;
  if (needsClassification) Object.assign(updates, setup.classification);
  if (objectiveChanged) {
    Object.assign(updates, legacyObjectiveUpdates(setup.legacyObjective));
    if (setup.referralEventTypes) {
      updates["referral.eventTypes"] = setup.referralEventTypes;
      updates["referral.eventType"] = setup.referralEventTypes[0];
    }
  }
  for (const [key, value] of Object.entries(setup.details)) {
    if (body[key] !== undefined || !campaign[key]) updates[key] = value;
  }
  if (moneyChanged) {
    Object.assign(updates, setup.money);
    if (isContent) updates.$unset = { targetViews: 1 };
    else if (body.targetViews !== undefined) updates.targetViews = body.targetViews;
  }

  const priceChanged = moneyChanged && setup.money.budget !== campaign.budget;
  return { updates, priceChanged, isContent };
}

// The campaign engine fields as returned to the brand.
function campaignSetupView(campaign) {
  const plain = typeof campaign.toObject === "function" ? campaign.toObject() : campaign;
  return {
    campaignObjective: plain.campaignObjective || null,
    campaignModel: plain.campaignModel || null,
    payShape: plain.payShape || null,
    rateAuthority: plain.rateAuthority || null,
    performanceMetric: plain.performanceMetric || null,
    contentPay: plain.contentPay && plain.contentPay.ratePerDeliverable ? plain.contentPay : null,
    contentDestination: plain.contentDestination || null,
    creatorAccess: plain.creatorAccess || null,
    audienceTargeting: plain.audienceTargeting || {},
    creatorEligibility: plain.creatorEligibility || {},
    brief: plain.brief || {},
  };
}

module.exports = { resolveCampaignSetup, editSetupUpdates, legacyObjectiveUpdates, campaignSetupView };
