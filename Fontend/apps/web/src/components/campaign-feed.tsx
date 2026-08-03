"use client";

import { useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, ChevronDownIcon } from "@hugeicons/core-free-icons";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@ep/ui/components/dropdown-menu";
import type { CampaignItem, CreatorProfile } from "./types";
import { CampaignCard } from "./campaign-card";
import { useReveal } from "../hooks/use-reveal";
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

  return (
    <div className="w-full flex flex-col">
      <div data-reveal className="grid grid-cols-[1fr_auto] items-center gap-4 mb-8 md:mb-16">
        <h2 className="font-motterdam font-normal text-[23px] leading-[28px] text-stone-900 m-0 tracking-tighter">
          Welcome, {profile.displayName.split(" ")[0]}
        </h2>

        <div className="flex items-center gap-3">
          {/* Mobile filter trigger — opens bottom sheet */}
          <button
            onClick={() => setIsMobileFilterOpen(true)}
            className="flex md:hidden items-center justify-center bg-white rounded-full p-3"
          >
            <HugeiconsIcon icon={FilterIcon} size={20} className="text-stone-500" />
          </button>

          {/* Desktop filter trigger — opens dropdown */}
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-center gap-2 bg-white rounded-full px-4 py-2.5 cursor-pointer">
                  <HugeiconsIcon icon={FilterIcon} size={16} className="text-stone-500" />
                  <span className="text-sm font-medium text-stone-900">{FILTER_OPTIONS.find((o) => o.value === filter)?.label || "All Campaigns"}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {FILTER_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onSelect={() => onFilterChange(opt.value)}
                    className={filter === opt.value ? "font-semibold text-stone-900" : "font-medium text-stone-700"}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
          <div key={camp.id}>
            <CampaignCard
              campaign={camp}
              onClick={() => onSelectCampaign(camp)}
            />
          </div>
        ))}

        {campaigns.length === 0 && (
          <div className="col-span-full flex flex-col items-center text-center pt-8 md:pt-24 px-6">
            <Image src={emptyHomeImg} alt="" width={184} height={175} className="mb-6" unoptimized />
            <h3 className="font-motterdam font-normal text-[22px] text-stone-900 mb-2 tracking-tighter">
              No campaigns yet
            </h3>
            <p className="font-rethink text-xs text-stone-500 font-medium max-w-xs leading-relaxed mb-8">
              You haven&apos;t joined any campaigns. Browse the marketplace to find campaigns matching your niches.
            </p>
            <button
              onClick={() => onBrowseCampaign?.()}
              className="w-full max-w-[300px] py-3 bg-[#FEB604] text-stone-900 rounded-full font-semibold text-sm border border-stone-100 font-rethink"
            >
              Browse Campaign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
