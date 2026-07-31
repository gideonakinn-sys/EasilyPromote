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
  displayName: string;
  bio: string;
  country: string;
  avatarUrl: string;
}

export type ProfileFocusSection = "social" | "niches" | "details";

export interface CampaignItem {
  id: string;
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
    | "delivered";
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
  postedPlatforms?: string[];
  submissionId?: string;
  contentBrief?: string;
  keyMessageCta?: string;
  whatToAvoid?: string;
  platforms?: string[];
  contentStyle?: string;
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
  description: string;
}

export interface WalletData {
  balance: number;
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
