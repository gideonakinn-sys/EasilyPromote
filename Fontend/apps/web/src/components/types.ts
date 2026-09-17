export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SocialAccount {
  platform: string;
  handle: string;
  verified: boolean;
}

export interface TikTokStatus {
  connected: boolean;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
}

export type MetaProvider = "instagram" | "facebook";

export interface MetaProviderStatus {
  configured?: boolean;
  connected: boolean;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  pages?: Array<{ pageId: string; name: string; igBusinessId?: string }>;
}

export interface MetaStatus {
  instagram: MetaProviderStatus;
  facebook: MetaProviderStatus;
}

export interface CreatorProfile {
  name: string;
  avatar: string | null;
  displayName: string;
  username: string;
  bio: string;
  country: string;
  socialAccounts: SocialAccount[];
  niches: string[];
  rank: string;
  creatorScore: number;
  lifetimeEarnings: number;
  completionRate: number;
}

export type ActiveTab = "home" | "campaign" | "wallet";

export interface ProfileForm {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  avatarUrl: string;
}

export type ProfileFocusSection = "social" | "niches" | "details";

export interface TimelineEvent {
  id: string;
  type: string;
  label: string;
  actor: "creator" | "brand" | "admin" | "system";
  actorName?: string | null;
  reason?: string | null;
  statusAfter?: string | null;
  metadata?: Record<string, unknown>;
  at: string;
  time?: string;
}

export interface CampaignItem {
  id: string;
  timeline?: TimelineEvent[];
  slotId?: string;
  title: string;
  category: string;
  coverImageUrl?: string;
  delivery: string;
  status:
    | "needs_content"
    | "changes_requested"
    | "under_review"
    | "approved_post"
    | "live_tracking"
    | "delivered"
    // Campaign engine: content approval (ticket 07): rejected content, appealable.
    | "rejected"
    | "cancelled";
  reward: number;
  viewTarget?: number;
  minViews?: number;
  maxViews?: number;
  costPerView?: number;
  submittedAgo?: string;
  comment?: string;
  progress?: number;
  currentViews?: number;
  targetViews?: number;
  videoUrl?: string;
  caption?: string;
  videoDuration?: string;
  postedPlatforms?: Array<{ platform: string; postUrl?: string; views: number }>;
  creatorHandle?: string;
  submissionId?: string;
  contentBrief?: string;
  description?: string;
  keyMessageCta?: string;
  whatToAvoid?: string;
  goal?: string;
  competitors?: string;
  uniqueSellingPoint?: string;
  funFact?: string;
  platforms?: string[];
  contentStyle?: string[];
  brandName?: string;
  brandAvatar?: string;
  scriptUrl?: string;
  scriptFileName?: string;
  referral?: CampaignReferral | null;
}

export interface CampaignReferral {
  eventType: string;
  eventTypes?: string[];
  code: string | null;
  status: "awaiting_code" | "awaiting_business" | "active" | "disabled";
  conversions: number;
  rewardPerConversion?: number;
  paying?: boolean;
  earnings?: {
    earned: number;
    pending: number;
    available: number;
    withdrawn: number;
    availableToWithdraw: number;
    paidConversions: number;
  };
}

export interface MarketplaceCampaign {
  id: string;
  title: string;
  category: string;
  coverImageUrl?: string;
  reward: number;
  platforms: string[];
  slotsLeft: number;
  daysLeft: number;
  targetViews: number;
  costPerView: number;
  contentBrief?: string;
  brandName: string;
  brandAvatar?: string;
  minViews: number;
  maxViews?: number;
  viewTarget?: number;
  creatorPool?: number;
  description: string;
  referralReward?: { amount: number; eventType: string; eventTypes?: string[] } | null;
}

export interface WalletData {
  balance: number;
  withdrawableBalance: number;
  pendingBalance: number;
  pendingByCampaign: Array<{
    id: string;
    title: string;
    views: number;
    viewTarget: number;
    earned: number;
    status: string;
  }>;
  // Every campaign with views earnings, computed the same way withdrawals are checked.
  viewsByCampaign?: Array<{
    id: string;
    title: string;
    status: string;
    views: number;
    viewTarget: number;
    reward: number;
    earned: number;
    withdrawn: number;
    availableToWithdraw: number;
    withdrawable: boolean;
  }>;
  // Weekly per-campaign withdrawals: views earnings, and referral earnings and fixed pay past
  // their hold, together.
  withdrawCampaigns?: Array<{
    id: string;
    title: string;
    status: string;
    viewsAvailable: number;
    referralAvailable: number;
    referralOnHold: number;
    fixedAvailable?: number;
    fixedOnHold?: number;
    fixedAwaitingDelivery?: number;
    fixedHoldUntil?: string | null;
    // Hybrid pay (ticket 10): the fixed pot is the base, and the bonus is its own pot.
    payShape?: PayShape | null;
    bonusAvailable?: number;
    bonusOnHold?: number;
    // What the campaign has earned per pot, withdrawn or not.
    earnings?: { fixed: number; performance: number; referral: number; bonus?: number };
    // Money not withdrawable yet, and why.
    onHold?: Array<{ pot: "fixed" | "referral" | "bonus"; amount: number; reason: string; until: string | null }>;
    onHoldTotal?: number;
    payoutDate?: string;
    total: number;
    state: "available" | "below_minimum" | "nothing_yet" | "requested" | "withdrawn_this_week";
    requested: { amount: number; status: string; payoutDate: string } | null;
  }>;
  // Fixed pay from content campaigns, credited per deliverable.
  fixed?: {
    earned: number;
    awaitingDelivery: number;
    onHold: number;
    availableToWithdraw: number;
    withdrawn: number;
    holdDays: number;
    byCampaign: Array<{
      id: string;
      title: string;
      status: string | null;
      deliverables: number;
      earned: number;
      awaitingDelivery: number;
      onHold: number;
      holdUntil: string | null;
      // Each unlock date with the amount that unlocks then, soonest first.
      unlocks?: Array<{ date: string; amount: number }>;
      withdrawn: number;
      availableToWithdraw: number;
    }>;
  };
  // Hybrid campaigns' bonus (ticket 10), held 7 days per credit.
  bonus?: {
    earned: number;
    onHold: number;
    availableToWithdraw: number;
    withdrawn: number;
    holdDays: number;
    byCampaign: Array<{
      id: string;
      title: string;
      status: string | null;
      earned: number;
      onHold: number;
      holdUntil: string | null;
      unlocks?: Array<{ date: string; amount: number }>;
      withdrawn: number;
      availableToWithdraw: number;
    }>;
  };
  payoutSchedule?: { nextPayoutDate: string; minimumPerCampaign: number };
  hasBankAccount: boolean;
  bankName?: string | null;
  accountName?: string | null;
  maskedAccountNumber?: string | null;
  lifetimeEarnings: number;
  completionRate: number;
  totalReleased: number;
  referral?: {
    earned: number;
    pending: number;
    availableToWithdraw: number;
    withdrawn: number;
    holdDays: number;
    byCampaign: Array<{
      id: string;
      title: string;
      status: string;
      eventType: string | null;
      eventTypes?: string[];
      rewardPerConversion: number;
      paidConversions: number;
      earned: number;
      pending: number;
      available: number;
      withdrawn: number;
      availableToWithdraw: number;
    }>;
  };
  recentTransactions: Array<{
    id: string;
    type: string;
    amount: number;
    status: string;
    createdAt: string;
  }>;
}

export interface WithdrawalItem {
  id: string;
  campaignId: string;
  campaignName: string;
  kind?: "views" | "referral" | "campaign";
  amount: number;
  viewsAmount?: number;
  referralAmount?: number;
  fixedAmount?: number;
  bonusAmount?: number;
  // The Friday a pending or processing withdrawal is paid.
  payoutDate?: string | null;
  status: "pending" | "processing" | "rejected" | "released";
  adminNotes?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
  releasedAt?: string | null;
}

// Campaign engine: brand wizard (ticket 03)
export type CampaignObjective = "content" | "views" | "downloads" | "signups" | "engagement" | "leads" | "sales" | "other";
export type ContentDestination = "creator_page" | "brand_page" | "both";
export type CreatorAccess = "open_call" | "application_required";

export interface ContentPay {
  ratePerDeliverable: number;
  deliverables: number;
}

// Hybrid pay (ticket 10): what the bonus pays for. The brand sets the pool and the per-creator cap;
// the rate comes from the price table (views) or our team (sign-ups, downloads).
export type BonusMetric = "views" | "signups" | "downloads";

export interface HybridBonus {
  metric: BonusMetric;
  pool: number;
  capPerCreator: number;
  platformFee?: number;
  ratePerThousandViews?: number;
}

export interface AudienceTargeting {
  locations?: string[];
  minLocationShare?: number;
  ageRanges?: string[];
  genders?: string[];
  interests?: string[];
  platforms?: string[];
}

export interface CreatorEligibility {
  minFollowers?: number;
  minEngagementRate?: number;
  categories?: string[];
  verifiedOnly?: boolean;
  minRank?: string;
  requiredBadges?: string[];
}

export interface CampaignBrief {
  summary?: string;
  dos?: string[];
  donts?: string[];
  hashtags?: string[];
  soundUrl?: string;
  referenceVideos?: string[];
  tone?: string;
  keyMessages?: string[];
  productInfo?: string;
  approvalRequirements?: string;
}

// The Campaign v2 setup as GET /campaigns/:id returns it.
export interface CampaignSetup {
  campaignObjective: CampaignObjective | null;
  campaignModel: "content" | "performance" | null;
  payShape: "fixed" | "performance" | "hybrid" | null;
  rateAuthority: "brand" | "admin" | "platform" | null;
  contentPay: ContentPay | null;
  hybridBonus?: HybridBonus | null;
  contentDestination: ContentDestination | null;
  creatorAccess: CreatorAccess | null;
  audienceTargeting: AudienceTargeting;
  creatorEligibility: CreatorEligibility;
  brief: CampaignBrief;
}

// What a brand pays, from the same calculator checkout charges with.
export interface CampaignQuote {
  creatorBudget: number;
  performanceBudget: number;
  // Hybrid campaigns: the bonus pool and the fee on it (included in platformFee).
  bonusPool?: number;
  bonusFee?: number;
  platformFee: number;
  total: number;
}

// Campaign engine: creator marketplace (tickets 01/04/05)
// Interface declarations below merge into the ones above.

export type ProfileSection = ProfileFocusSection | "audience" | "portfolio";

export type PayShape = "fixed" | "performance" | "hybrid";
export type PayTab = "all" | PayShape;

// What one unit of work earns. amount is null while EasilyPromote is still setting a sign-up reward.
// Hybrid campaigns add the bonus on top of the base (ticket 10).
export interface PayPerUnit {
  amount: number | null;
  unit: string;
  bonus?: {
    metric: BonusMetric;
    amount: number | null;
    unit: string;
    capPerCreator: number;
    available: boolean;
  };
}

export interface CreatorBrief {
  summary: string;
  dos: string[];
  donts: string[];
  hashtags: string[];
  soundUrl: string | null;
  referenceVideos: string[];
  tone: string | null;
  keyMessages: string[];
  productInfo: string | null;
  approvalRequirements: string | null;
}

export interface EligibilityFailure {
  criterion: string;
  message: string;
}

export interface MarketplaceCampaign {
  campaignModel?: "content" | "performance";
  payShape?: PayShape;
  creatorAccess?: CreatorAccess;
  pay?: PayPerUnit;
  targetPlatforms?: string[];
  targetLocations?: string[];
  placesLeft?: number;
  briefSummary?: string;
  publishedAt?: string;
  eligible?: boolean;
  ineligibleReasons?: string[];
  matchScore?: number;
  recommended?: boolean;
  // Recommendations v2: why this campaign is recommended for the creator
  why?: string[];
  recommendationScore?: number;
  // Trending (ticket 11): different creators who joined or applied in the last 72 hours.
  recentCreators?: number;
  trending?: boolean;
}

export interface CampaignItem {
  kind?: "views" | "deliverable";
  brief?: CreatorBrief;
  pay?: PayPerUnit;
}

export interface SocialAccount {
  followers?: number | null;
}

export interface AudienceLocation {
  name: string;
  percentage: number;
}

export interface AudienceAge {
  range: string;
  percentage: number;
}

export interface AudienceGenders {
  female: number;
  male: number;
  other: number;
}

export interface CreatorAudience {
  locations: AudienceLocation[];
  ages: AudienceAge[];
  genders: AudienceGenders | null;
  source: "self_reported" | "api";
  proofUrl: string | null;
  updatedAt: string | null;
}

export interface PortfolioItem {
  url: string;
  thumbnailUrl: string | null;
  platform: string;
  title: string;
  views: number;
  category: string | null;
}

export interface CreatorStats {
  avgViews: number;
  engagementRate: number | null;
  pastCampaigns: number;
  totalCampaignViews: number;
  updatedAt: string | null;
}

export interface CreatorProfile {
  city?: string;
  state?: string;
  legalName?: string;
  phone?: string;
  categories?: string[];
  audience?: CreatorAudience | null;
  portfolio?: PortfolioItem[];
  verified?: boolean;
  badges?: string[];
  rating?: CreatorRatingSummary;
  stats?: CreatorStats;
}

// Brand ratings (M8): the count of visible ratings, and their average only from 3 ratings.
export interface CreatorRatingSummary {
  average: number | null;
  count: number;
}

// POST /campaigns/:id/join
export interface JoinResult {
  id: string;
  campaignId: string;
  status: string;
  kind: "views" | "deliverable";
  reward: number;
  viewTarget?: number;
  referralCode: string | null;
  placesLeft: number;
  brief: CreatorBrief;
}

// Campaign engine: applications (ticket 06)

export type ApplicationStatus = "pending" | "approved" | "rejected" | "withdrawn" | "expired";

// A creator's own application, from the dashboard payload (`applications`).
export interface MyApplication {
  id: string;
  campaignId: string;
  campaignName: string;
  campaignStatus?: string;
  status: ApplicationStatus;
  pitch: string;
  pay: PayPerUnit | null;
  appliedAt: string;
  expiresAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string;
  coverImageUrl?: string | null;
  brandName?: string;
  brandAvatar?: string | null;
}

export interface ApplicantPlatform {
  platform: string;
  handle: string | null;
  followers: number | null;
}

export interface ApplicantLocation {
  city: string;
  state: string;
  country: string;
}

// One applicant row in the brand's list.
export interface ApplicationRow {
  id: string;
  status: ApplicationStatus;
  pitch: string;
  matchScore: number;
  appliedAt: string;
  expiresAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string;
  creator: {
    id: string;
    name: string;
    username: string;
    photo: string | null;
    verified: boolean;
    location: ApplicantLocation | null;
    topPlatform: ApplicantPlatform | null;
    categories: string[];
    // The creator's current badges and brand rating (not frozen at apply time).
    badges?: string[];
    rating?: CreatorRatingSummary;
  };
}

export type ApplicationCounts = Record<ApplicationStatus | "all", number>;

export interface ApplicationList {
  counts: ApplicationCounts;
  applications: ApplicationRow[];
}

export interface ApplicantPortfolioItem extends PortfolioItem {
  matchesCampaign: boolean;
}

// Sections come back in the order the brand should read them for this campaign.
export type ApplicantSection =
  | { key: "platforms"; emphasis: boolean; data: { accounts: ApplicantPlatform[] } }
  | { key: "categories"; emphasis: boolean; data: { categories: string[]; matching: string[] } }
  | {
      key: "audience";
      emphasis: boolean;
      data: {
        targetedLocations: string[];
        targetedShare: number;
        locations: AudienceLocation[];
        topLocation: AudienceLocation | null;
        topAge: AudienceAge | null;
        genders: AudienceGenders | null;
        source: "self_reported" | "api" | null;
      };
    }
  | {
      key: "performance";
      emphasis: boolean;
      data: { avgViews: number; engagementRate: number | null; pastCampaigns: number; totalCampaignViews: number };
    }
  | { key: "portfolio"; emphasis: boolean; data: { categories: string[]; items: ApplicantPortfolioItem[] } }
  | { key: "badges"; emphasis: boolean; data: { badges: string[]; rating?: CreatorRatingSummary; completionRate: number } };

export interface ApplicationDetail extends ApplicationRow {
  applicant: {
    name: string;
    username: string;
    photo: string | null;
    verified: boolean;
    location: ApplicantLocation;
  };
  sections: ApplicantSection[];
}

// POST /campaigns/:id/applications/:applicationId/approve
export interface ApprovedApplication extends ApplicationRow {
  placement: { id: string; kind: "views" | "deliverable"; reward: number; viewTarget?: number; referralCode: string | null };
  placesLeft: number;
}

// Campaign engine: content approval (ticket 07)
// Interface declarations below merge into the ones above.

export type ContentSubmissionStatus =
  | "new"
  | "changes_requested"
  | "rejected"
  | "appealed"
  | "awaiting_post"
  | "verifying"
  | "awaiting_delivery"
  | "awaiting_receipt"
  | "completed";

export interface ContentChangeRequest {
  round: number;
  notes: string;
  requestedAt: string;
  videoUrl: string | null;
  caption: string | null;
  resubmittedAt: string | null;
}

// Where a content submission's approval and delivery stand. status is null before the
// creator has submitted anything.
export interface ContentApproval {
  status: ContentSubmissionStatus | null;
  destination: ContentDestination;
  maxChangeRequests: number;
  changeRequestsLeft: number;
  changeRequests: ContentChangeRequest[];
  autoApproved?: boolean;
  // When whatever waits on the brand (review, receipt, post verification) is done automatically.
  brandDueAt?: string | null;
  rejectionReason?: string | null;
  appealReason?: string | null;
  delivery?: { url: string; sharedAt: string | null; confirmedAt: string | null } | null;
  usageRights?: { licence: string; acceptedAt: string; acceptedBy: string | null } | null;
  // Judged by the server: brief hashtags the submitted and posted captions don't carry.
  missingHashtags?: string[];
  postedCaption?: string | null;
  postedMissingHashtags?: string[];
  postVerifiedAt?: string | null;
  completedAt?: string | null;
  licence: string | null;
  // Creator dashboard only.
  requiredHashtags?: string[];
}

export interface CampaignItem {
  contentApproval?: ContentApproval;
}

// One submission in GET /submissions/campaign/:id for a content campaign.
export interface ContentSubmission extends ContentApproval {
  id: string;
  creatorId: string;
  creatorHandle: string;
  videoUrl?: string;
  caption?: string;
  submittedAt: string;
  postedPlatforms?: Array<{ platform: string; postUrl: string }>;
}

export interface ContentReviewData {
  submissions: ContentSubmission[];
  contentApproval?: {
    destination: ContentDestination;
    maxChangeRequests: number;
    licence: string;
    brief: CreatorBrief;
  };
}

// Brand ratings (M8): GET /campaigns/:id/ratings and PUT /campaigns/:id/ratings/:creatorId.
export type RatingTag = "on_brief" | "on_time" | "communication" | "content_quality" | "would_work_again";

export interface CampaignRating {
  id: string;
  score: number;
  comment: string;
  tags: RatingTag[];
  createdAt: string;
  updatedAt: string;
  editableUntil: string;
  editable: boolean;
  hidden: boolean;
}

export interface RateableCreator {
  creatorId: string;
  name: string;
  username: string | null;
  avatar: string | null;
  completedAt: string | null;
  rating: CampaignRating | null;
}

export interface CampaignRatingList {
  creators: RateableCreator[];
  toRate: number;
  tags: Array<{ value: RatingTag; label: string }>;
  editWindowDays: number;
}

// M8 batch 7 (SPEC D29, D30): clicks campaigns and custom usage-rights terms, as creators see them.
export interface CreatorUsageTerms {
  duration?: "perpetual" | "3_months" | "6_months" | "12_months" | "24_months";
  exclusivity?: "none" | "category";
  exclusivityPeriod?: string | null;
  paidAdsAllowed?: boolean;
  territories?: string[];
  additionalTerms?: string | null;
}

export interface CreatorUsageRights {
  type: "standard" | "custom";
  version: number;
  terms: CreatorUsageTerms;
}

// Sent on join and apply for campaigns with custom terms.
export interface UsageRightsAcceptance {
  version: number;
}

export interface MarketplaceCampaign {
  campaignObjective?: string;
  contentDestination?: ContentDestination | null;
  // Where a clicks campaign's tracked link lands (hostname only).
  destinationDomain?: string | null;
  usageRights?: CreatorUsageRights | null;
}

export interface CampaignItem {
  campaignObjective?: string;
  contentDestination?: ContentDestination | null;
  destinationDomain?: string | null;
  usageRights?: CreatorUsageRights | null;
}
