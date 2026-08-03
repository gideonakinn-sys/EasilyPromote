import * as React from "react";
import { cn } from "../lib/utils";

export interface CampaignCardProps {
  title: string;
  status: "review_needed" | "live" | "draft" | "paused" | "under_review" | "completed" | "cancelled" | "pending_payment";
  imageSrc?: string;
  category?: string;
  description?: string;
  progress?: number;
  currentViews?: string;
  targetViews?: string;
  onResume?: () => void;
  onClick?: () => void;
  className?: string;
}

export function CampaignCard({
  title,
  status,
  imageSrc,
  category = "Music",
  description,
  progress = 68,
  currentViews = "170,000",
  targetViews = "250,000",
  onResume,
  onClick,
  className,
}: CampaignCardProps) {
  // Determine badge colors and labels
  const getBadges = () => {
    switch (status) {
      case "live":
        return (
          <span className="px-2 py-0.5 rounded-full bg-[#CBF5E5] text-[#176448] font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-[#176448]" /> Live
          </span>
        );
      case "draft":
      case "pending_payment":
        return (
          <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-stone-500" /> Draft
          </span>
        );
      case "under_review":
        return (
          <span className="px-2 py-0.5 rounded-full bg-[#FBDFB1] text-[#693D11] font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-[#693D11]" /> Under Review
          </span>
        );
      case "completed":
        return (
          <span className="px-2 py-0.5 rounded-full bg-[#CBF5E5] text-[#176448] font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-[#176448]" /> Completed
          </span>
        );
      case "cancelled":
        return (
          <span className="px-2 py-0.5 rounded-full bg-[#F8C9D2] text-[#710E21] font-medium tracking-tight text-[10px] font-rethink flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-[#710E21]" /> Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden",
        onClick && "cursor-pointer",
        className
      )}
    >
      <div>
        {/* Top Section: Thumbnail and Badges */}
        <div className="flex items-start justify-between mb-5">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={title}
              className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl object-cover border border-stone-200"
            />
          ) : (
            <div className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200">
              <svg className="w-6 h-6 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
              </svg>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {status !== "draft" && category && (
              <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px] font-rethink">
                {category}
              </span>
            )}
            {getBadges()}
          </div>
        </div>

        {/* Campaign Title */}
        <h3 className="font-rethink font-medium tracking-tighter text-[16px] text-stone-900 line-clamp-2">
          {title}
        </h3>
        {description && (
          <p className="font-rethink text-xs text-stone-500 font-medium truncate mt-1 mb-5 tracking-[-0.01em]">{description}</p>
        )}
      </div>

      {status === "draft" || status === "pending_payment" ? (
        /* Center Resume Button for Drafts */
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onResume) onResume();
          }}
          className="w-full py-3 bg-white border border-stone-200 text-stone-900 rounded-full font-rethink font-semibold tracking-[-0.01em] text-sm"
        >
          Resume
        </button>
      ) : (
        /* Progress for Active/Completed cards */
        <div className="mt-auto">
          <div className="flex items-center gap-3">
            <div className="w-24 h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  "bg-blue-600"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-stone-500 font-medium tracking-[-0.01em] font-rethink">{progress}%</span>
            <span className="w-1 h-1 rounded-full bg-stone-300" />
            <span className="text-xs text-stone-500 font-medium tracking-[-0.01em] font-rethink">{currentViews} / {targetViews} views</span>
          </div>
        </div>
      )}
    </div>
  );
}
