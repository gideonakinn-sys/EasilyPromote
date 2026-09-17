// How campaigns read to a creator: pay per unit, platforms, access.
import type { CreatorAccess, MarketplaceCampaign, PayPerUnit } from "../components/types";
import { formatNaira } from "./referral";

export const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "X",
  facebook: "Facebook",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] || platform;
}

// "₦15,000 / approved deliverable", "₦250 / sign-up", "₦5,000 + bonus" for hybrid pay, or "Reward
// being set" while EasilyPromote sets it.
export function formatPay(pay: PayPerUnit | undefined, fallbackReward?: number): string {
  if (!pay) return fallbackReward ? formatNaira(fallbackReward) : "";
  if (pay.amount === null) return "Reward being set";
  if (pay.bonus) return `${formatNaira(pay.amount)} + bonus`;
  return `${formatNaira(pay.amount)} / ${pay.unit}`;
}

// "Base per approved deliverable, plus ₦3,010 per 1,000 views up to ₦8,000", for a hybrid campaign's details.
export function formatBonus(pay: PayPerUnit | undefined): string | null {
  const bonus = pay?.bonus;
  if (!bonus) return null;
  const rate = bonus.amount === null ? `a bonus per ${bonus.unit} (being set)` : `${formatNaira(bonus.amount)} per ${bonus.unit}`;
  return `Plus ${rate}, up to ${formatNaira(bonus.capPerCreator)} each${bonus.available ? "" : " (bonus pool used up)"}`;
}

export const ACCESS_LABELS: Record<CreatorAccess, string> = {
  open_call: "Open Call",
  application_required: "Application Required",
};

export function accessOf(campaign: MarketplaceCampaign): CreatorAccess {
  return campaign.creatorAccess || "open_call";
}

export function placesLeftOf(campaign: MarketplaceCampaign): number {
  return campaign.placesLeft ?? campaign.slotsLeft;
}

export function platformsOf(campaign: MarketplaceCampaign): string[] {
  return campaign.targetPlatforms && campaign.targetPlatforms.length > 0 ? campaign.targetPlatforms : campaign.platforms;
}
