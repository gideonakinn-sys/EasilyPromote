import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { STATUS_LABELS } from "../../lib/brand";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-stone-100 text-stone-600",
  pending_payment: "bg-amber-50 text-amber-700",
  under_review: "bg-blue-50 text-blue-700",
  live: "bg-[#CBF5E5] text-[#176448]",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-[#CBF5E5] text-[#176448]",
  cancelled: "bg-red-50 text-red-600",
};

interface StatusChipProps {
  status: string;
  className?: string;
}

export function StatusChip({ status, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium capitalize",
        STATUS_STYLES[status] || "bg-stone-100 text-stone-600",
        className
      )}
    >
      {STATUS_LABELS[status] || status.replace(/_/g, " ")}
    </span>
  );
}