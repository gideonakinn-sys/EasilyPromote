"use client";

import { useState, useEffect } from "react";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import Image from "next/image";
import { Drawer, DrawerContent } from "@ep/ui/components/drawer";
import * as DrawerPrimitive from "vaul";
import type { MarketplaceCampaign } from "./types";

interface MarketplaceDetailsDrawerProps {
  campaign: MarketplaceCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClaim: (views: number) => void;
  isAtLimit: boolean;
}

const VIEW_PRESETS = [1000, 3000, 5000, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 3000000] as const;

function buildViewPresets(targetViews: number): number[] {
  const min = Math.ceil(targetViews * 0.2);
  const max = Math.ceil(targetViews * 0.5);
  const inRange = VIEW_PRESETS.filter((v) => v >= min && v <= max);
  const set = new Set<number>(inRange);
  set.add(min);
  set.add(max);
  return Array.from(set).sort((a, b) => a - b);
}

function formatViews(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) return `${n / 1000}k`;
  return n.toString();
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "X",
};

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

function CampaignDrawerContent({
  campaign,
  onClaim,
  isAtLimit,
  isMobile,
  onClose,
}: {
  campaign: MarketplaceCampaign;
  onClaim: (views: number) => void;
  isAtLimit: boolean;
  isMobile: boolean;
  onClose: () => void;
}) {
  const minViews = Math.ceil(campaign.targetViews * 0.2);
  const maxViews = Math.ceil(campaign.targetViews * 0.5);
  const presets = buildViewPresets(campaign.targetViews);
  const firstValid = presets[0];
  const [selectedViews, setSelectedViews] = useState(firstValid);

  const reward = selectedViews * campaign.costPerView;
  const rewardMin = minViews * campaign.costPerView;
  const rewardMax = maxViews * campaign.costPerView;

  useEffect(() => {
    setSelectedViews(buildViewPresets(campaign.targetViews)[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id, campaign.targetViews]);

  return (
    <div className="relative flex flex-col h-full">
      {/* Desktop close button */}
      <div className="hidden md:block absolute top-6 right-6 z-10">
        <CloseButton onClick={onClose} />
      </div>

      <div className={`flex-1 overflow-y-auto ${isMobile ? "p-5 pb-[env(safe-area-inset-bottom)]" : "pt-16 pb-12 px-10"}`} data-lenis-prevent>
        <div className={`space-y-8 ${isMobile ? "w-full" : "w-[350px] mx-auto"}`}>

          {/* Header — matches brand's campaign details header */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200 flex-shrink-0 overflow-hidden">
              {campaign.coverImageUrl ? (
                <img src={campaign.coverImageUrl} alt={campaign.title} className="w-full h-full object-cover" />
              ) : (
                <svg className="w-9 h-9 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                </svg>
              )}
            </div>
            <div className="space-y-1.5">
              <h2 className="font-rethink font-medium text-xl text-stone-900 leading-tight">
                {campaign.title}
              </h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-medium text-[10px] font-rethink">
                {campaign.category}
              </span>
            </div>
          </div>

          {/* Description — matches brand */}
          <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
            {campaign.description}
          </p>

          {/* Details key-value list — matches brand's pattern */}
          <div className="space-y-4 pt-2">
            <div className="flex justify-between items-center font-rethink text-sm font-medium">
              <span className="text-stone-500">Campaign by</span>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-medium text-stone-600 overflow-hidden shrink-0">
                  {campaign.brandAvatar ? (
                    <Image src={campaign.brandAvatar} alt="" width={28} height={28} className="object-cover" unoptimized />
                  ) : (
                    campaign.brandName.charAt(0)
                  )}
                </div>
                <span className="text-stone-800 font-rethink">{campaign.brandName}</span>
              </div>
            </div>
            <div className="flex justify-between items-center font-rethink text-sm font-medium">
              <span className="text-stone-500">Target</span>
              <span className="text-stone-800">{campaign.targetViews.toLocaleString()} views</span>
            </div>
            <div className="flex justify-between items-center font-rethink text-sm font-medium">
              <span className="text-stone-500">Reward</span>
              <span className="text-stone-800">₦{rewardMin.toLocaleString()} - ₦{rewardMax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center font-rethink text-sm font-medium">
              <span className="text-stone-500">Platform</span>
              <span className="text-stone-800">{campaign.platforms.map((p) => PLATFORM_LABELS[p] || p).join(", ")}</span>
            </div>
          </div>

          {/* View selection — creator-specific section */}
          <div className="space-y-4">
            <h3 className="font-rethink font-semibold text-base text-stone-900">Commit to deliver</h3>
            <p className="text-xs font-medium text-stone-500">Select how many views you can deliver</p>

            <div className="flex flex-wrap gap-2">
              {presets.map((views) => {
                const isSelected = selectedViews === views;
                return (
                  <button
                    key={views}
                    onClick={() => setSelectedViews(views)}
                    className={`px-4 py-2 rounded-full text-xs font-medium font-rethink ${
                      isSelected ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {formatViews(views)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic reward — matches brand's card styling */}
          <div className="border border-stone-200 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm font-rethink">
              <span className="text-stone-500 font-medium">Your reward</span>
              <span className="font-medium text-stone-900">₦{reward.toLocaleString()}</span>
            </div>

          </div>

          {/* CTA — matches brand's button exactly */}
          <button
            onClick={() => onClaim(selectedViews)}
            disabled={isAtLimit}
            className={`w-full py-3 rounded-full font-semibold text-sm font-rethink ${
              isAtLimit
                ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                : "bg-[#FEB604] text-[#1C1917] border border-stone-100"
            }`}
          >
            {isAtLimit ? "At slot limit" : "Claim slot"}
          </button>

          {/* Info text */}
          <p className="text-[10px] text-stone-400 font-medium font-rethink text-center leading-relaxed">
            Full campaign details including content brief, key messaging, and brand guidelines will be revealed once you join.
          </p>
        </div>
      </div>
    </div>
  );
}

export function MarketplaceDetailsDrawer({
  campaign,
  open,
  onOpenChange,
  onClaim,
  isAtLimit,
}: MarketplaceDetailsDrawerProps) {
  const isMobile = useIsMobile();

  if (!campaign) return null;

  const content = (
    <CampaignDrawerContent
      campaign={campaign}
      onClaim={onClaim}
      isAtLimit={isAtLimit}
      isMobile={isMobile}
      onClose={() => onOpenChange(false)}
    />
  );

  if (isMobile) {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-[2px] transition-opacity duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DrawerPrimitive.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white outline-none max-h-[90vh] overflow-hidden">
            <div className="w-10 h-1 bg-stone-300 rounded-full mx-auto mt-3 mb-4 flex-shrink-0" />
            <div className="flex-1 overflow-hidden flex flex-col">
              {content}
            </div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="overflow-hidden p-0 bg-white">
        {content}
      </DrawerContent>
    </Drawer>
  );
}
