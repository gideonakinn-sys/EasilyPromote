"use client";

import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderOpenIcon, File02Icon, File01Icon, Download01Icon, MoneyReceiveFlow02Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import { Skeleton } from "./ui/skeleton";
import { useReveal } from "../hooks/use-reveal";
import { apiRequest, getToken } from "../lib/api";
import { DEFAULT_TIERS, computePriceForViews, type TierPoint } from "../lib/pricing";
import { codeFormatText, conversionNounFor, referralApi, type ReferralCodeRow, type ReferralSettings } from "../lib/referral";
import { CampaignReferrals } from "./campaign-referrals";
import { CampaignSetupSummary } from "./brand-wizard/campaign-setup-summary";
import { ConfirmDeleteModal } from "./confirm-delete-modal";
import { CampaignApplicants } from "./campaign-applicants"; // Campaign engine: applications (ticket 06)
import type { CampaignSetup } from "./types";
// Campaign engine: content approval (ticket 07)
import { ContentSubmissionsReview } from "./content-submissions-review";

import illustration3 from "@ep/ui/assets/illustrations/illustration3.svg";
import submissionsEmpty from "@ep/ui/assets/submissions-empty.png";
import payoutsEmpty from "@ep/ui/assets/Payouts empty.png";
import { CampaignStatementCard } from "./payment-statement";

type TabType = "Overview" | "Submission" | "Payouts" | "Referrals";

const PRESET_VIEWS = [100000, 1000000, 5000000, 10000000, 20000000] as const;

function formatCompact(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(value / 1000)}K`;
}

function parseViewsInput(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const num = parseInt(digits, 10);
  if (num < 100000) return null;
  return num;
}

interface IncreaseViewsContentProps {
  viewsInput: string;
  additionalViews: number;
  additionalCost: number;
  rate: number;
  paying: boolean;
  onViewsInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewsInputBlur: () => void;
  onPresetClick: (preset: number) => void;
  onPay: () => void;
}

function IncreaseViewsContent({
  viewsInput,
  additionalViews,
  additionalCost,
  rate,
  paying,
  onViewsInputChange,
  onViewsInputBlur,
  onPresetClick,
  onPay,
}: IncreaseViewsContentProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-rethink font-semibold text-base text-stone-900">Increase views</h3>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium text-stone-500 block">How many additional views do you want?</label>
          <input
            type="text"
            inputMode="numeric"
            value={viewsInput}
            onChange={onViewsInputChange}
            onBlur={onViewsInputBlur}
            placeholder="100,000"
            disabled={paying}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-full text-sm font-rethink font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 focus:ring-0 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <div className="flex gap-2">
            {PRESET_VIEWS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onPresetClick(preset)}
                disabled={paying}
                className={cn(
                  "flex-1 py-2 rounded-full text-xs font-medium font-rethink transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  additionalViews === preset
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-600"
                )}
              >
                {formatCompact(preset)}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-stone-400 font-medium">
            ₦{rate.toFixed(3)} per view
          </span>
        </div>

        <div className="border-t border-stone-100 pt-4 space-y-2">
          <div className="flex justify-between text-sm font-rethink">
            <span className="text-stone-500 font-medium">Additional views</span>
            <span className="font-medium text-stone-900">{additionalViews.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm font-rethink">
            <span className="text-stone-500 font-medium">Cost</span>
            <span className="font-medium text-stone-900">₦{additionalCost.toLocaleString()}</span>
          </div>
        </div>

        <button
          onClick={onPay}
          disabled={additionalViews === 0 || paying}
          className={cn(
            "w-full py-3 rounded-full text-sm font-semibold font-rethink border transition-colors",
            additionalViews > 0
              ? "bg-[#FEB604] text-[#1C1917] border-stone-100"
              : "bg-stone-200 text-stone-400 border-stone-200 cursor-not-allowed"
          )}
        >
          {paying ? "Redirecting..." : `Pay ₦${additionalCost.toLocaleString()}`}
        </button>
      </div>
    </div>
  );
}

interface CampaignData extends Partial<CampaignSetup> {
  id: string;
  name: string;
  category: string;
  coverImageUrl?: string;
  // Content campaigns have no view target.
  targetViews?: number;
  budget: number;
  costPerView: number;
  startDate: string;
  endDate: string;
  status: string;
  viewsDelivered: number;
  progressPercent: number;
  contentBrief?: string;
  keyMessageCta?: string;
  whatToAvoid?: string;
  goal?: string;
  competitors?: string;
  uniqueSellingPoint?: string;
  funFact?: string;
  scriptUrl?: string;
  scriptFileName?: string;
  platforms?: string[];
  contentStyle?: string[];
  platformFeePercent?: number;
  viewsReleased?: number;
  platformFee?: number;
  creatorPool?: number;
  creatorCount?: number;
  submissionsReceived: number;
  submissionsApproved: number;
  submissionsAwaitingReview: number;
  referral?: ReferralSettings & { budgetUsedPercent?: number };
  objective?: "views" | "actions";
}

interface SubmissionData {
  id: string;
  creatorId: string;
  creatorHandle: string;
  videoUrl?: string;
  caption?: string;
  durationSeconds?: number;
  uploadedAt: string;
  status: string;
  rejectionReason?: string;
  postedPlatforms?: { platform: string; postUrl: string; views: number; likes: number; comments: number }[];
  viewsDelivered?: number;
  payoutStatus?: string;
  payoutAmount?: number;
  postedAt?: string;
  reviewedAt?: string;
}

// A content campaign's money, from GET /payouts/campaign/:id (ticket 09).
interface ContentPayouts {
  deliverables: number;
  paidOut: number;
  owed: number;
  refundable: number;
  refunded: number;
  refundPending: number;
}

interface SubmissionCounts {
  new: number;
  approved: number;
  awaitingPost: number;
  posted: number;
  rejected: number;
}

interface CampaignDetailsProps {
  campaignId: string;
  onClose?: () => void;
  isMobile?: boolean;
}

function CreatorAvatar({ seed }: { seed: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-200 to-[#FEB604] border border-white flex items-center justify-center text-[10px] font-medium font-rethink text-stone-950 flex-shrink-0">
      {seed.substring(0, 2).toUpperCase()}
    </div>
  );
}

export function CampaignDetails({ campaignId, onClose, isMobile }: CampaignDetailsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("Overview");
  const [referralCodes, setReferralCodes] = useState<ReferralCodeRow[] | null>(null);
  const [codePrefix, setCodePrefix] = useState<string | undefined>(undefined);

  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionData[]>([]);
  const [counts, setCounts] = useState<SubmissionCounts>({ new: 0, approved: 0, awaitingPost: 0, posted: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submissionsError, setSubmissionsError] = useState("");

  const [showIncreaseViews, setShowIncreaseViews] = useState(false);
  const [additionalViews, setAdditionalViews] = useState(0);
  const [viewsInput, setViewsInput] = useState("");
  const [tiers, setTiers] = useState<TierPoint[]>(DEFAULT_TIERS);
  const [paying, setPaying] = useState(false);
  const [topupSuccess, setTopupSuccess] = useState(false);
  const [topupError, setTopupError] = useState("");
  const [actionError, setActionError] = useState("");
  const [contentPayouts, setContentPayouts] = useState<ContentPayouts | null>(null);

  useReveal(activeTab);

  const fetchCampaign = useCallback(async () => {
    try {
      const token = getToken();
      const data = await apiRequest<CampaignData>(`/campaigns/${campaignId}`, { token: token || undefined });
      setCampaign(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign");
    }
  }, [campaignId]);

  const fetchSubmissions = useCallback(async () => {
    setSubmissionsError("");
    try {
      const token = getToken();
      const data = await apiRequest<{ counts: SubmissionCounts; submissions: SubmissionData[] }>(
        `/submissions/campaign/${campaignId}`,
        { token: token || undefined }
      );
      setSubmissions(data.submissions || []);
      setCounts(data.counts || { new: 0, approved: 0, awaitingPost: 0, posted: 0, rejected: 0 });
    } catch {
      setSubmissionsError("Failed to load submissions");
    }
  }, [campaignId]);

  // Each creator's code, shown on the overview so brands can see them without opening Referrals.
  const referralEnabled = Boolean(campaign?.referral?.enabled);
  useEffect(() => {
    if (!referralEnabled) return;
    let cancelled = false;
    referralApi
      .listCodes(campaignId)
      .then((payload) => {
        if (cancelled) return;
        setReferralCodes(payload.codes);
        setCodePrefix(payload.codePrefix);
      })
      .catch(() => {
        if (!cancelled) setReferralCodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, referralEnabled]);

  // Content campaigns: what's been paid out, what creators are still owed and what's refundable.
  const isContentCampaign = campaign?.campaignModel === "content";
  useEffect(() => {
    if (!isContentCampaign || activeTab !== "Payouts") return;
    let cancelled = false;
    apiRequest<{ content: ContentPayouts | null }>(`/payouts/campaign/${campaignId}`, { token: getToken() || undefined })
      .then((data) => {
        if (!cancelled) setContentPayouts(data.content);
      })
      .catch(() => {
        if (!cancelled) setContentPayouts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, isContentCampaign, activeTab]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchCampaign(), fetchSubmissions()]);
      setLoading(false);
    };
    load();
  }, [fetchCampaign, fetchSubmissions]);

  useEffect(() => {
    apiRequest<{ tiers: TierPoint[] }>("/campaigns/pricing")
      .then((data) => {
        if (data.tiers && data.tiers.length > 0) setTiers(data.tiers);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("topup") === "success" && params.get("reference")) {
      const reference = params.get("reference")!;
      const amount = parseInt(params.get("amount") || "0", 10);
      if (amount > 0) {
        apiRequest(`/campaigns/${campaignId}/topup`, {
          method: "PATCH",
          token: getToken() || undefined,
          body: JSON.stringify({ amount, paystackReference: reference }),
        }).then(() => {
          setTopupSuccess(true);
          fetchCampaign();
          window.history.replaceState({}, "", `/dashboard/brand/campaign/${campaignId}`);
        }).catch((err: unknown) => {
          setTopupError(err instanceof Error ? err.message : "Failed to verify payment. Please contact support.");
        });
      }
    }
  }, [campaignId, fetchCampaign]);

  // Back from paying for referral budget: open the Referrals tab, which confirms the payment.
  const [referralTopupReference, setReferralTopupReference] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference");
    if (params.get("referralTopup") === "success" && reference) {
      setReferralTopupReference(reference);
      setActiveTab("Referrals");
      window.history.replaceState({}, "", `/dashboard/brand/campaign/${campaignId}`);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!topupSuccess) return;
    const timer = setTimeout(() => setTopupSuccess(false), 5000);
    return () => clearTimeout(timer);
  }, [topupSuccess]);

  useEffect(() => {
    if (!topupError) return;
    const timer = setTimeout(() => setTopupError(""), 5000);
    return () => clearTimeout(timer);
  }, [topupError]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteDraft = async () => {
    setDeleting(true);
    try {
      const token = getToken();
      await apiRequest(`/campaigns/${campaignId}`, { method: "DELETE", token: token || undefined });
      setShowDeleteConfirm(false);
      onClose?.();
    } catch (err: unknown) {
      setShowDeleteConfirm(false);
      setActionError(err instanceof Error ? err.message : "We couldn't delete this campaign.");
    } finally {
      setDeleting(false);
    }
  };

  const getPriceForViews = useCallback((views: number) => computePriceForViews(tiers, views), [tiers]);

  const handleViewsInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const num = parseViewsInput(raw);
    if (num !== null) {
      setViewsInput(num.toLocaleString());
      setAdditionalViews(num);
    } else {
      setViewsInput(raw.replace(/[^0-9,]/g, ""));
    }
  }, []);

  const handleViewsInputBlur = useCallback(() => {
    if (additionalViews > 0) {
      setViewsInput(additionalViews.toLocaleString());
    } else {
      setViewsInput("");
    }
  }, [additionalViews]);

  const handlePresetClick = useCallback((preset: number) => {
    setViewsInput(preset.toLocaleString());
    setAdditionalViews(preset);
  }, []);

  const additionalCost =
    additionalViews > 0
      ? getPriceForViews((campaign?.targetViews || 0) + additionalViews) - getPriceForViews(campaign?.targetViews || 0)
      : 0;

  const handlePayTopup = useCallback(async () => {
    if (additionalViews === 0) return;
    setPaying(true);
    try {
      const data = await apiRequest<{ authorization_url: string }>(`/campaigns/${campaignId}/topup-init`, {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ amount: additionalCost }),
      });
      window.location.href = data.authorization_url;
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to initialize payment");
      setPaying(false);
    }
  }, [campaignId, additionalViews, additionalCost]);

  if (loading) {
    return (
      <div className={cn("flex h-full bg-stone-100", isMobile && "flex-col")}>
        {isMobile ? (
          <>
            <div className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14 border-b border-stone-200 flex-shrink-0">
              <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
              <Skeleton className="h-5 w-40 rounded-lg" />
            </div>
            <div className="p-5 space-y-6 overflow-y-auto flex-1" data-lenis-prevent>
              <div className="flex gap-3">
                <Skeleton className="h-9 w-20 rounded-xl" />
                <Skeleton className="h-9 w-24 rounded-xl" />
                <Skeleton className="h-9 w-16 rounded-xl" />
              </div>
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          </>
        ) : (
          <>
            <div className="w-56 flex flex-col pt-28 gap-3 pl-16 pr-4 flex-shrink-0">
              <Skeleton className="h-9 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-xl" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
            <div className="flex-1 p-12 space-y-6">
              <Skeleton className="h-6 w-48" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-32 rounded-2xl" />
            </div>
          </>
        )}
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-stone-500 font-rethink text-sm tracking-[-0.01em]">{error || "Campaign not found"}</span>
        {onClose && (
          <button onClick={onClose} className="text-sm font-medium text-stone-900 underline">
            Go back
          </button>
        )}
      </div>
    );
  }

  const currentStatus = campaign.status;
  const formattedBudget = `₦${campaign.budget.toLocaleString()}`;
  const formattedTarget = `${(campaign.targetViews || 0).toLocaleString()} views`;
  const isContent = campaign.campaignModel === "content";

  const totalEscrowed = campaign.budget;
  // platformFeePercent is stored as a whole percentage (30 means 30%).
  const feePercent = campaign.platformFeePercent ?? 30;
  // Content campaigns add the fee on top of creators' pay (D2); views campaigns take it from inside the price.
  const platformFee =
    campaign.platformFee ||
    (isContent
      ? Math.round(campaign.budget - campaign.budget / (1 + feePercent / 100))
      : Math.round(campaign.budget * (feePercent / 100)));
  const creatorPool = campaign.creatorPool || totalEscrowed - platformFee;
  // Settled views payouts from the ledger; submissions never stored payout amounts.
  const releasedTotal = campaign.viewsReleased ?? 0;
  const pendingEscrow = Math.max(0, creatorPool - releasedTotal);

  const uniqueCreatorCount = new Set(submissions.map(s => s.creatorId)).size;
  const creatorsOnCampaign = campaign.creatorCount ?? uniqueCreatorCount;

  return (
    <div className={cn("h-full bg-stone-100", isMobile ? "flex flex-col" : "flex relative")}>
      {!isMobile && onClose && (
        <button
          onClick={onClose}
          aria-label="Close campaign details"
          className="absolute top-6 right-6 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-stone-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {/* Mobile Header */}
      {isMobile && (
        <div className="flex items-center gap-3 px-5 pt-[env(safe-area-inset-top)] h-14 border-b border-stone-200 bg-stone-100 flex-shrink-0">
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <h3 className="font-rethink font-semibold text-base text-stone-900 truncate flex-1">{campaign.name}</h3>
        </div>
      )}

      {/* Mobile Horizontal Tabs */}
      {isMobile && (
        <div className="flex gap-3 px-5 py-3 bg-stone-100 border-b border-stone-200 flex-shrink-0 overflow-x-auto">
          {([
            { label: "Overview",    value: "Overview"   as TabType },
            { label: "Submissions", value: "Submission" as TabType },
            { label: "Payouts",     value: "Payouts"    as TabType },
            { label: "Referrals",   value: "Referrals"  as TabType },
          ]).map(({ label, value }) => {
            const isActive = activeTab === value;
            return (
              <button
                key={value}
                onClick={() => setActiveTab(value)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium font-rethink whitespace-nowrap flex-shrink-0",
                  isActive
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-500"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Desktop Left Sidebar – tabs */}
      {!isMobile && (
        <div className="w-56 flex flex-col pt-28 gap-8 flex-shrink-0 bg-stone-100">
          <div className="flex flex-col gap-1 pl-16 pr-4">
            {([
              { label: "Overview",    value: "Overview"   as TabType },
              { label: "Submissions", value: "Submission" as TabType },
              { label: "Payouts",     value: "Payouts"    as TabType },
              { label: "Referrals",   value: "Referrals"  as TabType },
            ]).map(({ label, value }) => {
              const isActive = activeTab === value;
              return (
                <button
                  key={value}
                  onClick={() => setActiveTab(value)}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium font-rethink transition-all duration-150 text-left",
                    isActive
                      ? "bg-stone-100 text-stone-900"
                      : "text-stone-400"
                  )}
                >
                  {value === "Overview" && (
                    <HugeiconsIcon icon={File02Icon} size={16} className="flex-shrink-0" />
                  )}
                  {value === "Submission" && <HugeiconsIcon icon={FolderOpenIcon} size={16} className="flex-shrink-0" />}
                  {value === "Payouts" && (
                    <HugeiconsIcon icon={MoneyReceiveFlow02Icon} size={16} className="flex-shrink-0" />
                  )}
                  {value === "Referrals" && <HugeiconsIcon icon={Link01Icon} size={16} className="flex-shrink-0" />}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Right Dashboard Area */}
      <div className={cn(
        "flex-1 overflow-y-auto h-full",
        isMobile ? "p-5 pb-[env(safe-area-inset-bottom)]" : "pt-16 pb-12 px-10"
      )} data-lenis-prevent>
        {/* ================= TAB 1: OVERVIEW ================= */}
        {activeTab === "Overview" && (
          <div className={cn("space-y-8 pb-10", isMobile ? "w-full" : "w-[350px] mx-auto")}>
            {/* Header Section */}
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200 flex-shrink-0 overflow-hidden">
                {campaign.coverImageUrl ? (
                  <img src={campaign.coverImageUrl} alt={campaign.name} className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-9 h-9 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
                  </svg>
                )}
              </div>
              <div className="space-y-1.5">
                <h2 className="font-rethink font-medium tracking-tighter text-xl text-stone-900 leading-tight">
                  {campaign.name}
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 font-medium text-[10px] font-rethink">
                  {campaign.category}
                </span>
              </div>
            </div>

            {/* Action Button */}
            <div>
              {(currentStatus === "draft" || currentStatus === "pending_payment") ? (
                <button onClick={() => setShowDeleteConfirm(true)} className="w-full py-3 bg-red-50 text-red-600 font-semibold text-sm rounded-full border border-red-200 font-rethink">
                  Delete campaign
                </button>
              ) : isContent ? null : (
                <button
                  onClick={() => setShowIncreaseViews(!showIncreaseViews)}
                  className="w-full py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink"
                >
                  Increase views
                </button>
              )}
            </div>

            {/* Campaign Description */}
            {campaign.contentBrief && (
              <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">{campaign.contentBrief}</p>
            )}

            {campaign.keyMessageCta && (
              <div className="space-y-1.5">
                <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">Key message</h5>
                <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">{campaign.keyMessageCta}</p>
              </div>
            )}

            {campaign.whatToAvoid && (
              <div className="space-y-1.5">
                <h5 className="text-xs font-medium text-stone-500 font-rethink tracking-[-0.01em]">What to avoid</h5>
                <p className="font-rethink text-sm text-stone-900 font-medium leading-relaxed tracking-[-0.01em]">{campaign.whatToAvoid}</p>
              </div>
            )}

            {/* Campaign Details Key-Value List */}
            <div className="space-y-4 pt-2">
              {!isContent && (
                <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500">Target Views</span>
                  <span className="text-stone-800">{formattedTarget}</span>
                </div>
              )}
              <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                <span className="text-stone-500">Budget</span>
                <span className="text-stone-800">{formattedBudget}</span>
              </div>
              {campaign.platforms && campaign.platforms.length > 0 && (
                <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500">Platforms</span>
                  <span className="text-stone-800">{campaign.platforms.join(", ")}</span>
                </div>
              )}
              {campaign.contentStyle && campaign.contentStyle.length > 0 && (
                <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500">Content style</span>
                  <span className="text-stone-800">{Array.isArray(campaign.contentStyle) ? campaign.contentStyle.join(", ") : campaign.contentStyle}</span>
                </div>
              )}
              {campaign.goal && (
                <div className="flex justify-between items-start font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500 shrink-0 mr-4">Campaign goal</span>
                  <span className="text-stone-800 text-right">{campaign.goal}</span>
                </div>
              )}
              {campaign.competitors && (
                <div className="flex justify-between items-start font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500 shrink-0 mr-4">Competitors</span>
                  <span className="text-stone-800 text-right">{campaign.competitors}</span>
                </div>
              )}
              {campaign.uniqueSellingPoint && (
                <div className="flex justify-between items-start font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500 shrink-0 mr-4">Unique selling point</span>
                  <span className="text-stone-800 text-right">{campaign.uniqueSellingPoint}</span>
                </div>
              )}
              {campaign.funFact && (
                <div className="flex justify-between items-start font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500 shrink-0 mr-4">Fun fact</span>
                  <span className="text-stone-800 text-right">{campaign.funFact}</span>
                </div>
              )}
              {campaign.scriptUrl && (
                <div className="flex justify-between items-center font-rethink text-sm font-medium tracking-[-0.01em]">
                  <span className="text-stone-500">Script</span>
                  <a
                    href={campaign.scriptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-stone-200 rounded-full"
                  >
                    <HugeiconsIcon icon={File01Icon} size={14} className="text-stone-900 shrink-0" />
                    <span className="text-sm font-medium text-stone-900">{campaign.scriptFileName || "Download brief"}</span>
                    <HugeiconsIcon icon={Download01Icon} size={14} className="text-stone-900 shrink-0" />
                  </a>
                </div>
              )}
            </div>

            {/* Desktop inline expansion */}
            {showIncreaseViews && !isMobile && (
              <div className="border border-stone-200 rounded-2xl p-5 space-y-4">
                <IncreaseViewsContent
                  viewsInput={viewsInput}
                  additionalViews={additionalViews}
                  additionalCost={additionalCost}
                  rate={additionalViews > 0 ? additionalCost / additionalViews : 0}
                  paying={paying}
                  onViewsInputChange={handleViewsInputChange}
                  onViewsInputBlur={handleViewsInputBlur}
                  onPresetClick={handlePresetClick}
                  onPay={handlePayTopup}
                />
                <button
                  onClick={() => setShowIncreaseViews(false)}
                  className="w-full py-2 text-xs font-medium text-stone-500 font-rethink"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Status Alert Box — Under Review (standalone) */}
            {currentStatus === "under_review" && (
              <div className="flex items-center gap-4 border border-dashed rounded-[16px] p-2" style={{ backgroundColor: "#FEFCE8", borderColor: "#854D0E", paddingLeft: 0 }}>
                <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center overflow-hidden">
                  <img src="/images/under review.png" alt="Under review" className="w-full h-full object-contain" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-rethink font-medium text-sm" style={{ color: "#854D0E" }}>Under review</h4>
                  <p className="font-rethink text-xs font-medium leading-normal" style={{ color: "#854D0E" }}>
                    We&apos;re reviewing your campaign. It&apos;ll go live within 2 hours.
                  </p>
                </div>
              </div>
            )}

            {/* Status Alert Box — Completed / Paused / Cancelled */}
            {(currentStatus === "completed" || currentStatus === "cancelled" || currentStatus === "paused") && (
              <div className={cn(
                "flex items-start gap-4 border border-dashed rounded-[20px] p-4 relative overflow-hidden",
                currentStatus === "cancelled" ? "bg-red-50 border-red-200" : "bg-[#EBF3FF] border-blue-200"
              )}>
                <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center">
                  <Image src={illustration3} alt="Status" width={48} height={48} />
                </div>
                <div className="space-y-1 mt-0.5">
                  {currentStatus === "completed" && (
                    <>
                      <h4 className="font-rethink font-medium text-sm text-green-800">Completed</h4>
                      <p className="font-rethink text-xs text-stone-600 font-medium leading-normal">
                        Target reached. All funds have been released.
                      </p>
                    </>
                  )}
                  {currentStatus === "paused" && (
                    <>
                      <h4 className="font-rethink font-medium text-sm text-[#92400E]">Paused</h4>
                      <p className="font-rethink text-xs text-stone-600 font-medium leading-normal">
                        This campaign is paused. Resume it when you&apos;re ready.
                      </p>
                    </>
                  )}
                  {currentStatus === "cancelled" && (
                    <>
                      <h4 className="font-rethink font-medium text-sm text-red-800">Cancelled</h4>
                      <p className="font-rethink text-xs text-stone-600 font-medium leading-normal">
                        This campaign was cancelled. Unspent budget has been refunded.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Campaign engine: applications (ticket 06) */}
            {campaign.creatorAccess === "application_required" && campaign.status !== "draft" && campaign.status !== "pending_payment" && (
              <CampaignApplicants campaignId={campaign.id} />
            )}

            {campaign.campaignObjective && (
              <CampaignSetupSummary
                setup={{
                  campaignObjective: campaign.campaignObjective,
                  contentPay: campaign.contentPay ?? null,
                  hybridBonus: campaign.hybridBonus ?? null,
                  targetViews: isContent ? undefined : campaign.targetViews,
                  referralBudget: campaign.referral?.requestedBudget,
                  contentDestination: campaign.contentDestination ?? null,
                  creatorAccess: campaign.creatorAccess ?? null,
                  audienceTargeting: campaign.audienceTargeting || {},
                  creatorEligibility: campaign.creatorEligibility || {},
                  brief: campaign.brief || {},
                }}
              />
            )}

            <div className="border border-dashed border-stone-200 rounded-2xl p-4 space-y-4">
              {/* Campaign Progress (views campaigns) */}
              {!isContent && (<>
              <div className="space-y-2">
                <span className="text-xs font-medium text-stone-500 block">Campaign progress</span>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${campaign.progressPercent}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-stone-500 font-rethink">{campaign.progressPercent}%</span>
                </div>
                <span className="text-xs text-stone-500 font-medium font-rethink">
                  {campaign.viewsDelivered.toLocaleString()} / {(campaign.targetViews || 0).toLocaleString()} views
                </span>
              </div>
              </>)}

              {campaign.referral?.enabled && (
                <>
                  <div className="border-t border-dashed border-stone-200" />
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-stone-500 block">Referral progress</span>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#176448] rounded-full transition-all"
                          style={{ width: `${campaign.referral.budgetUsedPercent ?? 0}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-stone-500 font-rethink">{campaign.referral.budgetUsedPercent ?? 0}%</span>
                    </div>
                    <span className="text-xs text-stone-500 font-medium font-rethink">
                      {campaign.referral.conversions.toLocaleString()}{" "}
                      {conversionNounFor(campaign.referral.eventTypes, campaign.referral.conversions)} through creators&apos; codes
                      {" · "}
                      {campaign.referral.budgetUsedPercent ?? 0}% of referral budget used
                    </span>
                  </div>

                  <div className="border-t border-dashed border-stone-200" />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-stone-500 block">Referral codes</span>
                      {referralCodes && referralCodes.length > 0 && (
                        <button
                          onClick={() => setActiveTab("Referrals")}
                          className="text-xs font-semibold text-stone-900 underline underline-offset-2"
                        >
                          View all
                        </button>
                      )}
                    </div>
                    {referralCodes === null ? (
                      <Skeleton className="h-8 rounded-xl" />
                    ) : referralCodes.length === 0 ? (
                      <p className="text-xs text-stone-500 font-medium font-rethink leading-relaxed">
                        {codeFormatText(codePrefix)} No creators have joined yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {referralCodes.slice(0, 5).map((row) => (
                          <li key={row.slotId} className="flex items-center justify-between gap-3 text-xs font-rethink">
                            <span className="text-stone-500 font-medium truncate">
                              {row.creatorUsername ? `@${row.creatorUsername}` : row.creatorName || "Creator"}
                            </span>
                            <span className="font-mono text-stone-900 shrink-0">{row.code || "Code pending"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {!isContent && <div className="border-t border-dashed border-stone-200" />}

              {/* Creators on Campaign */}
              <div className="space-y-1">
                <span className="text-xs font-medium text-stone-500 block">Creators on campaign</span>
                <span className="text-base font-medium text-stone-900 block font-rethink">
                  {creatorsOnCampaign} creator{creatorsOnCampaign !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: SUBMISSION ================= */}
        {activeTab === "Submission" && (
          <div className={cn("space-y-6 pb-10", isMobile ? "w-full" : campaign.campaignModel === "content" ? "w-[520px] mx-auto" : "w-[350px] mx-auto")}>
            {/* Campaign engine: content approval (ticket 07) */}
            {campaign.campaignModel === "content" ? (
              <ContentSubmissionsReview campaignId={campaign.id} isMobile={isMobile} />
            ) : submissionsError ? (
              <div className="text-center py-12 space-y-4 flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <h3 className="font-rethink font-medium text-lg text-stone-900">Failed to load</h3>
                <p className="font-rethink text-xs text-stone-500 font-medium">{submissionsError}</p>
                <button
                  onClick={() => fetchSubmissions()}
                  className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium font-rethink rounded-full"
                >
                  Try again
                </button>
              </div>
            ) : submissions.filter(s => s.status === "posted").length > 0 ? (
              <div className="space-y-4">
                {submissions.filter(s => s.status === "posted").map((sub) => (
                  <div key={sub.id} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-rethink font-medium text-sm text-stone-900">@{sub.creatorHandle}</span>
                      <CreatorAvatar seed={sub.creatorHandle} />
                    </div>
                    {sub.caption && <p className="font-rethink text-xs text-stone-500 font-medium">{sub.caption}</p>}
                    {sub.postedPlatforms && sub.postedPlatforms.length > 0 && (
                      <div className="flex gap-2 text-[10px] text-stone-400">
                        {sub.postedPlatforms.map((p, i) => (
                          <span key={i} className="font-rethink px-2 py-0.5 bg-stone-100 rounded-full">{p.platform}: {p.views.toLocaleString()} views</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 space-y-4 flex flex-col items-center">
                <Image src={submissionsEmpty} alt="Nothing yet" width={120} height={120} />
                <h3 className="font-rethink font-semibold tracking-tighter md:text-2xl text-xl text-stone-900">Nothing waiting on you</h3>
                <p className="font-rethink text-xs text-stone-500 font-medium">New content will show up here as creators upload on their platforms</p>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: PAYOUTS ================= */}
        {activeTab === "Payouts" && (
          <div className={cn("space-y-10 pb-10", isMobile ? "w-full" : "w-[520px] mx-auto")}>
            {!["draft", "pending_payment"].includes(campaign.status) && <CampaignStatementCard campaignId={campaign.id} />}
            {isContent ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: "Paid Out", value: contentPayouts?.paidOut ?? 0 },
                  { label: "Owed To Creators", value: contentPayouts?.owed ?? 0 },
                  {
                    label: "Refundable",
                    value: contentPayouts?.refundable ?? 0,
                  },
                ].map((item) => (
                  <div key={item.label} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                    <span className="text-[10px] font-medium text-stone-500 block">{item.label}</span>
                    <span className="font-rethink font-medium text-xl text-stone-900 block">₦{item.value.toLocaleString()}</span>
                  </div>
                ))}
                {contentPayouts && contentPayouts.refunded + contentPayouts.refundPending > 0 && (
                  <p className="sm:col-span-3 font-rethink text-xs text-stone-500 font-medium">
                    ₦{(contentPayouts.refunded + contentPayouts.refundPending).toLocaleString()} of unused budget refunded to you
                    {contentPayouts.refundPending > 0 && " (on its way)"}.
                  </p>
                )}
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block">Total escrowed</span>
                <span className="font-rethink font-medium text-xl text-stone-900 block">₦{totalEscrowed.toLocaleString()}</span>
              </div>
              <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block">Paid</span>
                <span className="font-rethink font-medium text-xl text-stone-900 block">₦{releasedTotal.toLocaleString()}</span>
              </div>
              <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block">Pending in escrow</span>
                <span className="font-rethink font-medium text-xl text-stone-900 block">₦{pendingEscrow.toLocaleString()}</span>
              </div>
            </div>
            )}

            {submissions.filter(s => s.payoutStatus).length === 0 && (
              <div className="text-center py-12 space-y-4 flex flex-col items-center">
                <Image src={payoutsEmpty} alt="Nothing yet" width={120} height={120} />
                <h3 className="font-rethink font-semibold tracking-tighter md:text-2xl text-xl text-stone-900">Nothing to show yet</h3>
                <p className="font-rethink text-xs text-stone-500 font-medium">Your first transaction will appear here once placements start delivering.</p>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 4: REFERRALS ================= */}
        {activeTab === "Referrals" && (
          <div className={cn("pb-10", isMobile ? "w-full" : "w-[520px] mx-auto")}>
            <CampaignReferrals
              campaignId={campaign.id}
              campaignStatus={campaign.status}
              initialSettings={campaign.referral}
              topupReference={referralTopupReference}
              onTopupHandled={() => setReferralTopupReference(null)}
            />
          </div>
        )}
      </div>

      {/* Mobile bottom sheet for Increase views */}
      <MobileDrawer open={showIncreaseViews} onOpenChange={setShowIncreaseViews}>
        <IncreaseViewsContent
          viewsInput={viewsInput}
          additionalViews={additionalViews}
          additionalCost={additionalCost}
          rate={additionalViews > 0 ? additionalCost / additionalViews : 0}
          paying={paying}
          onViewsInputChange={handleViewsInputChange}
          onViewsInputBlur={handleViewsInputBlur}
          onPresetClick={handlePresetClick}
          onPay={handlePayTopup}
        />
      </MobileDrawer>

      {/* Topup success banner */}
      {topupSuccess && (
        <div className="fixed top-4 left-4 right-4 z-[60] bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="space-y-1">
            <p className="font-rethink font-medium text-sm text-green-800">Views topped up!</p>
            <p className="font-rethink text-xs text-green-600 font-medium">Your campaign budget and views have been updated.</p>
          </div>
          <button onClick={() => setTopupSuccess(false)} className="text-green-400 ml-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Delete and payment errors */}
      {actionError && (
        <div className="fixed top-4 left-4 right-4 z-[60] bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3" role="alert">
          <div className="space-y-1">
            <p className="font-rethink font-medium text-sm text-red-800">Something went wrong</p>
            <p className="font-rethink text-xs text-red-600 font-medium">{actionError}</p>
          </div>
          <button onClick={() => setActionError("")} aria-label="Dismiss" className="text-red-400 ml-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Topup error banner */}
      {topupError && (
        <div className="fixed top-4 left-4 right-4 z-[60] bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-600"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <div className="space-y-1">
            <p className="font-rethink font-medium text-sm text-red-800">Payment verification failed</p>
            <p className="font-rethink text-xs text-red-600 font-medium">{topupError}</p>
          </div>
          <button onClick={() => setTopupError("")} className="text-red-400 ml-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      <ConfirmDeleteModal
        open={showDeleteConfirm}
        title="Delete this campaign?"
        busy={deleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteDraft}
      />
    </div>
  );
}
