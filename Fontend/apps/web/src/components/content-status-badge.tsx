"use client";

// Campaign engine: content approval (ticket 07)
import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import type { ContentDestination, ContentSubmissionStatus } from "./types";

interface ContentStatusStyle {
  label: string;
  className: string;
}

const PENDING = "bg-[#FBDFB1] text-[#693D11]";
const DONE = "bg-[#CBF5E5] text-[#176448]";
const STOPPED = "bg-[#F8C9D2] text-[#710E21]";

const CONTENT_STATUS_STYLES: Record<ContentSubmissionStatus, ContentStatusStyle> = {
  new: { label: "Awaiting Review", className: PENDING },
  changes_requested: { label: "Changes Requested", className: STOPPED },
  rejected: { label: "Rejected", className: STOPPED },
  appealed: { label: "Appealed", className: PENDING },
  awaiting_post: { label: "Awaiting Post", className: DONE },
  verifying: { label: "Verifying Post", className: PENDING },
  awaiting_delivery: { label: "Awaiting Delivery", className: DONE },
  delivered: { label: "Delivered", className: PENDING },
  completed: { label: "Completed", className: DONE },
};

export const DESTINATION_LABELS: Record<ContentDestination, string> = {
  creator_page: "Creator's Page",
  brand_page: "Brand's Page",
  both: "Creator's Page And Brand's Page",
};

interface ContentStatusBadgeProps {
  status: ContentSubmissionStatus;
  className?: string;
}

export function ContentStatusBadge({ status, className }: ContentStatusBadgeProps) {
  const style = CONTENT_STATUS_STYLES[status] || { label: status, className: PENDING };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full font-medium tracking-tight text-[10px] font-rethink",
        style.className,
        className
      )}
    >
      {style.label}
    </span>
  );
}

export function formatContentDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// The brief's hashtags a caption doesn't carry yet, matched the way the server checks them.
export function missingHashtags(required: string[] | undefined, caption: string): string[] {
  const present = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) => tag.slice(1).toLowerCase()));
  return (required || [])
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter((tag) => tag && !present.has(tag.toLowerCase()))
    .map((tag) => `#${tag}`);
}
