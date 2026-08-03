"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { TiktokIcon } from "@hugeicons/core-free-icons";
import type { CampaignItem } from "./types";

interface CampaignCardProps {
  campaign: CampaignItem;
  onClick?: () => void;
}

export const STATUS_BADGES: Record<CampaignItem["status"], { label: string; bg: string; text: string; dot: string }> = {
  needs_content: {
    label: "Needs Content",
    bg: "bg-[#CBF5E5]",
    text: "text-[#176448]",
    dot: "bg-[#176448]",
  },
  changes_requested: {
    label: "Changes requested",
    bg: "bg-[#F8C9D2]",
    text: "text-[#710E21]",
    dot: "bg-[#710E21]",
  },
  under_review: {
    label: "Under Review",
    bg: "bg-[#FBDFB1]",
    text: "text-[#693D11]",
    dot: "bg-[#693D11]",
  },
  approved_post: {
    label: "Approved",
    bg: "bg-[#CBF5E5]",
    text: "text-[#176448]",
    dot: "bg-[#176448]",
  },
  live_tracking: {
    label: "Live",
    bg: "bg-[#CBF5E5]",
    text: "text-[#176448]",
    dot: "bg-[#176448]",
  },
  delivered: {
    label: "Delivered",
    bg: "bg-[#CBF5E5]",
    text: "text-[#176448]",
    dot: "bg-[#176448]",
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-[#F8C9D2]",
    text: "text-[#710E21]",
    dot: "bg-[#710E21]",
  },
};

export function CampaignCard({ campaign, onClick }: CampaignCardProps) {
  const camp = campaign;
  const badge = STATUS_BADGES[camp.status];
  const hasProgress = camp.status === "live_tracking" || camp.status === "delivered";

  const targetViews = camp.maxViews ?? camp.viewTarget;
  const targetLabel = targetViews ? `campaign target: ${targetViews.toLocaleString()} views` : "";

  const minReward = camp.minViews && camp.costPerView
    ? camp.minViews * camp.costPerView
    : null;
  const maxReward = camp.reward;

  const rewardLabel = minReward && minReward !== maxReward
    ? `₦${minReward.toLocaleString()} - ₦${maxReward.toLocaleString()}`
    : `₦${maxReward.toLocaleString()}`;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden cursor-pointer"
    >
      {/* Top Section: Cover thumbnail + Category + Status Badge */}
      <div>
        <div className="flex items-start justify-between mb-5">
          {camp.coverImageUrl ? (
            <img
              src={camp.coverImageUrl}
              alt={camp.title}
              className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl object-cover border border-stone-200"
            />
          ) : (
            <div className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200">
              <HugeiconsIcon icon={TiktokIcon} size={24} className="text-purple-600" />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px] font-rethink">
              {camp.category}
            </span>
            <span className={`px-2 py-0.5 rounded-full font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1 ${badge.bg} ${badge.text}`}>
              <span className={`w-1 h-1 rounded-full ${badge.dot}`} /> {badge.label}
            </span>
          </div>
        </div>

        {/* Campaign Title */}
        <h3 className="font-rethink font-medium tracking-tighter text-[16px] text-stone-900 line-clamp-2 mb-4">
          {camp.title}
        </h3>
      </div>

      {/* Info Section */}
      <div className="mt-auto">
        {hasProgress ? (
          /* Live / Delivered — brand-style progress indicator */
          <div className="flex items-center gap-3">
            <div className="w-24 h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-blue-600"
                style={{ width: `${camp.progress}%` }}
              />
            </div>
            <span className="text-xs text-stone-500 font-medium tracking-[-0.01em] font-rethink">{camp.progress}%</span>
            <span className="w-1 h-1 rounded-full bg-stone-300" />
            <span className="text-xs text-stone-500 font-medium tracking-[-0.01em] font-rethink">
              {camp.currentViews?.toLocaleString()} / {camp.targetViews?.toLocaleString()} views
            </span>
          </div>
        ) : (
          /* Other statuses — target + reward */
          <div className="space-y-3">
            {/* Comment bubble for changes_requested */}
            {camp.status === "changes_requested" && camp.comment && (
              <div className="bg-[#FAF5FF] border border-[#F3E8FF] rounded-2xl p-3 flex gap-2.5">
                <svg className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-[11px] leading-relaxed text-stone-600 font-medium">
                  &quot;{camp.comment}&quot;
                </p>
              </div>
            )}

            {/* Target + Reward line */}
            <div className="flex items-center justify-between text-xs font-medium font-rethink">
              <span className="text-stone-500">{targetLabel}</span>
              <span className="text-stone-900 font-semibold">{rewardLabel}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
