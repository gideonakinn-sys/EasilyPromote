"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, ChevronDownIcon } from "@hugeicons/core-free-icons";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import type { CampaignItem, CreatorProfile } from "./types";
import { CampaignCard } from "./campaign-card";
import { useReveal } from "../hooks/use-reveal";
import browseCampaignIllus from "@ep/ui/assets/browse-campaign.png";
import emptyHomeImg from "@ep/ui/assets/empty_home.png";

interface CampaignFeedProps {
  profile: CreatorProfile;
  campaigns: CampaignItem[];
  filter: string;
  onFilterChange: (filter: string) => void;
  onSelectCampaign: (campaign: CampaignItem) => void;
  onBrowseCampaign?: () => void;
}

const FILTER_OPTIONS = [
  { label: "All Campaigns", value: "all" },
  { label: "Needs Your Content", value: "needs_content" },
  { label: "Changes Requested", value: "changes_requested" },
  { label: "Review In Progress", value: "under_review" },
  { label: "Approved - Ready to Post", value: "approved_post" },
  { label: "Live · tracking views", value: "live_tracking" },
  { label: "Delivered", value: "delivered" },
] as const;

export function CampaignFeed({
  profile,
  campaigns,
  filter,
  onFilterChange,
  onSelectCampaign,
  onBrowseCampaign,
}: CampaignFeedProps) {
  useReveal();
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [isDesktopFilterOpen, setIsDesktopFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setIsDesktopFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-full flex flex-col">
      <div data-reveal className="grid grid-cols-[1fr_auto] items-center gap-4 mb-8 md:mb-16">
        <h2 className="font-rethink font-medium text-[23px] leading-[28px] text-stone-900 m-0">
          Welcome, {profile.displayName.split(" ")[0]}
        </h2>

        <div className="flex items-center gap-3">
          {/* Mobile filter trigger — opens bottom sheet */}
          <button
            onClick={() => setIsMobileFilterOpen(true)}
            className="flex md:hidden items-center justify-center bg-white border border-stone-200 rounded-full p-3"
          >
            <HugeiconsIcon icon={FilterIcon} size={20} className="text-stone-500" />
          </button>

          {/* Desktop filter trigger — opens dropdown */}
          <div ref={filterRef} className="hidden md:relative md:block z-[100]">
            <button
              onClick={() => setIsDesktopFilterOpen(!isDesktopFilterOpen)}
              className="hidden md:flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-full px-4 py-2.5 cursor-pointer"
            >
              <HugeiconsIcon icon={FilterIcon} size={16} className="text-stone-500" />
              <span className="text-sm font-medium text-stone-900">{FILTER_OPTIONS.find((o) => o.value === filter)?.label || "All Campaigns"}</span>
              <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
            </button>

            {isDesktopFilterOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-stone-200 rounded-xl py-1 z-50">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onFilterChange(opt.value);
                      setIsDesktopFilterOpen(false);
                    }}
                    className={`flex items-center w-full px-4 py-2.5 text-sm text-left ${
                      filter === opt.value ? "font-semibold text-stone-900" : "font-medium text-stone-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter bottom sheet */}
      <div className="md:hidden">
        <MobileDrawer open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onFilterChange(opt.value);
                setIsMobileFilterOpen(false);
              }}
              className={`flex items-center w-full px-4 py-3 text-sm text-left rounded-lg ${
                filter === opt.value
                  ? "bg-stone-100 font-semibold text-stone-900"
                  : "font-medium text-stone-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </MobileDrawer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {campaigns.map((camp) => (
          <div data-reveal key={camp.id}>
            <CampaignCard
              campaign={camp}
              onClick={() => onSelectCampaign(camp)}
            />
          </div>
        ))}

        {campaigns.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center text-center py-16 px-6">
            <Image src={emptyHomeImg} alt="" width={184} height={175} className="mb-6" unoptimized />
            <h3 className="font-rethink font-medium text-[22px] text-stone-900 mb-2">
              No campaigns yet
            </h3>
            <p className="font-rethink text-xs text-stone-500 font-medium max-w-xs leading-relaxed">
              You haven&apos;t joined any campaigns. Browse the marketplace to find campaigns matching your niches.
            </p>
          </div>
        )}

        <div className="bg-stone-100 border border-stone-200 border-dashed rounded-3xl p-4 flex flex-col justify-between text-center cursor-pointer" onClick={() => onBrowseCampaign?.()}>
          <div className="flex flex-col items-center justify-center">
            <Image src={browseCampaignIllus} alt="Browse campaigns" width={100} height={100} className="w-[100px] h-[100px]" unoptimized />
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onBrowseCampaign?.(); }}
            className="w-full py-2.5 bg-white border border-stone-200 text-stone-900 rounded-full font-semibold text-xs font-rethink"
          >
            Browse campaign
          </button>
        </div>
      </div>
    </div>
  );
}
