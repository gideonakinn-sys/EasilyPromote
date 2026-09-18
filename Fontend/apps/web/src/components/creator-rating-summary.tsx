"use client";

// Brand ratings (M8): a creator's average brand rating and how many ratings it's from. The average
// only exists from 3 ratings, so a single brand's rating can't be singled out.
import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import type { CreatorRatingSummary } from "./types";

export const BADGE_LABELS: Record<string, string> = {
  top_creator: "Top Creator",
  high_performer: "High Performer",
  reliable_creator: "Reliable Creator",
  campaign_pro: "Campaign Pro",
};

interface RatingSummaryProps {
  rating?: CreatorRatingSummary | null;
  className?: string;
  // "No brand ratings yet" when there are none; otherwise nothing is shown.
  showEmpty?: boolean;
}

export function RatingSummary({ rating, className, showEmpty = false }: RatingSummaryProps) {
  const count = rating?.count ?? 0;
  if (count === 0) {
    return showEmpty ? <span className={cn("text-xs font-medium text-neutral-400", className)}>No brand ratings yet</span> : null;
  }
  const plural = count === 1 ? "rating" : "ratings";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-neutral-700", className)}>
      <HugeiconsIcon icon={StarIcon} size={12} className="text-[#D97706] fill-[#FEB604] shrink-0" />
      {rating?.average !== null && rating?.average !== undefined ? (
        <>
          <span className="text-neutral-900">{rating.average.toFixed(1)}</span>
          <span className="text-neutral-500">
            · {count} {plural}
          </span>
        </>
      ) : (
        <span className="text-neutral-500">
          {count} {plural} · average shows from 3
        </span>
      )}
    </span>
  );
}

interface StarInputProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

// 1–5 stars, keyboard friendly (each star is a radio).
export function StarInput({ value, onChange, disabled }: StarInputProps) {
  return (
    <div role="radiogroup" aria-label="Rating" className="flex items-center justify-center gap-1.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          disabled={disabled}
          onClick={() => onChange(star)}
          className="p-1 rounded-full disabled:opacity-50"
        >
          <HugeiconsIcon
            icon={StarIcon}
            size={28}
            className={cn(star <= value ? "text-[#D97706] fill-[#FEB604]" : "text-neutral-300 fill-transparent")}
          />
        </button>
      ))}
    </div>
  );
}
