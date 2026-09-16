"use client";

import { cn } from "@ep/ui/lib/utils";
import type { ApplicationStatus } from "./types";

// Campaign engine: applications (ticket 06)
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "Pending",
  approved: "Selected",
  rejected: "Not Selected",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

const STATUS_STYLES: Record<ApplicationStatus, { bg: string; text: string; dot: string }> = {
  pending: { bg: "bg-[#FBDFB1]", text: "text-[#693D11]", dot: "bg-[#693D11]" },
  approved: { bg: "bg-[#CBF5E5]", text: "text-[#176448]", dot: "bg-[#176448]" },
  rejected: { bg: "bg-[#F8C9D2]", text: "text-[#710E21]", dot: "bg-[#710E21]" },
  withdrawn: { bg: "bg-stone-100", text: "text-stone-600", dot: "bg-stone-400" },
  expired: { bg: "bg-stone-100", text: "text-stone-600", dot: "bg-stone-400" },
};

interface ApplicationStatusBadgeProps {
  status: ApplicationStatus;
  // Brands see "Approved" / "Rejected"; creators see "Selected" / "Not Selected".
  audience?: "creator" | "brand";
}

export function ApplicationStatusBadge({ status, audience = "creator" }: ApplicationStatusBadgeProps) {
  const style = STATUS_STYLES[status];
  const label =
    audience === "brand" && status === "approved"
      ? "Approved"
      : audience === "brand" && status === "rejected"
        ? "Rejected"
        : APPLICATION_STATUS_LABELS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium tracking-tight text-[10px] font-rethink whitespace-nowrap",
        style.bg,
        style.text
      )}
    >
      <span className={cn("w-1 h-1 rounded-full", style.dot)} />
      {label}
    </span>
  );
}
