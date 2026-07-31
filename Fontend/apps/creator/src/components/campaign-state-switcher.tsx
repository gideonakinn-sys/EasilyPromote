"use client";

import { DEMO_MODE } from "../lib/api";
import { cn } from "@ep/ui/lib/utils";
import type { CampaignItem } from "./types";

export type CampaignPreviewStatus = CampaignItem["status"];

interface CampaignStateSwitcherProps {
  value: CampaignPreviewStatus;
  onChange: (value: CampaignPreviewStatus) => void;
}

const PREVIEW_OPTIONS: { label: string; value: CampaignPreviewStatus }[] = [
  { label: "Joined", value: "needs_content" },
  { label: "In review", value: "under_review" },
  { label: "Changes", value: "changes_requested" },
  { label: "Approved", value: "approved_post" },
  { label: "Live", value: "live_tracking" },
  { label: "Delivered", value: "delivered" },
];

export function CampaignStateSwitcher({ value, onChange }: CampaignStateSwitcherProps) {
  if (!DEMO_MODE) return null;

  return (
    <div
      className="fixed bottom-6 right-4 z-[100] flex items-center gap-1 bg-white border border-stone-200 rounded-full p-1 font-rethink max-w-[calc(100vw-2rem)] overflow-x-auto"
      data-lenis-prevent
    >
      <span className="text-xs font-medium text-stone-400 px-3 shrink-0">State</span>
      {PREVIEW_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 rounded-full text-[11px] font-medium font-rethink whitespace-nowrap",
            value === opt.value ? "bg-stone-900 text-white" : "text-stone-500"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
