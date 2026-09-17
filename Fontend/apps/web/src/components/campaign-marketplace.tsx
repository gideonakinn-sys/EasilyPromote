"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { TiktokIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import type { MarketplaceCampaign } from "./types";
import type { JoinOutcome, MarketplaceMeta } from "./creator-dashboard-context";
import { AccessBadge, targetLocationLabel } from "./campaign-access-badge";
import { accessOf, formatPay, placesLeftOf, platformLabel, platformsOf } from "../lib/campaign-pay";
import { useReveal } from "../hooks/use-reveal";
import slotLimitImg from "@ep/ui/assets/Slot-limit+new-user-empty.png";
import emptyCampaignImg from "@ep/ui/assets/empty-campaign.png";
import { MarketplaceDetailsDrawer } from "./campaign-marketplace-drawer";
import type { ApplicationActions } from "./campaign-apply-panel";

interface CampaignMarketplaceProps {
  campaigns: MarketplaceCampaign[];
  meta: MarketplaceMeta;
  onJoin: (campaignId: string, committedViews?: number) => Promise<JoinOutcome>;
  onViewMyCampaigns: () => void;
  applications: ApplicationActions; // Campaign engine: applications (ticket 06)
}

const PAY_TABS = [
  { value: "all", label: "All" },
  { value: "fixed", label: "Fixed Pay" },
  { value: "performance", label: "Performance" },
  { value: "hybrid", label: "Hybrid" },
] as const;

type PayTab = (typeof PAY_TABS)[number]["value"];

function payShapeOf(campaign: MarketplaceCampaign) {
  return campaign.payShape || (campaign.campaignModel === "content" ? "fixed" : "performance");
}

function newestFirst(a: MarketplaceCampaign, b: MarketplaceCampaign) {
  return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
}

interface MarketplaceCardProps {
  campaign: MarketplaceCampaign;
  onOpen: () => void;
  // Campaign engine: applications (ticket 06). A pending application to this campaign.
  applied: boolean;
}

function MarketplaceCard({ campaign, onOpen, applied }: MarketplaceCardProps) {
  const platforms = platformsOf(campaign);
  const reasons = campaign.ineligibleReasons || [];
  const openCall = accessOf(campaign) === "open_call";
  const places = placesLeftOf(campaign);

  return (
    <div
      onClick={onOpen}
      className="bg-white rounded-2xl p-4 flex flex-col relative overflow-hidden cursor-pointer text-left font-rethink"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        {campaign.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={campaign.coverImageUrl}
            alt={campaign.title}
            className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl object-cover border border-stone-200"
          />
        ) : (
          <div className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200">
            <HugeiconsIcon icon={TiktokIcon} size={24} className="text-purple-600" />
          </div>
        )}
        <AccessBadge campaign={campaign} />
      </div>

      {/* Pay leads every card */}
      <p className="font-rethink font-medium text-[20px] tracking-tight text-stone-900 leading-tight">
        {formatPay(campaign.pay, campaign.reward)}
      </p>
      <h3 className="font-rethink font-medium text-sm text-stone-600 line-clamp-2 mt-1 mb-3">
        {campaign.title} · {campaign.brandName}
      </h3>

      {campaign.trending && (campaign.recentCreators || 0) > 0 && (
        <p className="text-[11px] font-medium text-stone-500 -mt-1 mb-3">
          {campaign.recentCreators} creators joined or applied in the last 3 days
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {platforms.map((platform) => (
          <span key={platform} className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px]">
            {platformLabel(platform)}
          </span>
        ))}
        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-medium tracking-tight text-[10px]">
          {targetLocationLabel(campaign)}
        </span>
      </div>

      {reasons.length > 0 && (
        <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4 leading-snug">
          {reasons[0]}
          {reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}
        </p>
      )}

      <div className="mt-auto border-t border-stone-100 pt-4 flex justify-between items-center gap-3">
        <span className="text-xs text-stone-400 font-medium">
          {places} {places === 1 ? "place" : "places"} left
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className={cn(
            "px-4 py-2 rounded-full font-semibold text-xs font-rethink",
            reasons.length === 0 && !applied ? "bg-[#FEB604] text-stone-950" : "bg-stone-100 text-stone-600"
          )}
        >
          {openCall ? "Join Campaign" : applied ? "Applied" : "Apply"}
        </button>
      </div>
    </div>
  );
}

interface CardGridProps {
  campaigns: MarketplaceCampaign[];
  onOpen: (campaign: MarketplaceCampaign) => void;
  appliedIds: Set<string>;
}

function CardGrid({ campaigns, onOpen, appliedIds }: CardGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
      {campaigns.map((campaign) => (
        <MarketplaceCard
          key={campaign.id}
          campaign={campaign}
          onOpen={() => onOpen(campaign)}
          applied={appliedIds.has(campaign.id)}
        />
      ))}
    </div>
  );
}

export function CampaignMarketplace({ campaigns, meta, onJoin, onViewMyCampaigns, applications }: CampaignMarketplaceProps) {
  useReveal();
  // Campaign engine: applications (ticket 06)
  const appliedIds = useMemo(
    () => new Set(applications.list.filter((a) => a.status === "pending").map((a) => a.campaignId)),
    [applications.list]
  );
  const [tab, setTab] = useState<PayTab>("all");
  const [showLimitBanner, setShowLimitBanner] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Kept so the drawer can still show the "you're in" state after the campaign leaves the list.
  const [selectedSnapshot, setSelectedSnapshot] = useState<MarketplaceCampaign | null>(null);

  const filtered = useMemo(
    () => (tab === "all" ? campaigns : campaigns.filter((c) => payShapeOf(c) === tab)),
    [campaigns, tab]
  );
  const recommended = filtered.filter((c) => c.recommended);
  // Trending (ticket 11): never repeats a recommended card; New is everything else.
  const trending = filtered
    .filter((c) => c.trending && !c.recommended)
    .sort((a, b) => (b.recentCreators || 0) - (a.recentCreators || 0) || newestFirst(a, b));
  const others = filtered.filter((c) => !c.recommended && !c.trending).sort(newestFirst);

  const selected = (selectedId && campaigns.find((c) => c.id === selectedId)) || selectedSnapshot;
  const isAtLimit = meta.activeSlots >= meta.maxSlots;
  // The server refuses joins for these too; say why before the creator tries.
  const joinBlockedReason = meta.lockReason
    || (isAtLimit || !meta.canClaim ? `You have ${meta.activeSlots} active placements. Finish one to join another` : null);

  const open = (campaign: MarketplaceCampaign) => {
    setSelectedId(campaign.id);
    setSelectedSnapshot(campaign);
  };
  const close = () => {
    setSelectedId(null);
    setSelectedSnapshot(null);
  };

  return (
    <div className="w-full flex flex-col font-rethink">
      <div data-reveal className="w-full mb-8">
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {PAY_TABS.map((option) => (
            <button
              key={option.value}
              onClick={() => setTab(option.value)}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-medium font-rethink",
                tab === option.value ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-20 px-6">
          <Image src={emptyCampaignImg} alt="" width={200} height={200} className="mb-6" unoptimized />
          <h3 className="font-rethink font-medium text-[22px] text-stone-900 mb-2">Nothing right now</h3>
          <p className="font-rethink text-xs text-stone-500 font-medium max-w-xs leading-relaxed">
            New campaigns are added often. Check back soon.
          </p>
        </div>
      ) : (
        <div className="space-y-10 w-full">
          {recommended.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="font-rethink font-medium text-lg tracking-tighter text-stone-900">Recommended for You</h2>
                <p className="text-xs font-medium text-stone-500">Campaigns you can join that suit where your audience is.</p>
              </div>
              <CardGrid campaigns={recommended} onOpen={open} appliedIds={appliedIds} />
            </section>
          )}
          {trending.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="font-rethink font-medium text-lg tracking-tighter text-stone-900">Trending</h2>
                <p className="text-xs font-medium text-stone-500">Campaigns the most creators joined or applied to in the last 3 days.</p>
              </div>
              <CardGrid campaigns={trending} onOpen={open} appliedIds={appliedIds} />
            </section>
          )}
          {others.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-rethink font-medium text-lg tracking-tighter text-stone-900">New</h2>
              <CardGrid campaigns={others} onOpen={open} appliedIds={appliedIds} />
            </section>
          )}
        </div>
      )}

      {isAtLimit && showLimitBanner && (
        <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 z-50">
          <div className="bg-[#EBF3FF]/40 border border-[#BFDBFE] border-dashed rounded-[20px] p-2 flex items-center justify-between gap-3 text-left relative overflow-hidden">
            <div className="flex gap-3 items-center">
              <Image src={slotLimitImg} alt="" width={36} height={36} className="w-9 h-9 shrink-0" unoptimized />
              <h4 className="font-rethink text-xs font-medium text-stone-900 leading-snug">
                You&apos;re at your active placement limit ({meta.activeSlots}/{meta.maxSlots}). Finish a placement to join something new.
              </h4>
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
        campaign={selected}
        open={selected !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
        onJoin={onJoin}
        joinBlockedReason={joinBlockedReason}
        applications={applications}
        onViewMyCampaigns={() => {
          close();
          onViewMyCampaigns();
        }}
      />
    </div>
  );
}
