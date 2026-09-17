"use client";

import { cn } from "@ep/ui/lib/utils";
import type { MarketplaceCampaign } from "./types";
import { ACCESS_LABELS, accessOf } from "../lib/campaign-pay";

// Open Call (green) or Application Required (blue).
interface AccessBadgeProps {
  campaign: MarketplaceCampaign;
}

export function AccessBadge({ campaign }: AccessBadgeProps) {
  const access = accessOf(campaign);
  const open = access === "open_call";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium tracking-tight text-[10px] font-rethink whitespace-nowrap",
        open ? "bg-[#CBF5E5] text-[#176448]" : "bg-[#DBEAFE] text-[#1E40AF]"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", open ? "bg-[#16A34A]" : "bg-[#2563EB]")} />
      {ACCESS_LABELS[access]}
    </span>
  );
}

export function targetLocationLabel(campaign: MarketplaceCampaign): string {
  const locations = campaign.targetLocations || [];
  return locations.length > 0 ? `Audience in ${locations.join(", ")}` : "Any audience location";
}
