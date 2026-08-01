"use client";

import { useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { TiktokIcon } from "@hugeicons/core-free-icons";
import type { MarketplaceCampaign } from "./types";
import { useReveal } from "../hooks/use-reveal";
import slotLimitImg from "@ep/ui/assets/Slot-limit+new-user-empty.png";
import emptyCampaignImg from "@ep/ui/assets/empty-campaign.png";
import { MarketplaceDetailsDrawer } from "./campaign-marketplace-drawer";

interface CampaignMarketplaceProps {
  campaigns: MarketplaceCampaign[];
  meta: { activeSlots: number; maxSlots: number; canClaim: boolean };
  onClaimSlot: (campaignId: string, views: number) => void;
  niches: string[];
}

export function CampaignMarketplace({ campaigns, meta, onClaimSlot, niches }: CampaignMarketplaceProps) {
  useReveal();
  const [activeCategory, setActiveCategory] = useState("All");
  const [showLimitBanner, setShowLimitBanner] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<MarketplaceCampaign | null>(null);

  const handleClaim = (views: number) => {
    if (!selectedCampaign) return;
    onClaimSlot(selectedCampaign.id, views);
    setSelectedCampaign(null);
  };

  const categories = ["All", ...niches];

  const filtered = activeCategory === "All"
    ? campaigns
    : campaigns.filter((c) => c.category === activeCategory);

  const isAtLimit = !meta.canClaim;

  return (
    <div className="w-full flex flex-col font-rethink">

      {/* Category filter bar */}
      <div data-reveal className="w-full mb-8">
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-medium font-rethink transition-all ${
                  isActive
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-500"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20 px-6">
          <Image src={emptyCampaignImg} alt="" width={200} height={200} className="mb-6" unoptimized />

          <h3 className="font-rethink font-medium text-[22px] text-stone-900 mb-2">
            Nothing right now
          </h3>
          <p className="font-rethink text-xs text-stone-500 font-medium max-w-xs leading-relaxed">
            New campaigns are added often — check back soon
          </p>
        </div>
      ) : (
        <div className="space-y-6 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {filtered.map((camp) => (
              <div
                key={camp.id}
                onClick={() => setSelectedCampaign(camp)}
                className="bg-white rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden cursor-pointer text-left"
              >
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
                </div>

                <div className="flex-1 text-left">
                  <h3 className="font-rethink font-medium tracking-tighter text-[16px] text-stone-900 line-clamp-2 mb-2">
                    {camp.title}
                  </h3>
                  <div className="flex gap-1.5 mb-5">
                    <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px] font-rethink">
                      {camp.category}
                    </span>
                    {camp.platforms.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px] font-rethink">
                        {camp.platforms.join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-auto border-t border-stone-100 pt-4 flex justify-between items-center text-xs font-medium">
                  <span className="text-stone-400 font-medium">
                    {camp.slotsLeft} slots left
                  </span>
                  <span className="text-stone-900 font-medium font-rethink">
                    ₦{camp.reward.toLocaleString()}
                  </span>
                </div>

              </div>
            ))}
          </div>

        </div>
      )}

      {isAtLimit && showLimitBanner && (
        <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 z-50">
          <div className="bg-[#EBF3FF]/40 border border-[#BFDBFE] border-dashed rounded-[20px] p-2 flex items-center justify-between gap-3 text-left relative overflow-hidden">
            <div className="flex gap-3 items-center">
              <Image src={slotLimitImg} alt="" width={36} height={36} className="w-9 h-9 shrink-0" unoptimized />
              <div>
                <h4 className="font-rethink text-xs font-medium text-stone-900 leading-snug">
                  You&apos;re at your active slot limit ({meta.activeSlots}/{meta.maxSlots}). Complete or deliver a slot to claim something new.
                </h4>
              </div>
            </div>
            <button
              onClick={() => setShowLimitBanner(false)}
              className="w-8 h-8 rounded-full border border-stone-200 flex items-center justify-center shrink-0 text-stone-400"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <MarketplaceDetailsDrawer
        campaign={selectedCampaign}
        open={selectedCampaign !== null}
        onOpenChange={(open) => { if (!open) setSelectedCampaign(null); }}
        onClaim={handleClaim}
        isAtLimit={isAtLimit}
      />

    </div>
  );
}
