// M8 batch 7: how clicks campaigns and usage-rights terms read to a creator (SPEC D29, D30).
import type { CreatorUsageRights, CreatorUsageTerms } from "../components/types";
import { API_URL } from "./api";

// The API's origin: tracked links are served there, outside /api.
export function apiOrigin(): string {
  return API_URL.replace(/\/+$/, "").replace(/\/api$/, "");
}

// A creator's tracked link for a clicks campaign: <API origin>/r/<campaignId>/<referral code>.
export function trackedLinkFor(campaignId: string, referralCode: string): string {
  return `${apiOrigin()}/r/${encodeURIComponent(campaignId)}/${encodeURIComponent(referralCode)}`;
}

export function isClicksCampaign(campaign: { campaignObjective?: string } | null | undefined): boolean {
  return campaign?.campaignObjective === "clicks";
}

// Custom terms need the creator's acceptance of the current version before joining or applying.
export function needsUsageAcceptance(campaign: { usageRights?: CreatorUsageRights | null }): boolean {
  return campaign.usageRights?.type === "custom";
}

// The standard licence only applies where content is delivered to the brand.
export function showsStandardLicence(campaign: {
  usageRights?: CreatorUsageRights | null;
  campaignModel?: string;
  contentDestination?: string | null;
}): boolean {
  if (campaign.usageRights?.type === "custom") return false;
  return campaign.campaignModel === "content" && (campaign.contentDestination === "brand_page" || campaign.contentDestination === "both");
}

export const STANDARD_LICENCE =
  "Standard licence: the brand can use your content forever, non-exclusively, on its own organic and paid social channels.";

const DURATION_LABELS: Record<NonNullable<CreatorUsageTerms["duration"]>, string> = {
  perpetual: "Perpetual",
  "3_months": "3 months",
  "6_months": "6 months",
  "12_months": "12 months",
  "24_months": "24 months",
};

// Label and value rows for custom terms, in the order a creator reads them.
export function usageTermRows(terms: CreatorUsageTerms): Array<{ label: string; value: string }> {
  const territories = terms.territories && terms.territories.length > 0 ? terms.territories.join(", ") : "Worldwide";
  const exclusivity =
    terms.exclusivity === "category"
      ? `Category exclusive${terms.exclusivityPeriod ? ` for ${terms.exclusivityPeriod}` : ""}`
      : "Not exclusive";
  return [
    { label: "Duration", value: DURATION_LABELS[terms.duration || "perpetual"] || "Perpetual" },
    { label: "Exclusivity", value: exclusivity },
    { label: "Paid ads", value: terms.paidAdsAllowed === false ? "Not allowed" : "Allowed" },
    { label: "Territories", value: territories },
  ];
}

export const USAGE_TERMS_NOT_ACCEPTED = "USAGE_TERMS_NOT_ACCEPTED";
