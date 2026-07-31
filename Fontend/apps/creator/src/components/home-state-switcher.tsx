"use client";

import { DEMO_MODE } from "../lib/api";
import { cn } from "@ep/ui/lib/utils";

export type HomePreviewState = "empty" | "allset" | "filled";

interface HomeStateSwitcherProps {
  value: HomePreviewState;
  onChange: (value: HomePreviewState) => void;
}

const PREVIEW_OPTIONS: { label: string; value: HomePreviewState }[] = [
  { label: "Empty", value: "empty" },
  { label: "All set", value: "allset" },
  { label: "Filled", value: "filled" },
];

export function HomeStateSwitcher({ value, onChange }: HomeStateSwitcherProps) {
  if (!DEMO_MODE) return null;

  return (
    <div className="fixed bottom-6 left-4 z-[100] flex items-center gap-1 bg-white border border-stone-200 rounded-full p-1 font-rethink">
      <span className="text-xs font-medium text-stone-400 px-3">Preview</span>
      {PREVIEW_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-4 py-2 rounded-full text-xs font-medium font-rethink",
            value === opt.value ? "bg-stone-900 text-white" : "text-stone-500"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
