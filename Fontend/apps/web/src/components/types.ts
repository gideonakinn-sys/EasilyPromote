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
  hasBankAccount: boolean;
  bankName?: string | null;
  accountName?: string | null;
  maskedAccountNumber?: string | null;
  lifetimeEarnings: number;
  completionRate: number;
  totalReleased: number;
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
  amount: number;
  status: "pending" | "processing" | "rejected" | "released";
  adminNotes?: string | null;
  requestedAt: string;
  reviewedAt?: string | null;
  releasedAt?: string | null;
}
