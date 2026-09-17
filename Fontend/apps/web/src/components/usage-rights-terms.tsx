"use client";

import { cn } from "@ep/ui/lib/utils";
import type { CreatorUsageRights } from "./types";
import { STANDARD_LICENCE, showsStandardLicence, usageTermRows } from "../lib/creator-campaign-terms";

// M8 batch 7 (SPEC D30): the usage terms a creator agrees to before joining or applying.
// Custom terms need the "I accept" tick; the standard licence is just shown.
interface UsageRightsTermsProps {
  campaign: {
    usageRights?: CreatorUsageRights | null;
    campaignModel?: string;
    contentDestination?: string | null;
  };
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  // Shown under the checkbox, e.g. when the API refused a join without acceptance.
  error?: string | null;
  disabled?: boolean;
}

export function UsageRightsTerms({ campaign, accepted, onAcceptedChange, error, disabled }: UsageRightsTermsProps) {
  const rights = campaign.usageRights;

  if (rights?.type === "custom") {
    const rows = usageTermRows(rights.terms || {});
    return (
      <div className="border border-stone-200 rounded-2xl p-4 space-y-3 font-rethink">
        <div className="space-y-1">
          <p className="text-sm font-medium text-stone-900">Usage terms</p>
          <p className="text-[11px] font-medium text-stone-500 leading-relaxed">
            The brand set its own terms for how it can use your content. Read them before you continue.
          </p>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 text-xs font-medium">
              <span className="text-stone-500">{row.label}</span>
              <span className="text-stone-800 text-right">{row.value}</span>
            </div>
          ))}
        </div>
        {rights.terms?.additionalTerms && (
          <div className="bg-stone-50 rounded-xl px-3 py-2 space-y-1">
            <p className="text-[10px] font-medium text-stone-500">Additional terms</p>
            <p className="text-xs font-medium text-stone-800 leading-relaxed whitespace-pre-line break-words">
              {rights.terms.additionalTerms}
            </p>
          </div>
        )}
        <label
          className={cn(
            "flex items-start gap-3 bg-white border rounded-2xl p-3",
            error && !accepted ? "border-red-300" : "border-stone-200",
            disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
          )}
        >
          <input
            type="checkbox"
            checked={accepted}
            disabled={disabled}
            onChange={(e) => onAcceptedChange(e.target.checked)}
            className="mt-0.5 accent-stone-900"
          />
          <span className="text-xs font-medium text-stone-800 leading-relaxed">I accept these usage terms</span>
        </label>
        {error && !accepted && <p className="text-xs font-medium text-red-700 leading-relaxed">{error}</p>}
      </div>
    );
  }

  if (showsStandardLicence(campaign)) {
    return <p className="font-rethink text-[11px] font-medium text-stone-500 leading-relaxed">{STANDARD_LICENCE}</p>;
  }

  return null;
}
