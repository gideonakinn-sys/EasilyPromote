"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon, ChevronDownIcon, Add01Icon } from "@hugeicons/core-free-icons";
import { CampaignCard } from "@ep/ui/components/campaign-card";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import { cn } from "@ep/ui/lib/utils";
import { useReveal } from "../hooks/use-reveal";

export interface BrandCampaign {
  id: string;
  name: string;
  category: string;
  status: string;
  targetViews: number;
  viewsDelivered: number;
  budget: number;
  progressPercent: number;
  coverImageUrl?: string;
  contentBrief?: string;
}

interface ActiveDashboardProps {
  campaigns: BrandCampaign[];
  onCreateCampaign: () => void;
  userName: string;
  onLogout?: () => void;
}

const FILTER_OPTIONS = ["All Campaigns", "Draft", "Under Review", "Live", "Delivered"] as const;

function mapStatus(s: string): "review_needed" | "live" | "draft" | "paused" | "under_review" | "completed" | "cancelled" | "pending_payment" {
  switch (s) {
    case "live": return "live";
    case "draft": return "draft";
    case "paused": return "paused";
    case "completed": return "completed";
    case "cancelled": return "cancelled";
    case "under_review": return "under_review";
    case "pending_payment": return "pending_payment";
    default: return "draft";
  }
}

export function ActiveDashboard({ campaigns, onCreateCampaign, userName, onLogout }: ActiveDashboardProps) {
  const router = useRouter();
  useReveal();

  const [isMobileFilterOpen, setIsMobileFilterOpen] = React.useState(false);
  const [selectedFilter, setSelectedFilter] = React.useState<string>("All Campaigns");

  const handleCardClick = (id: string, status: string) => {
    if (status === "draft" || status === "pending_payment") {
      router.push(`/dashboard/brand/create-campaign?id=${id}`);
    } else {
      router.push(`/dashboard/brand/campaign/${id}`);
    }
  };

  const filteredCampaigns = campaigns.filter((c) => {
    if (selectedFilter === "All Campaigns") return true;
    if (selectedFilter === "Draft") return c.status === "draft" || c.status === "pending_payment";
    if (selectedFilter === "Delivered") return c.status === "completed";
    return c.status.toLowerCase() === selectedFilter.toLowerCase();
  });

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 z-10">
      {/* Header row: Welcome + filter + create campaign */}
      <div data-reveal className="relative z-40 grid grid-cols-[1fr_auto] items-center gap-4 mb-8 md:mb-16">
        <h2 className="font-motterdam font-normal text-[23px] leading-[28px] text-stone-900 m-0 tracking-tighter">
          Welcome, {userName.split(" ")[0]}
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
          <div className="hidden md:block">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-center gap-2 bg-white border border-stone-200 rounded-full px-4 py-2.5 cursor-pointer">
                  <HugeiconsIcon icon={FilterIcon} size={16} className="text-stone-500" />
                  <span className="text-sm font-medium text-stone-900">{selectedFilter}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {FILTER_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option}
                    checked={selectedFilter === option}
                    onSelect={() => setSelectedFilter(option)}
                  >
                    {option}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Create campaign button */}
          <button
            onClick={onCreateCampaign}
            className="flex items-center justify-center p-3 md:px-6 md:py-2.5 bg-[#FEB604] text-[#1C1917] font-rethink font-semibold text-sm rounded-full border border-stone-100"
          >
            <HugeiconsIcon icon={Add01Icon} size={20} className="md:hidden" />
            <span className="hidden md:inline">Create Campaign</span>
          </button>
        </div>
      </div>

      {/* Mobile filter bottom sheet */}
      <div className="md:hidden">
        <MobileDrawer open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => {
                setSelectedFilter(option);
                setIsMobileFilterOpen(false);
              }}
              className={cn(
                "flex items-center w-full px-4 py-3 text-sm text-left rounded-lg",
                selectedFilter === option
                  ? "bg-stone-100 font-semibold text-stone-900"
                  : "font-medium text-stone-700"
              )}
            >
              {option}
            </button>
          ))}
        </MobileDrawer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCampaigns.map((camp) => (
          <div data-reveal key={camp.id}>
            <CampaignCard
              title={camp.name}
              status={mapStatus(camp.status)}
              category={camp.category}
              description={camp.contentBrief}
              imageSrc={camp.coverImageUrl}
              progress={camp.progressPercent}
              currentViews={camp.viewsDelivered.toLocaleString()}
              targetViews={camp.targetViews.toLocaleString()}
              onClick={() => handleCardClick(camp.id, camp.status)}
              onResume={() => handleCardClick(camp.id, camp.status)}
            />
          </div>
        ))}

        {filteredCampaigns.length === 0 && (
          <div className="col-span-full text-center py-12">
            <p className="text-stone-500 text-sm font-medium">No campaigns found.</p>
          </div>
        )}
      </div>
    </main>
  );
}
