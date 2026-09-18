"use client";

import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { TiktokIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import type { MarketplaceCampaign, PayTab } from "./types";
import { useCreatorDashboard, type JoinOutcome, type MarketplaceMeta, mapMarketplaceItems } from "./creator-dashboard-context";
import { AccessBadge, targetLocationLabel } from "./campaign-access-badge";
import { accessOf, formatPay, placesLeftOf, platformLabel, platformsOf } from "../lib/campaign-pay";
import { useReveal } from "../hooks/use-reveal";
import slotLimitImg from "@ep/ui/assets/Slot-limit+new-user-empty.png";
import emptyCampaignImg from "@ep/ui/assets/empty-campaign.png";
import { MarketplaceDetailsDrawer } from "./campaign-marketplace-drawer";
import type { ApplicationActions } from "./campaign-apply-panel";
import {
  getMarketplaceSections,
  getMarketplaceSectionPage,
  ApiRequestError,
  apiRequest,
} from "../lib/api";
import { getToken } from "../lib/auth";
import { Skeleton } from "./ui/skeleton";

interface CampaignMarketplaceProps {
  campaigns?: MarketplaceCampaign[];
  meta?: MarketplaceMeta;
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

function payShapeOf(campaign: MarketplaceCampaign) {
  return campaign.payShape || (campaign.campaignModel === "content" ? "fixed" : "performance");
}

interface MarketplaceCardProps {
  campaign: MarketplaceCampaign;
  onOpen: () => void;
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
            className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl object-cover border border-neutral-200"
          />
        ) : (
          <div className="w-[45px] h-[45px] md:w-[50px] md:h-[50px] rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200">
            <HugeiconsIcon icon={TiktokIcon} size={24} className="text-purple-600" />
          </div>
        )}
        <AccessBadge campaign={campaign} />
      </div>

      {/* Pay leads every card */}
      <p className="font-rethink font-medium text-[20px] tracking-tight text-neutral-900 leading-tight">
        {formatPay(campaign.pay, campaign.reward)}
      </p>
      <h3 className="font-rethink font-medium text-sm text-neutral-600 line-clamp-2 mt-1 mb-3">
        {campaign.title} · {campaign.brandName}
      </h3>

      {/* Recommended "why" lines (up to 2, D26) */}
      {campaign.recommended && Array.isArray(campaign.why) && campaign.why.length > 0 && (
        <div className="flex flex-col gap-1 -mt-1 mb-3">
          {campaign.why.slice(0, 2).map((reason, idx) => (
            <p key={idx} className="text-[11px] font-medium text-purple-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
              <span className="truncate">{reason}</span>
            </p>
          ))}
        </div>
      )}

      {/* Trending recent creator count (D27) */}
      {campaign.trending && typeof campaign.recentCreators === "number" && campaign.recentCreators > 0 && (
        <p className="text-[11px] font-medium text-neutral-500 -mt-1 mb-3">
          {campaign.recentCreators} {campaign.recentCreators === 1 ? "creator" : "creators"} joined or applied in the last 3 days
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {platforms.map((platform) => (
          <span key={platform} className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 font-medium tracking-tight text-[10px]">
            {platformLabel(platform)}
          </span>
        ))}
        <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 font-medium tracking-tight text-[10px]">
          {targetLocationLabel(campaign)}
        </span>
      </div>

      {reasons.length > 0 && (
        <p className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4 leading-snug">
          {reasons[0]}
          {reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}
        </p>
      )}

      <div className="mt-auto border-t border-neutral-100 pt-4 flex justify-between items-center gap-3">
        <span className="text-xs text-neutral-400 font-medium">
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
            reasons.length === 0 && !applied ? "bg-[#FEB604] text-neutral-950" : "bg-neutral-100 text-neutral-600"
          )}
        >
          {openCall ? "Join Campaign" : applied ? "Applied" : "Apply"}
        </button>
      </div>
    </div>
  );
}

function dedupeCampaigns(items: MarketplaceCampaign[]): MarketplaceCampaign[] {
  const seen = new Set<string>();
  const result: MarketplaceCampaign[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = item.id || `campaign-${i}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

interface CardGridProps {
  campaigns: MarketplaceCampaign[];
  onOpen: (campaign: MarketplaceCampaign) => void;
  appliedIds: Set<string>;
}

function CardGrid({ campaigns, onOpen, appliedIds }: CardGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
      {campaigns.map((campaign, idx) => {
        const itemKey = campaign.id || `campaign-${idx}`;
        return (
          <MarketplaceCard
            key={itemKey}
            campaign={campaign}
            onOpen={() => onOpen(campaign)}
            applied={Boolean(campaign.id && appliedIds.has(campaign.id))}
          />
        );
      })}
    </div>
  );
}

interface SectionState {
  items: MarketplaceCampaign[];
  nextCursor: string | null;
  total: number;
  loadingMore: boolean;
}

interface TabSectionsState {
  recommended: SectionState;
  trending: SectionState;
  new: SectionState;
  tabCounts?: Record<PayTab, number>;
  loading: boolean;
  error: string | null;
  loaded: boolean;
}

const INITIAL_SECTION: SectionState = {
  items: [],
  nextCursor: null,
  total: 0,
  loadingMore: false,
};

const INITIAL_TAB_STATE: TabSectionsState = {
  recommended: { ...INITIAL_SECTION },
  trending: { ...INITIAL_SECTION },
  new: { ...INITIAL_SECTION },
  loading: false,
  error: null,
  loaded: false,
};

export function CampaignMarketplace({
  meta: propMeta,
  onJoin,
  onViewMyCampaigns,
  applications,
}: CampaignMarketplaceProps) {
  useReveal();
  const {
    marketplaceMeta: ctxMeta,
    setMarketplaceMeta,
    upsertMarketplaceCampaigns,
  } = useCreatorDashboard();
  const meta = propMeta || ctxMeta;

  const appliedIds = React.useMemo(
    () => new Set(applications.list.filter((a) => a.status === "pending").map((a) => a.campaignId)),
    [applications.list]
  );

  const [tab, setTab] = React.useState<PayTab>("all");
  const [showLimitBanner, setShowLimitBanner] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = React.useState<MarketplaceCampaign | null>(null);

  // Per-tab in-memory caching: preserves loaded items and nextCursor across tab switches
  const [tabsState, setTabsState] = React.useState<Record<PayTab, TabSectionsState>>({
    all: { ...INITIAL_TAB_STATE },
    fixed: { ...INITIAL_TAB_STATE },
    performance: { ...INITIAL_TAB_STATE },
    hybrid: { ...INITIAL_TAB_STATE },
  });

  const inFlightTabsRef = React.useRef<Set<PayTab>>(new Set());

  const fetchTab = React.useCallback(
    async (targetTab: PayTab, force = false) => {
      if (inFlightTabsRef.current.has(targetTab)) return;
      inFlightTabsRef.current.add(targetTab);

      setTabsState((prev) => {
        if (!force && prev[targetTab].loaded) return prev;
        return {
          ...prev,
          [targetTab]: {
            ...prev[targetTab],
            loading: true,
            error: null,
          },
        };
      });

      try {
        const res = await getMarketplaceSections(targetTab, 12);
        const recommended: SectionState = {
          items: dedupeCampaigns(mapMarketplaceItems(res.sections.recommended.campaigns as unknown as Array<Record<string, unknown>>)),
          nextCursor: res.sections.recommended.nextCursor,
          total: res.sections.recommended.total,
          loadingMore: false,
        };
        const trending: SectionState = {
          items: dedupeCampaigns(mapMarketplaceItems(res.sections.trending.campaigns as unknown as Array<Record<string, unknown>>)),
          nextCursor: res.sections.trending.nextCursor,
          total: res.sections.trending.total,
          loadingMore: false,
        };
        const newSection: SectionState = {
          items: dedupeCampaigns(mapMarketplaceItems(res.sections.new.campaigns as unknown as Array<Record<string, unknown>>)),
          nextCursor: res.sections.new.nextCursor,
          total: res.sections.new.total,
          loadingMore: false,
        };

        setTabsState((prev) => ({
          ...prev,
          [targetTab]: {
            recommended,
            trending,
            new: newSection,
            tabCounts: res.tabCounts,
            loading: false,
            error: null,
            loaded: true,
          },
        }));

        if (res.activeSlots !== undefined) {
          setMarketplaceMeta({
            activeSlots: res.activeSlots,
            maxSlots: res.maxSlots ?? 3,
            canClaim: res.canClaim ?? true,
            lockReason: res.lockReason ?? null,
          });
        }

        upsertMarketplaceCampaigns([...recommended.items, ...trending.items, ...newSection.items]);
      } catch (err: unknown) {
        // Fallback: if sections endpoint 404s (e.g. web deployed before API), fall back to whole-list
        const is404 =
          err instanceof ApiRequestError
            ? err.status === 404
            : (err as { status?: number })?.status === 404;

        if (is404) {
          try {
            const legacy = await apiRequest<{
              campaigns: Array<Record<string, unknown>>;
              activeSlots: number;
              maxSlots: number;
              canClaim: boolean;
              lockReason: string | null;
            }>("/creators/marketplace", {
              token: getToken() || undefined,
            });
            const allItems = dedupeCampaigns(mapMarketplaceItems(legacy.campaigns));
            const filtered = targetTab === "all" ? allItems : allItems.filter((c) => payShapeOf(c) === targetTab);
            const rec = filtered.filter((c) => c.recommended);
            const trn = filtered.filter((c) => c.trending && !c.recommended);
            const oth = filtered.filter((c) => !c.recommended && !c.trending);

            setTabsState((prev) => ({
              ...prev,
              [targetTab]: {
                recommended: { items: rec, nextCursor: null, total: rec.length, loadingMore: false },
                trending: { items: trn, nextCursor: null, total: trn.length, loadingMore: false },
                new: { items: oth, nextCursor: null, total: oth.length, loadingMore: false },
                loading: false,
                error: null,
                loaded: true,
              },
            }));

            setMarketplaceMeta({
              activeSlots: legacy.activeSlots || 0,
              maxSlots: legacy.maxSlots || 3,
              canClaim: legacy.canClaim ?? true,
              lockReason: legacy.lockReason ?? null,
            });

            upsertMarketplaceCampaigns(allItems);
            return;
          } catch (fallbackErr) {
            console.error("Marketplace legacy fallback failed:", fallbackErr);
          }
        }

        const message = err instanceof Error ? err.message : "Couldn't load campaigns right now.";
        setTabsState((prev) => ({
          ...prev,
          [targetTab]: {
            ...prev[targetTab],
            loading: false,
            error: message,
            loaded: false,
          },
        }));
      } finally {
        inFlightTabsRef.current.delete(targetTab);
      }
    },
    [setMarketplaceMeta, upsertMarketplaceCampaigns]
  );

  const currentTab = tabsState[tab];
  const isLoaded = currentTab.loaded;
  const isLoading = currentTab.loading;
  const hasError = Boolean(currentTab.error);

  // Load initial tab on mount or tab change if not loaded, not loading, and no error
  React.useEffect(() => {
    if (!isLoaded && !isLoading && !hasError) {
      fetchTab(tab);
    }
  }, [tab, isLoaded, isLoading, hasError, fetchTab]);

  const loadMore = async (section: "recommended" | "trending" | "new") => {
    const currentTabState = tabsState[tab];
    const sectionState = currentTabState[section];
    if (!sectionState.nextCursor || sectionState.loadingMore) return;

    setTabsState((prev) => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        [section]: {
          ...prev[tab][section],
          loadingMore: true,
        },
      },
    }));

    try {
      const res = await getMarketplaceSectionPage(section, tab, sectionState.nextCursor, 12);
      const newItems = dedupeCampaigns(mapMarketplaceItems(res.campaigns as unknown as Array<Record<string, unknown>>));

      setTabsState((prev) => {
        const existingItems = prev[tab][section].items;
        const existingIds = new Set(existingItems.map((c) => c.id));
        const appended = [...existingItems, ...newItems.filter((c) => !existingIds.has(c.id))];

        return {
          ...prev,
          [tab]: {
            ...prev[tab],
            [section]: {
              items: appended,
              nextCursor: res.nextCursor,
              total: res.total ?? prev[tab][section].total,
              loadingMore: false,
            },
          },
        };
      });

      upsertMarketplaceCampaigns(newItems);
    } catch (err) {
      console.error(`Failed to load more ${section} campaigns:`, err);
      setTabsState((prev) => ({
        ...prev,
        [tab]: {
          ...prev[tab],
          [section]: {
            ...prev[tab][section],
            loadingMore: false,
          },
        },
      }));
    }
  };

  const allLoadedCampaigns = React.useMemo(() => {
    return [
      ...currentTab.recommended.items,
      ...currentTab.trending.items,
      ...currentTab.new.items,
    ];
  }, [currentTab]);

  const selected = (selectedId && allLoadedCampaigns.find((c) => c.id === selectedId)) || selectedSnapshot;
  const isAtLimit = meta.activeSlots >= meta.maxSlots;
  const joinBlockedReason =
    meta.lockReason ||
    (isAtLimit || !meta.canClaim ? `You have ${meta.activeSlots} active placements. Finish one to join another` : null);

  const open = (campaign: MarketplaceCampaign) => {
    setSelectedId(campaign.id);
    setSelectedSnapshot(campaign);
  };
  const close = () => {
    setSelectedId(null);
    setSelectedSnapshot(null);
  };

  const totalCampaignsOnTab =
    currentTab.recommended.items.length + currentTab.trending.items.length + currentTab.new.items.length;

  return (
    <div className="w-full flex flex-col font-rethink">
      {/* Pay Tabs */}
      <div data-reveal className="w-full mb-8">
        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {PAY_TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-medium font-rethink",
                tab === option.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"
              )}
            >
              {option.label}
              {currentTab.tabCounts && currentTab.tabCounts[option.value] !== undefined && (
                <span className={cn("ml-1.5 opacity-70")}>({currentTab.tabCounts[option.value]})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Error state with retry */}
      {currentTab.error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center mb-8">
          <p className="font-rethink text-xs font-medium text-red-800 mb-3">{currentTab.error}</p>
          <button
            type="button"
            onClick={() => fetchTab(tab, true)}
            className="px-4 py-2 rounded-full bg-neutral-900 text-white font-semibold text-xs font-rethink"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Initial loading skeleton */}
      {currentTab.loading && !currentTab.loaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-4 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-4">
                <Skeleton className="w-[50px] h-[50px] rounded-2xl" />
                <Skeleton className="w-20 h-5 rounded-full" />
              </div>
              <Skeleton className="h-6 w-32 mb-2" />
              <Skeleton className="h-4 w-48 mb-4" />
              <div className="flex gap-2 mb-6">
                <Skeleton className="h-4 w-16 rounded-full" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <div className="mt-auto border-t border-neutral-100 pt-4 flex justify-between items-center">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-24 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : !currentTab.loading && !currentTab.error && totalCampaignsOnTab === 0 ? (
        /* Overall empty state */
        <div className="flex flex-col items-center justify-center text-center py-20 px-6">
          <Image src={emptyCampaignImg} alt="" width={200} height={200} className="mb-6" unoptimized />
          <h3 className="font-rethink font-medium text-[22px] text-neutral-900 mb-2">Nothing right now</h3>
          <p className="font-rethink text-xs text-neutral-500 font-medium max-w-xs leading-relaxed">
            New campaigns are added often. Check back soon.
          </p>
        </div>
      ) : (
        /* Sections */
        <div className="space-y-10 w-full">
          {/* Recommended for You */}
          {currentTab.recommended.items.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="font-rethink font-medium text-lg tracking-tighter text-neutral-900">Recommended for You</h2>
                <p className="text-xs font-medium text-neutral-500">Campaigns you can join that suit where your audience is.</p>
              </div>
              <CardGrid campaigns={currentTab.recommended.items} onOpen={open} appliedIds={appliedIds} />
              {currentTab.recommended.nextCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={currentTab.recommended.loadingMore}
                    onClick={() => loadMore("recommended")}
                    className="px-5 py-2.5 rounded-full bg-neutral-100 text-neutral-700 font-semibold text-xs font-rethink disabled:opacity-50"
                  >
                    {currentTab.recommended.loadingMore ? "Loading..." : "Show more"}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Trending */}
          {currentTab.trending.items.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="font-rethink font-medium text-lg tracking-tighter text-neutral-900">Trending</h2>
                <p className="text-xs font-medium text-neutral-500">
                  Campaigns the most creators joined or applied to in the last 3 days.
                </p>
              </div>
              <CardGrid campaigns={currentTab.trending.items} onOpen={open} appliedIds={appliedIds} />
              {currentTab.trending.nextCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={currentTab.trending.loadingMore}
                    onClick={() => loadMore("trending")}
                    className="px-5 py-2.5 rounded-full bg-neutral-100 text-neutral-700 font-semibold text-xs font-rethink disabled:opacity-50"
                  >
                    {currentTab.trending.loadingMore ? "Loading..." : "Show more"}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* New */}
          {currentTab.new.items.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="font-rethink font-medium text-lg tracking-tighter text-neutral-900">New</h2>
                <p className="text-xs font-medium text-neutral-500">Latest campaigns added to the platform.</p>
              </div>
              <CardGrid campaigns={currentTab.new.items} onOpen={open} appliedIds={appliedIds} />
              {currentTab.new.nextCursor && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={currentTab.new.loadingMore}
                    onClick={() => loadMore("new")}
                    className="px-5 py-2.5 rounded-full bg-neutral-100 text-neutral-700 font-semibold text-xs font-rethink disabled:opacity-50"
                  >
                    {currentTab.new.loadingMore ? "Loading..." : "Show more"}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Active placement limit warning banner */}
      {isAtLimit && showLimitBanner && (
        <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 z-50">
          <div className="bg-[#EBF3FF]/40 border border-[#BFDBFE] border-dashed rounded-[20px] p-2 flex items-center justify-between gap-3 text-left relative overflow-hidden">
            <div className="flex gap-3 items-center">
              <Image src={slotLimitImg} alt="" width={36} height={36} className="w-9 h-9 shrink-0" unoptimized />
              <h4 className="font-rethink text-xs font-medium text-neutral-900 leading-snug">
                You&apos;re at your active placement limit ({meta.activeSlots}/{meta.maxSlots}). Finish a placement to join something new.
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setShowLimitBanner(false)}
              className="w-8 h-8 rounded-full border border-neutral-200 flex items-center justify-center shrink-0 text-neutral-400"
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
