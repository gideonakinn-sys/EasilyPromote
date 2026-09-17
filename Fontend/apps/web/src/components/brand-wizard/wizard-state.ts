import type {
  BonusMetric,
  CampaignBrief,
  CampaignObjective,
  CampaignSetup,
  ContentDestination,
  CreatorAccess,
} from "../types";
import { MIN_REFERRAL_BUDGET } from "../../lib/referral";

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
  { value: "engagement", title: "Engagement", body: "Pay for likes, comments and shares.", available: false },
  { value: "leads", title: "Leads", body: "Pay for people who show interest in what you sell.", available: false },
  { value: "sales", title: "Sales", body: "Pay for purchases made through creators.", available: false },
  { value: "other", title: "Other", body: "Pay for another action that matters to you.", available: false },
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
const REFERRAL_OBJECTIVES: CampaignObjective[] = ["signups", "downloads"];

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
};

export function usesReferralBudget(objective: CampaignObjective): boolean {
  return REFERRAL_OBJECTIVES.includes(objective);
}

export function isHybrid(data: WizardData): boolean {
  return data.objective === "content" && data.payShape === "hybrid";
}

// Whether the brand's app has to be connected before paying: referral objectives, and hybrid
// campaigns whose bonus pays for sign-ups or downloads.
export function tracksConversions(data: WizardData): boolean {
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
  }
  if (step === 3) {
    if (data.platforms.length === 0) problems.push("Choose at least one platform.");
    const share = data.minLocationShare.trim();
    if (share && (wholeNumber(share) === null || Number(share) > 100)) problems.push("Audience share must be a whole number from 0 to 100.");
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
    audienceTargeting: {
      locations: data.locations,
      minLocationShare: optionalWhole(data.minLocationShare),
      ageRanges: data.ageRanges,
      genders: data.genders,
      interests: data.interests,
      platforms: data.platforms,
    },
    creatorEligibility: {
      minFollowers: optionalWhole(data.minFollowers),
      minEngagementRate: optionalNumber(data.minEngagementRate),
      categories: data.categories,
      verifiedOnly: data.verifiedOnly,
      minRank: data.minRank || undefined,
      requiredBadges: data.requiredBadges,
    },
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
  };
}
