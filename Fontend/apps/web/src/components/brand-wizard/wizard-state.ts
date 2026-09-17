import type {
  BonusMetric,
  CampaignBrief,
  CampaignObjective,
  CampaignSetup,
  ContentDestination,
  CreatorAccess,
} from "../types";
import { MIN_REFERRAL_BUDGET } from "../../lib/referral";
import type { CampaignUsageRights, UsageRightsDuration, UsageRightsExclusivity, UsageRightsType } from "../types";

// The five setup steps, then review and payment.
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export const WIZARD_STEPS: { step: WizardStep; title: string; short: string }[] = [
  { step: 1, title: "Objective", short: "Objective" },
  { step: 2, title: "Destination and access", short: "Access" },
  { step: 3, title: "Audience and creators", short: "Audience" },
  { step: 4, title: "Pay and budget", short: "Budget" },
  { step: 5, title: "Brief", short: "Brief" },
  { step: 6, title: "Review and launch", short: "Launch" },
];

export const OBJECTIVE_OPTIONS: { value: CampaignObjective; title: string; body: string; available: boolean }[] = [
  { value: "content", title: "Content", body: "Pay creators a set amount for each video you approve.", available: true },
  { value: "views", title: "Views", body: "Creators post about you and you pay for the views they deliver.", available: true },
  { value: "downloads", title: "Downloads", body: "Pay for app installs, tracked with a code for each creator.", available: true },
  { value: "signups", title: "Sign-ups", body: "Pay for people who sign up, tracked with a code for each creator.", available: true },
  { value: "leads", title: "Leads", body: "Pay for people who show interest, like filling in a form, tracked with a code for each creator.", available: true },
  { value: "sales", title: "Sales", body: "Pay for purchases made with a creator's code, reported by your app or website.", available: true },
  {
    value: "clicks",
    title: "Clicks",
    body: "Paid per valid click on a creator's tracked link to your website. Our team sets the reward per click.",
    available: true,
  },
  // Coming soon (SPEC, ticket 11): why is said on the card.
  {
    value: "engagement",
    title: "Engagement",
    body: "Pay for likes, comments and shares. We can't yet verify these on every platform or pay for them.",
    available: false,
  },
  {
    value: "other",
    title: "Other",
    body: "Pay for another action. We can't yet describe and verify an action of your choosing.",
    available: false,
  },
];

export const DESTINATION_OPTIONS: { value: ContentDestination; title: string; body: string }[] = [
  { value: "creator_page", title: "Creator's page", body: "Creators post the content on their own accounts." },
  { value: "brand_page", title: "Your page", body: "Creators send you the content and you post it on your accounts." },
  { value: "both", title: "Both", body: "Creators post on their accounts and you can post it on yours too." },
];

// Standard usage rights for content that goes to the brand's page (decision D6).
export const USAGE_RIGHTS_TEXT =
  "You get the standard usage rights: you can use the content on your own social channels, in posts and in paid ads, for as long as you like. The rights aren't exclusive, so the creator can still show the work they made.";

export const ACCESS_OPTIONS: { value: CreatorAccess; title: string; body: string }[] = [
  {
    value: "open_call",
    title: "Open Call",
    body: "Any creator who meets your requirements can join straight away. Good when you want to move fast.",
  },
  {
    value: "application_required",
    title: "Application Required",
    body: "Creators apply and you choose who takes part. Good when you want to pick each creator yourself.",
  },
];

export const PLATFORM_OPTIONS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "twitter", label: "X (Twitter)" },
];

export const AGE_RANGE_OPTIONS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55+"];

export const GENDER_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "female", label: "Women" },
  { value: "male", label: "Men" },
];

// Must match the creator categories the API accepts.
export const CREATOR_CATEGORIES = [
  "Fashion",
  "Beauty",
  "Music",
  "Comedy",
  "Lifestyle",
  "Finance",
  "Gaming",
  "Food",
  "Sports",
  "Tech",
  "Education",
  "Business",
  "Other",
];

export const RANK_OPTIONS = [
  { value: "", label: "Any rank" },
  { value: "rank1", label: "Rank 1 or higher" },
  { value: "rank2", label: "Rank 2 or higher" },
  { value: "rank3", label: "Rank 3 or higher" },
  { value: "rank4", label: "Rank 4 or higher" },
  { value: "rank5", label: "Rank 5 or higher" },
  { value: "elite", label: "Elite" },
];

export const BADGE_OPTIONS = [
  { value: "top_creator", label: "Top Creator" },
  { value: "high_performer", label: "High Performer" },
  { value: "reliable_creator", label: "Reliable Creator" },
  { value: "campaign_pro", label: "Campaign Pro" },
];

export const MIN_VIEWS = 100000;
export const MAX_DELIVERABLES = 100;
// Hybrid pay (ticket 10): the smallest bonus pool, as the API takes it.
export const MIN_BONUS_POOL = 1000;

export type ContentPayShape = "fixed" | "hybrid";

export const PAY_SHAPE_OPTIONS: { value: ContentPayShape; title: string; body: string }[] = [
  { value: "fixed", title: "Fixed", body: "A set amount for each deliverable you approve." },
  { value: "hybrid", title: "Hybrid", body: "A base for each deliverable you approve, plus a bonus as results come in." },
];

export const BONUS_METRIC_OPTIONS: { value: BonusMetric; title: string; body: string }[] = [
  { value: "views", title: "Views", body: "Creators earn per 1,000 verified views on their live post, at our price table's rate." },
  { value: "signups", title: "Sign-ups", body: "Creators earn per sign-up with their code. Our team sets the reward." },
  { value: "downloads", title: "Downloads", body: "Creators earn per app install with their code. Our team sets the reward." },
];
const DEFAULT_VIEWS = 1000000;
const REFERRAL_OBJECTIVES: CampaignObjective[] = ["signups", "downloads", "leads", "sales", "clicks"];

// What one tracked result of a referral objective is called: "sign-up", "downloads", "lead", "purchases".
const ACTION_NOUNS: Partial<Record<CampaignObjective | BonusMetric, [string, string]>> = {
  signups: ["sign-up", "sign-ups"],
  downloads: ["download", "downloads"],
  leads: ["lead", "leads"],
  sales: ["purchase", "purchases"],
  clicks: ["click", "clicks"],
};

export function actionNoun(objective: CampaignObjective | BonusMetric | null | undefined, plural = false): string {
  const nouns = (objective && ACTION_NOUNS[objective]) || ACTION_NOUNS.signups!;
  return plural ? nouns[1] : nouns[0];
}

export interface WizardBrief {
  summary: string;
  dos: string[];
  donts: string[];
  hashtags: string[];
  soundUrl: string;
  referenceVideos: string[];
  tone: string;
  keyMessages: string[];
  productInfo: string;
  approvalRequirements: string;
}

export interface WizardData {
  name: string;
  category: string;
  coverImageUrl: string;
  objective: CampaignObjective;
  contentDestination: ContentDestination;
  creatorAccess: CreatorAccess;
  locations: string[];
  minLocationShare: string;
  ageRanges: string[];
  genders: string[];
  interests: string[];
  platforms: string[];
  minFollowers: string;
  minEngagementRate: string;
  categories: string[];
  verifiedOnly: boolean;
  minRank: string;
  requiredBadges: string[];
  // Content: the brand sets the rate (ADR 0003), so it's never prefilled. A draft can be
  // saved without it.
  ratePerDeliverable: string;
  deliverables: string;
  // Hybrid pay (ticket 10): the brand funds a bonus pool and caps what one creator can earn from it;
  // the bonus rate is never the brand's to set.
  payShape: ContentPayShape;
  bonusMetric: BonusMetric;
  bonusPool: string;
  bonusCap: string;
  // Views and referral objectives: views from the price table.
  views: number;
  referralBudget: string;
  brief: WizardBrief;
  scriptUrl: string;
  scriptFileName: string;
  // Niches from the older wizard that aren't creator categories; kept on save.
  otherNiches: string[];
  // Clicks (SPEC D29): the http/https page creators' tracked links send people to.
  destinationUrl: string;
  // M8 (SPEC D8 amended): opt-in hard filters for age and gender. Shares are whole percents as typed.
  requireAgeMatch: boolean;
  minAgeShare: string;
  requireGenderMatch: boolean;
  minGenderShare: string;
  // Usage rights for content on the brand's page (SPEC D6, D30): the standard licence or custom terms.
  usageRightsType: UsageRightsType;
  usageDuration: UsageRightsDuration;
  usageExclusivity: UsageRightsExclusivity;
  usageExclusivityPeriod: string;
  usagePaidAds: boolean;
  usageWorldwide: boolean;
  // Countries, comma-separated, when not worldwide.
  usageTerritories: string;
  usageAdditionalTerms: string;
}

export const EMPTY_BRIEF: WizardBrief = {
  summary: "",
  dos: [],
  donts: [],
  hashtags: [],
  soundUrl: "",
  referenceVideos: [],
  tone: "",
  keyMessages: [],
  productInfo: "",
  approvalRequirements: "",
};

// The share a hard age or gender filter asks for when the brand doesn't change it (matches the API).
export const DEFAULT_HARD_FILTER_SHARE = 50;

// Genders a hard filter can require: "Everyone" isn't one.
export const specificGenders = (genders: string[]) => genders.filter((gender) => gender !== "all");

// Whether each hard filter is on and has something to match.
export const ageFilterActive = (data: WizardData) => data.requireAgeMatch && data.ageRanges.length > 0;
export const genderFilterActive = (data: WizardData) => data.requireGenderMatch && specificGenders(data.genders).length > 0;

export const INITIAL_WIZARD_DATA: WizardData = {
  name: "",
  category: "Music",
  coverImageUrl: "",
  objective: "content",
  contentDestination: "creator_page",
  creatorAccess: "open_call",
  locations: [],
  minLocationShare: "",
  ageRanges: [],
  genders: ["all"],
  interests: [],
  platforms: ["tiktok", "instagram"],
  minFollowers: "",
  minEngagementRate: "",
  categories: [],
  verifiedOnly: false,
  minRank: "",
  requiredBadges: [],
  ratePerDeliverable: "",
  deliverables: "",
  payShape: "fixed",
  bonusMetric: "views",
  bonusPool: "",
  bonusCap: "",
  views: DEFAULT_VIEWS,
  referralBudget: "",
  brief: EMPTY_BRIEF,
  scriptUrl: "",
  scriptFileName: "",
  otherNiches: [],
  destinationUrl: "",
  requireAgeMatch: false,
  minAgeShare: String(DEFAULT_HARD_FILTER_SHARE),
  requireGenderMatch: false,
  minGenderShare: String(DEFAULT_HARD_FILTER_SHARE),
  usageRightsType: "standard",
  usageDuration: "perpetual",
  usageExclusivity: "none",
  usageExclusivityPeriod: "",
  usagePaidAds: true,
  usageWorldwide: true,
  usageTerritories: "",
  usageAdditionalTerms: "",
};

export function usesReferralBudget(objective: CampaignObjective): boolean {
  return REFERRAL_OBJECTIVES.includes(objective);
}

export function isHybrid(data: WizardData): boolean {
  return data.objective === "content" && data.payShape === "hybrid";
}

// Whether the brand's app has to be connected before paying: referral objectives, and hybrid
// campaigns whose bonus pays for sign-ups or downloads. Clicks are tracked by us (SPEC D29), so they don't need it.
export function tracksConversions(data: WizardData): boolean {
  if (data.objective === "clicks") return false;
  return usesReferralBudget(data.objective) || (isHybrid(data) && data.bonusMetric !== "views");
}

export function isObjectiveAvailable(objective: CampaignObjective): boolean {
  return OBJECTIVE_OPTIONS.some((option) => option.value === objective && option.available);
}

const wholeNumber = (value: string) => {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

const isUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// Mirrors the API: a full web address starting with http:// or https://, up to 2,000 characters.
export function isDestinationUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 2000 && /^https?:\/\//i.test(trimmed) && isUrl(trimmed);
}

export function referralBudgetValue(data: WizardData): number {
  return Math.round(Number(data.referralBudget) || 0);
}

// Returns what's missing on a step, or an empty list when it's complete.
export function stepProblems(data: WizardData, step: WizardStep): string[] {
  const problems: string[] = [];
  if (step === 1) {
    if (!data.name.trim()) problems.push("Give your campaign a name.");
    if (!data.coverImageUrl) problems.push("Upload a cover image.");
    if (!isObjectiveAvailable(data.objective)) problems.push("Choose an objective that's available now.");
    if (data.objective === "clicks") {
      if (!data.destinationUrl.trim()) problems.push("Add the destination link people go to when they click.");
      else if (!isDestinationUrl(data.destinationUrl)) problems.push("The destination link must start with http:// or https://.");
    }
  }
  if (step === 3) {
    if (data.platforms.length === 0) problems.push("Choose at least one platform.");
    const share = data.minLocationShare.trim();
    if (share && (wholeNumber(share) === null || Number(share) > 100)) problems.push("Audience share must be a whole number from 0 to 100.");
    const ageShare = data.minAgeShare.trim();
    if (ageFilterActive(data) && (wholeNumber(ageShare) === null || Number(ageShare) > 100)) problems.push("The required age share must be a whole number from 0 to 100.");
    const genderShare = data.minGenderShare.trim();
    if (genderFilterActive(data) && (wholeNumber(genderShare) === null || Number(genderShare) > 100)) problems.push("The required gender share must be a whole number from 0 to 100.");
    if (data.minFollowers.trim() && wholeNumber(data.minFollowers) === null) problems.push("Minimum followers must be a whole number.");
    const engagement = data.minEngagementRate.trim();
    if (engagement && !(Number(engagement) >= 0 && Number(engagement) <= 100)) problems.push("Engagement rate must be from 0 to 100.");
  }
  if (step === 4) {
    if (data.objective === "content") {
      const rate = wholeNumber(data.ratePerDeliverable);
      const count = wholeNumber(data.deliverables);
      if (!rate) problems.push("Set what creators earn for each approved deliverable, in whole naira.");
      if (!count) problems.push("Set how many deliverables you're paying for.");
      else if (count > MAX_DELIVERABLES) problems.push(`You can pay for up to ${MAX_DELIVERABLES} deliverables.`);
      if (isHybrid(data)) {
        const pool = wholeNumber(data.bonusPool);
        const cap = wholeNumber(data.bonusCap);
        if (!pool || pool < MIN_BONUS_POOL) problems.push(`Fund a bonus pool of at least ₦${MIN_BONUS_POOL.toLocaleString()}, in whole naira.`);
        if (!cap) problems.push("Set the most one creator can earn in bonus, in whole naira.");
        else if (pool && cap > pool) problems.push("A creator's bonus cap can't be more than the bonus pool.");
        if (data.bonusMetric === "views" && data.contentDestination === "brand_page") {
          problems.push("A views bonus needs creators to post on their own page. Choose creator page or both in step 2, or a sign-up or download bonus.");
        }
      }
    } else {
      if (!(data.views >= MIN_VIEWS)) problems.push(`Choose at least ${MIN_VIEWS.toLocaleString()} views.`);
      if (usesReferralBudget(data.objective) && referralBudgetValue(data) < MIN_REFERRAL_BUDGET) {
        problems.push(`Add a referral budget of at least ₦${MIN_REFERRAL_BUDGET.toLocaleString()}.`);
      }
    }
  }
  if (step === 5) {
    if (!data.brief.summary.trim()) problems.push("Tell creators what the campaign is about.");
    if (data.brief.soundUrl.trim() && !isUrl(data.brief.soundUrl.trim())) problems.push("The sound link must be a full web address.");
    if (data.brief.referenceVideos.some((link) => !isUrl(link))) problems.push("Reference videos must be full web addresses.");
  }
  if (step === 2) problems.push(...usageRightsProblems(data));
  return problems;
}

// Where a draft saved without a wizard step picks up: the first step that still needs something.
export function resumeStep(data: WizardData): WizardStep {
  for (const { step } of WIZARD_STEPS) {
    if (step < 6 && stepProblems(data, step).length > 0) return step;
  }
  return 6;
}

// A saved campaign as GET /campaigns/:id returns it, including fields from the older wizard.
export interface SavedCampaign extends Partial<CampaignSetup> {
  name?: string;
  category?: string;
  coverImageUrl?: string;
  targetViews?: number;
  contentBrief?: string;
  keyMessageCta?: string;
  whatToAvoid?: string;
  platforms?: string[];
  niches?: string[];
  scriptUrl?: string;
  scriptFileName?: string;
  referral?: { requestedBudget?: number };
  wizardStep?: number | null;
}

const list = (value: string[] | undefined) => (Array.isArray(value) ? value.filter(Boolean) : []);

// Drafts from the older wizard have no v2 brief, so their description, key message and
// things to avoid carry over.
export function wizardDataFromCampaign(saved: SavedCampaign): WizardData {
  const targeting = saved.audienceTargeting || {};
  const eligibility = saved.creatorEligibility || {};
  const brief: CampaignBrief = saved.brief || {};
  const hasBrief = Object.keys(brief).length > 0;

  return {
    ...INITIAL_WIZARD_DATA,
    name: saved.name || "",
    category: saved.category || INITIAL_WIZARD_DATA.category,
    coverImageUrl: saved.coverImageUrl || "",
    // The API derives every campaign's objective, including older drafts', so it's never re-derived here.
    objective: saved.campaignObjective || INITIAL_WIZARD_DATA.objective,
    contentDestination: saved.contentDestination || "creator_page",
    creatorAccess: saved.creatorAccess || "open_call",
    locations: list(targeting.locations),
    minLocationShare: targeting.minLocationShare !== undefined ? String(targeting.minLocationShare) : "",
    ageRanges: list(targeting.ageRanges),
    genders: targeting.genders?.length ? targeting.genders : ["all"],
    interests: list(targeting.interests),
    platforms: targeting.platforms?.length ? targeting.platforms : list(saved.platforms),
    minFollowers: eligibility.minFollowers !== undefined ? String(eligibility.minFollowers) : "",
    minEngagementRate: eligibility.minEngagementRate !== undefined ? String(eligibility.minEngagementRate) : "",
    categories: eligibility.categories?.length
      ? eligibility.categories
      : list(saved.niches).filter((niche) => CREATOR_CATEGORIES.includes(niche)),
    verifiedOnly: Boolean(eligibility.verifiedOnly),
    minRank: eligibility.minRank || "",
    requiredBadges: list(eligibility.requiredBadges),
    ratePerDeliverable: saved.contentPay ? String(saved.contentPay.ratePerDeliverable) : INITIAL_WIZARD_DATA.ratePerDeliverable,
    deliverables: saved.contentPay ? String(saved.contentPay.deliverables) : INITIAL_WIZARD_DATA.deliverables,
    payShape: saved.payShape === "hybrid" ? "hybrid" : "fixed",
    bonusMetric: saved.hybridBonus?.metric || INITIAL_WIZARD_DATA.bonusMetric,
    bonusPool: saved.hybridBonus ? String(saved.hybridBonus.pool) : "",
    bonusCap: saved.hybridBonus ? String(saved.hybridBonus.capPerCreator) : "",
    views: saved.targetViews || DEFAULT_VIEWS,
    referralBudget: saved.referral?.requestedBudget ? String(saved.referral.requestedBudget) : "",
    brief: hasBrief
      ? {
          summary: brief.summary || "",
          dos: list(brief.dos),
          donts: list(brief.donts),
          hashtags: list(brief.hashtags),
          soundUrl: brief.soundUrl || "",
          referenceVideos: list(brief.referenceVideos),
          tone: brief.tone || "",
          keyMessages: list(brief.keyMessages),
          productInfo: brief.productInfo || "",
          approvalRequirements: brief.approvalRequirements || "",
        }
      : {
          ...EMPTY_BRIEF,
          summary: saved.contentBrief || "",
          keyMessages: saved.keyMessageCta ? [saved.keyMessageCta] : [],
          donts: saved.whatToAvoid ? [saved.whatToAvoid] : [],
        },
    scriptUrl: saved.scriptUrl || "",
    scriptFileName: saved.scriptFileName || "",
    otherNiches: list(saved.niches).filter((niche) => !CREATOR_CATEGORIES.includes(niche)),
    destinationUrl: saved.destinationUrl || "",
    requireAgeMatch: Boolean(targeting.requireAgeMatch),
    minAgeShare: String(targeting.minAgeShare ?? DEFAULT_HARD_FILTER_SHARE),
    requireGenderMatch: Boolean(targeting.requireGenderMatch),
    minGenderShare: String(targeting.minGenderShare ?? DEFAULT_HARD_FILTER_SHARE),
    ...usageRightsFromCampaign(saved.usageRights),
  };
}

export function savedWizardStep(saved: SavedCampaign): WizardStep | null {
  const step = saved.wizardStep;
  return typeof step === "number" && step >= 1 && step <= 6 ? (step as WizardStep) : null;
}

const optionalWhole = (value: string) => (wholeNumber(value) !== null ? Number(value.trim()) : undefined);
const optionalNumber = (value: string) => (value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);

// The pay part of the setup, which is also what the quote needs.
export function pricingPayload(data: WizardData): Record<string, unknown> {
  if (data.objective === "content") {
    const rate = wholeNumber(data.ratePerDeliverable);
    const count = wholeNumber(data.deliverables);
    const pool = wholeNumber(data.bonusPool);
    const cap = wholeNumber(data.bonusCap);
    return {
      campaignObjective: data.objective,
      payShape: data.payShape,
      // null saves the draft without pay until both are set.
      contentPay: rate && count ? { ratePerDeliverable: rate, deliverables: count } : null,
      // The bonus only goes with hybrid pay; null saves a hybrid draft without it until it's set.
      ...(data.payShape === "hybrid" && {
        hybridBonus: pool && cap ? { metric: data.bonusMetric, pool, capPerCreator: cap } : null,
      }),
    };
  }
  return {
    campaignObjective: data.objective,
    targetViews: data.views,
    ...(usesReferralBudget(data.objective) && {
      // The API takes ₦1,000 or more; anything less is saved as not set yet.
      referral: { requestedBudget: referralBudgetValue(data) >= MIN_REFERRAL_BUDGET ? referralBudgetValue(data) : 0 },
    }),
  };
}

// Audience targeting and creator eligibility, as saved and as the live match count reads them.
export function targetingPayload(data: WizardData): { audienceTargeting: Record<string, unknown>; creatorEligibility: Record<string, unknown> } {
  return {
    audienceTargeting: {
      locations: data.locations,
      minLocationShare: optionalWhole(data.minLocationShare),
      ageRanges: data.ageRanges,
      genders: data.genders,
      interests: data.interests,
      platforms: data.platforms,
      // Hard filters only go out when on and there's something to match.
      ...(ageFilterActive(data) && { requireAgeMatch: true, minAgeShare: optionalWhole(data.minAgeShare) ?? DEFAULT_HARD_FILTER_SHARE }),
      ...(genderFilterActive(data) && { requireGenderMatch: true, minGenderShare: optionalWhole(data.minGenderShare) ?? DEFAULT_HARD_FILTER_SHARE }),
    },
    creatorEligibility: {
      minFollowers: optionalWhole(data.minFollowers),
      minEngagementRate: optionalNumber(data.minEngagementRate),
      categories: data.categories,
      verifiedOnly: data.verifiedOnly,
      minRank: data.minRank || undefined,
      requiredBadges: data.requiredBadges,
    },
  };
}

interface CampaignPayloadOptions {
  // The objective the saved campaign already has. It's only sent when the brand changes it,
  // because choosing an objective resets what an older draft counts as a conversion.
  savedObjective: CampaignObjective | null;
  wizardStep: WizardStep;
}

export function campaignPayload(data: WizardData, { savedObjective, wizardStep }: CampaignPayloadOptions): Record<string, unknown> {
  const brief = data.brief;
  const { campaignObjective, ...pricing } = pricingPayload(data);
  return {
    name: data.name.trim(),
    category: data.category,
    coverImageUrl: data.coverImageUrl || undefined,
    ...(campaignObjective !== savedObjective && { campaignObjective }),
    ...pricing,
    wizardStep,
    contentDestination: data.contentDestination,
    creatorAccess: data.creatorAccess,
    ...targetingPayload(data),
    brief: {
      summary: brief.summary.trim() || undefined,
      dos: brief.dos,
      donts: brief.donts,
      hashtags: brief.hashtags,
      soundUrl: brief.soundUrl.trim() || undefined,
      referenceVideos: brief.referenceVideos,
      tone: brief.tone.trim() || undefined,
      keyMessages: brief.keyMessages,
      productInfo: brief.productInfo.trim() || undefined,
      approvalRequirements: brief.approvalRequirements.trim() || undefined,
    },
    // Screens built before the campaign engine still read these.
    contentBrief: brief.summary.trim(),
    keyMessageCta: brief.keyMessages.join(" · "),
    whatToAvoid: brief.donts.join(" · "),
    platforms: data.platforms,
    niches: [...data.otherNiches, ...data.categories],
    scriptUrl: data.scriptUrl || undefined,
    scriptFileName: data.scriptFileName || undefined,
    // Clicks only; a link that isn't valid yet isn't sent, so the rest of the draft still saves.
    ...(data.objective === "clicks" && isDestinationUrl(data.destinationUrl) && { destinationUrl: data.destinationUrl.trim() }),
    usageRights: usageRightsPayload(data),
  };
}

// Usage rights (M8, SPEC D6 and D30): only content that goes to the brand's page carries them.
export const MAX_ADDITIONAL_TERMS = 1000;
const MAX_EXCLUSIVITY_PERIOD = 100;
const MAX_TERRITORIES = 50;
const MAX_TERRITORY_LENGTH = 100;
const WORLDWIDE = "Worldwide";

export const USAGE_RIGHTS_TYPE_OPTIONS: { value: UsageRightsType; title: string; body: string }[] = [
  {
    value: "standard",
    title: "Standard licence",
    body: "Use the content forever, on your social channels, in organic posts and paid ads. It isn't exclusive. Creators join without extra terms.",
  },
  {
    value: "custom",
    title: "Custom terms",
    body: "Set how long you can use the content, exclusivity, paid ads and where. Creators must accept your terms to take part.",
  },
];

export const USAGE_DURATION_OPTIONS: { value: UsageRightsDuration; label: string }[] = [
  { value: "perpetual", label: "Forever" },
  { value: "3_months", label: "3 months" },
  { value: "6_months", label: "6 months" },
  { value: "12_months", label: "12 months" },
  { value: "24_months", label: "24 months" },
];

export const USAGE_EXCLUSIVITY_OPTIONS: { value: UsageRightsExclusivity; title: string; body: string }[] = [
  { value: "none", title: "Not exclusive", body: "Creators can work with any other brand." },
  { value: "category", title: "Category exclusive", body: "Creators can't promote a competing brand in your category for a set time." },
];

export function grantsUsageRights(destination: ContentDestination | null | undefined): boolean {
  return destination === "brand_page" || destination === "both";
}

export function parseTerritories(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function usageRightsProblems(data: WizardData): string[] {
  if (!grantsUsageRights(data.contentDestination) || data.usageRightsType !== "custom") return [];
  const problems: string[] = [];
  if (data.usageExclusivity === "category") {
    const period = data.usageExclusivityPeriod.trim();
    if (!period) problems.push("Say how long creators can't work with a competing brand.");
    else if (period.length > MAX_EXCLUSIVITY_PERIOD) problems.push(`Keep the exclusivity period to ${MAX_EXCLUSIVITY_PERIOD} characters.`);
  }
  if (!data.usageWorldwide) {
    const territories = parseTerritories(data.usageTerritories);
    if (territories.length === 0) problems.push("List the countries where you can use the content, or choose worldwide.");
    else if (territories.length > MAX_TERRITORIES) problems.push(`List up to ${MAX_TERRITORIES} countries.`);
    else if (territories.some((item) => item.length > MAX_TERRITORY_LENGTH)) problems.push(`Each country can be up to ${MAX_TERRITORY_LENGTH} characters.`);
  }
  if (data.usageAdditionalTerms.length > MAX_ADDITIONAL_TERMS) {
    problems.push(`Keep additional terms to ${MAX_ADDITIONAL_TERMS.toLocaleString()} characters.`);
  }
  return problems;
}

// Custom terms are only sent where content goes to the brand's page; anywhere else the campaign
// goes back to the standard licence so creators aren't asked to accept terms that don't apply.
export function usageRightsPayload(data: WizardData): CampaignUsageRights {
  if (!grantsUsageRights(data.contentDestination) || data.usageRightsType !== "custom") return { type: "standard" };
  const additional = data.usageAdditionalTerms.trim();
  return {
    type: "custom",
    terms: {
      duration: data.usageDuration,
      exclusivity: data.usageExclusivity,
      exclusivityPeriod: data.usageExclusivity === "category" ? data.usageExclusivityPeriod.trim() || null : null,
      paidAdsAllowed: data.usagePaidAds,
      territories: data.usageWorldwide ? [WORLDWIDE] : parseTerritories(data.usageTerritories),
      additionalTerms: additional || null,
    },
  };
}

export function isWorldwide(territories: string[] | undefined): boolean {
  return !territories || territories.length === 0 || territories.some((item) => item.toLowerCase() === WORLDWIDE.toLowerCase());
}

function usageRightsFromCampaign(saved: CampaignUsageRights | null | undefined): Pick<
  WizardData,
  | "usageRightsType"
  | "usageDuration"
  | "usageExclusivity"
  | "usageExclusivityPeriod"
  | "usagePaidAds"
  | "usageWorldwide"
  | "usageTerritories"
  | "usageAdditionalTerms"
> {
  const terms = saved?.terms || {};
  const worldwide = isWorldwide(terms.territories);
  return {
    usageRightsType: saved?.type === "custom" ? "custom" : "standard",
    usageDuration: terms.duration || INITIAL_WIZARD_DATA.usageDuration,
    usageExclusivity: terms.exclusivity || INITIAL_WIZARD_DATA.usageExclusivity,
    usageExclusivityPeriod: terms.exclusivityPeriod || "",
    usagePaidAds: terms.paidAdsAllowed ?? INITIAL_WIZARD_DATA.usagePaidAds,
    usageWorldwide: worldwide,
    usageTerritories: worldwide ? "" : (terms.territories || []).join(", "),
    usageAdditionalTerms: terms.additionalTerms || "",
  };
}
