"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { useIsMobile } from "../hooks/use-is-mobile";

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="More info"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => {
          if (!isMobile) setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center justify-center w-4 h-4 text-stone-400 hover:text-stone-600 focus:outline-none cursor-pointer"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 w-52 bg-stone-900 text-white text-xs font-medium leading-relaxed rounded-lg px-3 py-2 font-rethink tracking-[-0.01em]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
