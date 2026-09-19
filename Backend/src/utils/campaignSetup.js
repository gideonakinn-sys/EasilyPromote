// Reads a brand's campaign setup (objective, pay, destination, access, targeting,
// eligibility, brief), enforces who may set which rate (ADR 0003) and prices it, returning
// the fields to store beside the older campaign fields (ADR 0001).
const { z } = require("zod");
const { OBJECTIVES, OBJECTIVE_NAMES, usesReferralTracking, objectiveForLegacy, isReferralsOnly } = require("./campaignObjectives");
const { AGE_RANGES, CATEGORIES } = require("./creatorProfile");
const { quoteCampaign, bonusViewsRate, DEFAULT_PLATFORM_FEE_PERCENT } = require("../services/campaignBudget");
const { roundMoney } = require("./referralEarnings");

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"];
const RANKS = ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"];
const BADGES = ["top_creator", "high_performer", "reliable_creator", "campaign_pro"];
// The conversion event each referral objective counts (ticket 11 adds leads and sales; M8 batch 7 adds clicks).
const REFERRAL_EVENT_FOR = { signups: "signup", downloads: "install", leads: "lead", sales: "purchase", clicks: "click" };
// Hybrid pay (ticket 10): destinations where a creator's own post can earn a views bonus.
const VIEWS_BONUS_DESTINATIONS = ["creator_page", "both"];

const shortText = (max) => z.string().trim().max(max);
const textList = (maxItems, maxLength) => z.array(shortText(maxLength).min(1)).max(maxItems);

const audienceTargetingSchema = z.object({
  locations: textList(10, 60).optional(),
  ageRanges: z.array(z.enum(AGE_RANGES)).optional(),
  genders: z.array(z.enum(["all", "female", "male", "other"])).optional(),
  interests: textList(20, 40).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  // M8 batch 7: opt-in hard filters (SPEC D8 amended).
  requireAgeMatch: z.boolean().optional(),
  minAgeShare: z.number().int().min(0).max(100).optional(),
  requireGenderMatch: z.boolean().optional(),
  minGenderShare: z.number().int().min(0).max(100).optional(),
});

const creatorEligibilitySchema = z.object({
  minFollowers: z.number().int().min(0).optional(),
  minEngagementRate: z.number().min(0).max(100).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  verifiedOnly: z.boolean().optional(),
  minRank: z.enum(RANKS).optional(),
  requiredBadges: z.array(z.enum(BADGES)).optional(),
});

// The wizard's live "about N creators match" count reads just these two (ticket 11).
const matchCountSchema = z.object({
  audienceTargeting: audienceTargetingSchema.optional(),
  creatorEligibility: creatorEligibilitySchema.optional(),
});

const setupSchema = z.object({
  campaignObjective: z.enum(OBJECTIVE_NAMES).optional(),
  payShape: z.enum(["fixed", "performance", "hybrid"]).optional(),
  // null clears a draft's pay.
  contentPay: z.object({ ratePerDeliverable: z.number(), deliverables: z.number() }).nullable().optional(),
  // Hybrid pay (ticket 10): what the bonus pays for, its pool and the per-creator cap. null clears it.
  hybridBonus: z.object({ metric: z.string(), pool: z.number(), capPerCreator: z.number() }).nullable().optional(),
  wizardStep: z.number().int().min(1).max(6).optional(),
  contentDestination: z.enum(["creator_page", "brand_page", "both"]).optional(),
  creatorAccess: z.enum(["open_call", "application_required"]).optional(),
  audienceTargeting: audienceTargetingSchema.optional(),
  creatorEligibility: creatorEligibilitySchema.optional(),
  brief: z
    .object({
      // The wizard's Creator Brief text area allows 4000 characters.
      summary: shortText(4000).optional(),
      dos: textList(10, 300).optional(),
      donts: textList(10, 300).optional(),
      // Campaign engine: content approval (ticket 07): a hashtag is one word (hyphens allowed),
      // because a live caption is checked for each one.
      hashtags: z
        .array(
          shortText(60)
            .min(1)
            .refine((tag) => !/\s/.test(tag), "Hashtags can't contain spaces. Use one word per hashtag, like #SummerDrop")
            .refine((tag) => /^#*[\p{L}\p{M}\p{N}_-]+$/u.test(tag), "Hashtags can only use letters, numbers, _ and -")
        )
        .max(20)
        .optional(),
      soundUrl: z.string().url().max(500).optional(),
      referenceVideos: z.array(z.string().url().max(500)).max(10).optional(),
      tone: shortText(100).optional(),
      keyMessages: textList(10, 300).optional(),
      productInfo: shortText(1000).optional(),
      approvalRequirements: shortText(500).optional(),
      // Write-the-brief step: persisted so drafts restore exactly where the brand left them.
      briefMode: z.enum(["write", "upload"]).optional(),
      keyMessage: shortText(300).optional(),
      contentTypes: z.array(shortText(50)).max(20).optional(),
      toneDosDonts: shortText(2000).optional(),
      deliverablesLength: shortText(40).optional(),
      submissionDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The deadline must be a date (YYYY-MM-DD)").optional(),
      usageRightsChoice: z.enum(["campaign", "paid_ads", "anywhere"]).optional(),
      disputeWindow: z.enum(["24h", "48h", "72h"]).optional(),
    })
    .optional(),
  // M8 batch 7: clicks campaigns redirect to this URL (SPEC D29).
  destinationUrl: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((value) => /^https?:$/.test(new URL(value).protocol), "The destination link must start with http:// or https://")
    .optional()
    .nullable(),
  // M8 batch 7: custom usage-rights terms (SPEC D30).
  usageRights: z
    .object({
      type: z.enum(["standard", "custom"]).optional(),
      terms: z
        .object({
          duration: z.enum(["perpetual", "3_months", "6_months", "12_months", "24_months"]).optional(),
          exclusivity: z.enum(["none", "category"]).optional(),
          exclusivityPeriod: z.string().max(100).nullable().optional(),
          paidAdsAllowed: z.boolean().optional(),
          territories: z.array(z.string().max(100)).max(50).optional(),
          additionalTerms: z.string().max(1000).nullable().optional(),
        })
        .optional(),
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
  const bonusInput = body && body.hybridBonus;
  if (bonusInput && (bonusInput.ratePerThousandViews !== undefined || bonusInput.rewardPerConversion !== undefined)) {
    return rateError("A bonus rate comes from EasilyPromote's price table or our team; brands set the pool and the cap");
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
  // Sending back the objective a campaign already has isn't choosing one.
  const objectiveChosen = Boolean(input.campaignObjective) && !(current && current.campaignObjective === input.campaignObjective);
  // Older clients can still create what they always could (e.g. purchase tracking); only
  // an objective chosen in the new setup has to be one that's open.
  if (!definition.available && objectiveChosen) {
    return badRequest(`${objective[0].toUpperCase()}${objective.slice(1)} campaigns aren't available yet`);
  }
  if (definition.rateAuthority !== "brand" && input.contentPay !== undefined && input.contentPay !== null) {
    return rateError("Only content campaigns let the brand set what creators earn");
  }

  const isContent = definition.campaignModel === "content";
  const payShape = input.payShape || (current && current.campaignObjective === objective && current.payShape) || (isContent ? "fixed" : "performance");
  // Hybrid is a content campaign's pay: a base per deliverable plus a bonus (ticket 10).
  if (payShape === "hybrid" && !isContent) return badRequest("Hybrid pay is for content campaigns: a base per deliverable plus a bonus");
  if (payShape !== "hybrid" && (payShape === "fixed") !== isContent) {
    return badRequest(isContent ? "Content campaigns pay a fixed rate per deliverable" : "Performance campaigns pay per verified result");
  }
  const isHybrid = payShape === "hybrid";

  const storedPay = current && current.contentPay && current.contentPay.ratePerDeliverable ? current.contentPay : undefined;
  const contentPay = isContent ? (input.contentPay === null ? undefined : input.contentPay || storedPay) : undefined;
  const storedBonus = current && current.hybridBonus && current.hybridBonus.metric ? current.hybridBonus : undefined;
  const hybridBonus = isHybrid ? (input.hybridBonus === null ? undefined : input.hybridBonus || storedBonus) : undefined;
  const targetViews = body.targetViews !== undefined ? body.targetViews : current ? current.targetViews : undefined;
  // Referrals only (SPEC D31): a referral objective with no views target (null or 0 clears a draft's).
  const referralsOnly = isReferralsOnly({ campaignModel: definition.campaignModel, campaignObjective: objective, targetViews });
  const referralBudget =
    referralInput.requestedBudget !== undefined ? referralInput.requestedBudget : current && current.referral ? current.referral.requestedBudget : 0;

  // A content draft can be saved before the brand sets its pay; it's unpriced until then
  // and checkout refuses it.
  const unpriced = isContent && (!contentPay || (isHybrid && !hybridBonus));
  const priced = unpriced ? { quote: null } : quoteCampaign({
    objective,
    payShape,
    contentPay: contentPay && { ratePerDeliverable: contentPay.ratePerDeliverable, deliverables: contentPay.deliverables },
    hybridBonus: hybridBonus && { metric: hybridBonus.metric, pool: hybridBonus.pool, capPerCreator: hybridBonus.capPerCreator },
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

  // Where content goes (and the usage rights that come with the brand's page) is only a Content campaign's
  // question (SPEC D31): every other objective posts on the creator's own page.
  const details = {
    contentDestination: isContent ? input.contentDestination || (current && current.contentDestination) || "creator_page" : "creator_page",
    creatorAccess: input.creatorAccess || (current && current.creatorAccess) || "open_call",
  };
  // A views bonus is earned on the creator's own post, so content only delivered to the brand can't earn one.
  if (hybridBonus && hybridBonus.metric === "views" && !VIEWS_BONUS_DESTINATIONS.includes(details.contentDestination)) {
    return badRequest("A views bonus needs creators to post on their own page. Choose creator page or both, or a sign-up or download bonus");
  }
  if (input.audienceTargeting !== undefined) details.audienceTargeting = input.audienceTargeting;
  if (input.creatorEligibility !== undefined) details.creatorEligibility = input.creatorEligibility;
  if (input.brief !== undefined) details.brief = input.brief;
  // M8 batch 7: clicks campaigns require a destination URL.
  if (input.destinationUrl !== undefined) {
    details.destinationUrl = input.destinationUrl;
  } else if (current && current.destinationUrl) {
    details.destinationUrl = current.destinationUrl;
  }
  if (objective === "clicks" && !details.destinationUrl) {
    // Only enforce when the wizard explicitly chose clicks (not on a draft save with no objective yet).
    if (objectiveChosen) return badRequest("Add a destination URL for people who click the link");
  }
  // M8 batch 7: custom usage-rights terms. A Content draft changed to another objective goes back to the
  // standard licence (SPEC D31): the wizard only asks about rights for Content, so terms set there would
  // otherwise stay behind for creators to accept.
  const leavingContent = !isContent && current && current.campaignModel === "content";
  if (leavingContent && input.usageRights === undefined) {
    const prev = current.usageRights;
    if (prev && prev.type === "custom") details.usageRights = { type: "standard", version: prev.version || 1, terms: {} };
  } else if (input.usageRights !== undefined) {
    const prev = current && current.usageRights;
    const merged = {
      type: (input.usageRights && input.usageRights.type) || (prev && prev.type) || "standard",
      version: (prev && prev.version) || 1,
      terms: { ...((prev && prev.terms) || {}), ...((input.usageRights && input.usageRights.terms) || {}) },
    };
    details.usageRights = merged;
  } else if (current && current.usageRights && current.usageRights.type) {
    details.usageRights = current.usageRights;
  }

  // Content: the quote as-is. Performance: `budget` stays the views price (the referral
  // budget is booked separately at payment), with the fee inside it.
  const money = {};
  if (unpriced) {
    // A hybrid draft with its base set but not its bonus keeps the base.
    if (contentPay) money.contentPay = { ratePerDeliverable: contentPay.ratePerDeliverable, deliverables: contentPay.deliverables };
    money.budget = 0;
    money.creatorPool = 0;
    money.platformFee = 0;
    money.costPerView = 0;
  } else if (isContent) {
    money.contentPay = { ratePerDeliverable: contentPay.ratePerDeliverable, deliverables: contentPay.deliverables };
    money.costPerView = 0;
    money.creatorPool = quote.creatorBudget;
    if (isHybrid) {
      // The base is the fixed pot, exactly as a fixed-pay campaign (budget, creatorPool, platformFee);
      // the bonus pool and its fee are booked to their own pot. The checkout charges both.
      const baseFee = roundMoney(quote.platformFee - quote.bonusFee);
      money.budget = roundMoney(quote.creatorBudget + baseFee);
      money.platformFee = baseFee;
      const feePercent = current && Number.isFinite(current.platformFeePercent) ? current.platformFeePercent : DEFAULT_PLATFORM_FEE_PERCENT;
      money.hybridBonus = {
        metric: hybridBonus.metric,
        pool: quote.bonusPool,
        capPerCreator: hybridBonus.capPerCreator,
        platformFee: quote.bonusFee,
        ratePerThousandViews: hybridBonus.metric === "views" ? bonusViewsRate(feePercent) : 0,
        poolRemaining: quote.bonusPool,
        reserved: 0,
        refundedPool: 0,
      };
    } else {
      money.budget = quote.total;
      money.platformFee = quote.platformFee;
    }
  } else if (referralsOnly) {
    // No views bought: the referral budget is booked to its own pot at payment, so the views money is all 0.
    money.budget = 0;
    money.creatorPool = 0;
    money.platformFee = 0;
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
    // Sign-up and download bonuses are verified through referral codes, like referral campaigns, but
    // paid from the bonus pool: tracking is on with no referral budget.
    bonusReferralEventTypes: hybridBonus && REFERRAL_EVENT_FOR[hybridBonus.metric] ? [REFERRAL_EVENT_FOR[hybridBonus.metric]] : null,
    isHybrid,
    referralsOnly,
    // Only a newly chosen objective sets conversion types; older clients keep the ones they sent or stored.
    unpriced,
    referralEventTypes:
      objectiveChosen && REFERRAL_EVENT_FOR[objective] && !referralInput.eventTypes && !referralInput.eventType
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
    (body.campaignObjective !== undefined && body.campaignObjective !== campaign.campaignObjective) ||
    body.objective !== undefined ||
    referral.enabled !== undefined ||
    referral.eventTypes !== undefined ||
    referral.eventType !== undefined;
  const modelChanged = setup.classification.campaignModel !== campaign.campaignModel;
  const isContent = setup.classification.campaignModel === "content";
  const moneyChanged =
    modelChanged ||
    body.contentPay !== undefined ||
    body.hybridBonus !== undefined ||
    // A views bonus depends on where content goes.
    (setup.isHybrid && body.contentDestination !== undefined) ||
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
    // A campaign that isn't Content always posts on the creator's page with standard rights (SPEC D31).
    const nonContentReset = !isContent && ((key === "contentDestination" && campaign[key] !== value) || (key === "usageRights" && modelChanged));
    if (body[key] !== undefined || !campaign[key] || nonContentReset) updates[key] = value;
  }
  if (moneyChanged) {
    Object.assign(updates, setup.money);
    const clearBonus = Boolean(campaign.hybridBonus) && !setup.money.hybridBonus;
    if (isContent) updates.$unset = { targetViews: 1, ...(setup.unpriced && !setup.money.contentPay && { contentPay: 1 }), ...(clearBonus && { hybridBonus: 1 }) };
    else {
      if (clearBonus) updates.$unset = { hybridBonus: 1 };
      // Referrals only (D31) keeps no views target; a Hybrid draft moving to it clears the stored one.
      if (setup.referralsOnly) updates.$unset = { ...updates.$unset, targetViews: 1 };
      else if (body.targetViews !== undefined) updates.targetViews = body.targetViews;
    }
  }
  // Referral tracking follows a sign-up or download bonus, and goes off when a hybrid campaign stops having one.
  const wasBonusTracking = Boolean(campaign.hybridBonus && REFERRAL_EVENT_FOR[campaign.hybridBonus.metric]);
  if (setup.bonusReferralEventTypes) {
    updates["referral.enabled"] = true;
    updates["referral.requestedBudget"] = 0;
    updates["referral.eventTypes"] = setup.bonusReferralEventTypes;
    updates["referral.eventType"] = setup.bonusReferralEventTypes[0];
  } else if (moneyChanged && wasBonusTracking && setup.legacyObjective !== "actions") {
    updates["referral.enabled"] = false;
  }

  // A hybrid campaign's checkout also charges its bonus pool and fee, so a new pool is a new price too.
  const bonusTotal = (bonus) => (bonus && bonus.metric ? roundMoney(bonus.pool + (bonus.platformFee || 0)) : 0);
  const priceChanged = moneyChanged && (setup.money.budget !== campaign.budget || bonusTotal(setup.money.hybridBonus) !== bonusTotal(campaign.hybridBonus));
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
    hybridBonus:
      plain.hybridBonus && plain.hybridBonus.metric
        ? {
            metric: plain.hybridBonus.metric,
            pool: plain.hybridBonus.pool,
            capPerCreator: plain.hybridBonus.capPerCreator,
            platformFee: plain.hybridBonus.platformFee || 0,
            ratePerThousandViews: plain.hybridBonus.ratePerThousandViews || 0,
          }
        : null,
    contentDestination: plain.contentDestination || null,
    creatorAccess: plain.creatorAccess || null,
    audienceTargeting: plain.audienceTargeting || {},
    creatorEligibility: plain.creatorEligibility || {},
    brief: plain.brief || {},
    destinationUrl: plain.destinationUrl || null,
    usageRights: plain.usageRights && plain.usageRights.type ? plain.usageRights : null,
  };
}

module.exports = { resolveCampaignSetup, editSetupUpdates, legacyObjectiveUpdates, campaignSetupView, matchCountSchema };
