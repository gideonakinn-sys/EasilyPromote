"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import Image from "next/image";
import { Drawer, DrawerContent } from "@ep/ui/components/drawer";
import * as DrawerPrimitive from "vaul";
import { cn } from "@ep/ui/lib/utils";
import type { EligibilityFailure, JoinResult, MarketplaceCampaign, UsageRightsAcceptance } from "./types";
import type { JoinOutcome } from "./creator-dashboard-context";
import { AccessBadge, targetLocationLabel } from "./campaign-access-badge";
import { CampaignBriefDetails } from "./campaign-brief";
import { ACCESS_LABELS, accessOf, formatBonus, formatPay, placesLeftOf, platformLabel, platformsOf } from "../lib/campaign-pay";
import { useCampaignPlaces } from "../lib/socket";
import { CampaignApplyPanel, type ApplicationActions } from "./campaign-apply-panel";
import { UsageRightsTerms } from "./usage-rights-terms";
import { TrackedLinkCard } from "./tracked-link-card";
import { USAGE_TERMS_NOT_ACCEPTED, isClicksCampaign, needsUsageAcceptance } from "../lib/creator-campaign-terms";

interface MarketplaceDetailsDrawerProps {
  campaign: MarketplaceCampaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJoin: (campaignId: string, committedViews?: number, usageRightsAccepted?: UsageRightsAcceptance) => Promise<JoinOutcome>;
  // Why this creator can't take placements at all (no social account, no niches, at the limit).
  joinBlockedReason: string | null;
  onViewMyCampaigns: () => void;
  applications: ApplicationActions; // Campaign engine: applications (ticket 06)
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
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${n / 1000}k`;
  return n.toString();
}

interface CloseButtonProps {
  onClick: () => void;
}

function CloseButton({ onClick }: CloseButtonProps) {
  return (
    <button onClick={onClick} className="flex items-center justify-center w-8 h-8 rounded-full bg-neutral-200">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex justify-between items-center gap-4 font-rethink text-sm font-medium">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800 text-right">{children}</span>
    </div>
  );
}

interface ReasonListProps {
  title: string;
  reasons: string[];
}

function ReasonList({ title, reasons }: ReasonListProps) {
  if (reasons.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
      <p className="text-xs font-medium text-amber-900">{title}</p>
      <ul className="space-y-1">
        {reasons.map((reason) => (
          <li key={reason} className="text-xs font-medium text-amber-900 leading-relaxed">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface CampaignDrawerContentProps {
  campaign: MarketplaceCampaign;
  onJoin: MarketplaceDetailsDrawerProps["onJoin"];
  joinBlockedReason: string | null;
  isMobile: boolean;
  onClose: () => void;
  onViewMyCampaigns: () => void;
  applications: ApplicationActions;
}

function CampaignDrawerContent({
  campaign,
  onJoin,
  joinBlockedReason,
  isMobile,
  onClose,
  onViewMyCampaigns,
  applications,
}: CampaignDrawerContentProps) {
  const targetViews = campaign.targetViews || 0;
  // Content campaigns pay per deliverable, so there's no views share to commit to.
  const commitsViews = campaign.campaignModel !== "content" && targetViews > 0;
  const presets = commitsViews ? buildViewPresets(targetViews) : [];
  const [selectedViews, setSelectedViews] = useState<number | undefined>(presets[0]);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [error, setError] = useState<{ message: string; failures: EligibilityFailure[] } | null>(null);
  // M8 batch 7 (SPEC D30): custom usage terms must be accepted before joining.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedViews(commitsViews ? buildViewPresets(targetViews)[0] : undefined);
    setJoined(null);
    setError(null);
    setTermsAccepted(false);
    setTermsError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  const access = accessOf(campaign);
  const openCall = access === "open_call";
  const reasons = campaign.ineligibleReasons || [];
  // Places left change live while the drawer is open, even after the list drops a full campaign.
  const [livePlaces, setLivePlaces] = useState<number | null>(null);
  useCampaignPlaces(({ campaignId, placesLeft }) => {
    if (campaignId === campaign.id) setLivePlaces(placesLeft);
  });
  useEffect(() => setLivePlaces(null), [campaign.id, campaign.placesLeft]);
  const places = livePlaces ?? placesLeftOf(campaign);
  const creatorPool = campaign.creatorPool ?? 0;
  const viewsReward = commitsViews && selectedViews ? Math.floor((creatorPool * selectedViews) / targetViews) : 0;
  const termsRequired = needsUsageAcceptance(campaign);
  const canJoin =
    openCall && reasons.length === 0 && !joinBlockedReason && places > 0 && !joining && (!termsRequired || termsAccepted);

  const join = async () => {
    setJoining(true);
    setError(null);
    setTermsError(null);
    const acceptance = termsRequired && campaign.usageRights ? { version: campaign.usageRights.version } : undefined;
    const outcome = await onJoin(campaign.id, commitsViews ? selectedViews : undefined, acceptance);
    setJoining(false);
    if (outcome.ok) setJoined(outcome.result);
    else if (outcome.code === USAGE_TERMS_NOT_ACCEPTED) {
      // The terms may have changed since the list loaded: ask for a fresh tick.
      setTermsAccepted(false);
      setTermsError("Accept these usage terms to join. If they just changed, read them again first.");
    } else setError({ message: outcome.message, failures: outcome.failures });
  };

  return (
    <div className="relative flex flex-col h-full">
      <div className="hidden md:block absolute top-6 right-6 z-10">
        <CloseButton onClick={onClose} />
      </div>

      <div className={cn("flex-1 overflow-y-auto", isMobile ? "p-5 pb-[env(safe-area-inset-bottom)]" : "pt-16 pb-12 px-10")} data-lenis-prevent>
        <div className={cn("space-y-8", isMobile ? "w-full" : "w-[350px] mx-auto")}>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200 flex-shrink-0 overflow-hidden">
              {campaign.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={campaign.coverImageUrl} alt={campaign.title} className="w-full h-full object-cover" />
              ) : (
                <svg className="w-9 h-9 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
                </svg>
              )}
            </div>
            <div className="space-y-1.5">
              <h2 className="font-rethink font-medium text-xl text-neutral-900 leading-tight">{campaign.title}</h2>
              <AccessBadge campaign={campaign} />
            </div>
          </div>

          <div className="space-y-1">
            <p className="font-rethink font-medium text-2xl tracking-tight text-neutral-900">
              {formatPay(campaign.pay, campaign.reward)}
            </p>
            {/* Hybrid pay (ticket 10): base per approved deliverable, and what the bonus pays for. */}
            {campaign.pay?.bonus && (
              <p className="font-rethink text-xs font-medium text-neutral-500 leading-relaxed">
                {formatPay({ amount: campaign.pay.amount, unit: campaign.pay.unit })} base. {formatBonus(campaign.pay)}.
              </p>
            )}
          </div>

          {joined ? (
            <div className="space-y-6">
              <div className="bg-[#CBF5E5] rounded-2xl p-4 space-y-1">
                <p className="text-sm font-medium text-[#176448]">You&apos;re in</p>
                <p className="text-xs font-medium text-[#176448] leading-relaxed">
                  Your place is saved. Here&apos;s the full brief. It&apos;s also in your campaigns on Home.
                </p>
              </div>
              {isClicksCampaign(campaign) ? (
                <TrackedLinkCard campaignId={campaign.id} referralCode={joined.referralCode} destinationDomain={campaign.destinationDomain} />
              ) : joined.referralCode && (
                <div className="border border-neutral-200 rounded-2xl p-4 space-y-1">
                  <p className="text-xs font-medium text-neutral-500">Your referral code</p>
                  <p className="font-rethink font-medium text-lg text-neutral-900 tracking-tight">{joined.referralCode}</p>
                  <p className="text-[11px] font-medium text-neutral-500">Ask your audience to use it when they sign up.</p>
                </div>
              )}
              <CampaignBriefDetails brief={joined.brief} showSummary />
              <button
                onClick={onViewMyCampaigns}
                className="w-full py-3 rounded-full font-semibold text-sm font-rethink bg-[#FEB604] text-[#171717] border border-neutral-100"
              >
                Go to my campaigns
              </button>
            </div>
          ) : (
            <>
              {campaign.briefSummary && (
                <p className="font-rethink text-xs text-neutral-500 font-medium leading-relaxed">{campaign.briefSummary}</p>
              )}

              <div className="space-y-4 pt-2">
                <DetailRow label="Campaign by">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-neutral-200 flex items-center justify-center text-[10px] font-medium text-neutral-600 overflow-hidden shrink-0">
                      {campaign.brandAvatar ? (
                        <Image src={campaign.brandAvatar} alt="" width={28} height={28} className="object-cover" unoptimized />
                      ) : (
                        campaign.brandName.charAt(0)
                      )}
                    </span>
                    {campaign.brandName}
                  </span>
                </DetailRow>
                <DetailRow label="Platform">{platformsOf(campaign).map(platformLabel).join(", ") || "Any"}</DetailRow>
                <DetailRow label="Audience">{targetLocationLabel(campaign)}</DetailRow>
                <DetailRow label="Access">{ACCESS_LABELS[access]}</DetailRow>
                <DetailRow label="Places left">{places.toLocaleString()}</DetailRow>
                {commitsViews && <DetailRow label="Campaign target">{targetViews.toLocaleString()} views</DetailRow>}
                {isClicksCampaign(campaign) && campaign.destinationDomain && (
                  <DetailRow label="Link goes to">{campaign.destinationDomain}</DetailRow>
                )}
              </div>

              {isClicksCampaign(campaign) && (
                <p className="font-rethink text-xs font-medium text-neutral-500 leading-relaxed">
                  {openCall ? "Join to get your tracked link." : "You get your tracked link once the brand selects you."} You&apos;re paid
                  for each valid click, once per person per day.
                </p>
              )}

              {commitsViews && openCall && (
                <div className="space-y-4">
                  <h3 className="font-rethink font-medium text-base text-neutral-900">Commit to deliver</h3>
                  <p className="text-xs font-medium text-neutral-500">Choose how many views you can deliver</p>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((views) => (
                      <button
                        key={views}
                        onClick={() => setSelectedViews(views)}
                        className={cn(
                          "px-4 py-2 rounded-full text-xs font-medium font-rethink",
                          selectedViews === views ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
                        )}
                      >
                        {formatViews(views)}
                      </button>
                    ))}
                  </div>
                  <div className="border border-neutral-200 rounded-2xl p-4 flex justify-between text-sm font-rethink">
                    <span className="text-neutral-500 font-medium">Your reward</span>
                    <span className="font-medium text-neutral-900">₦{viewsReward.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {openCall && (
                <UsageRightsTerms
                  campaign={campaign}
                  accepted={termsAccepted}
                  onAcceptedChange={(value) => {
                    setTermsAccepted(value);
                    if (value) setTermsError(null);
                  }}
                  error={termsError}
                  disabled={joining}
                />
              )}

              {openCall && (
                <ReasonList title="You can't join yet" reasons={joinBlockedReason ? [joinBlockedReason, ...reasons] : reasons} />
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-medium text-red-800">{error.failures.length > 0 ? "You can't join yet" : error.message}</p>
                  {error.failures.length > 0 && (
                    <ul className="space-y-1">
                      {error.failures.map((f) => (
                        <li key={f.criterion + f.message} className="text-xs font-medium text-red-800 leading-relaxed">
                          {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {openCall ? (
                <button
                  onClick={join}
                  disabled={!canJoin}
                  className={cn(
                    "w-full py-3 rounded-full font-semibold text-sm font-rethink",
                    canJoin ? "bg-[#FEB604] text-[#171717] border border-neutral-100" : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                  )}
                >
                  {joining ? "Joining…" : places === 0 ? "Campaign full" : "Join Campaign"}
                </button>
              ) : (
                // Campaign engine: applications (ticket 06)
                <CampaignApplyPanel
                  campaign={campaign}
                  application={applications.list.find((a) => a.campaignId === campaign.id)}
                  reasons={reasons}
                  blockedReason={joinBlockedReason}
                  places={places}
                  onApply={applications.onApply}
                  onWithdraw={applications.onWithdraw}
                />
              )}

              <p className="text-[10px] text-neutral-400 font-medium font-rethink text-center leading-relaxed">
                The full brief, with do&apos;s and don&apos;ts, hashtags, sound and reference videos, unlocks once you {openCall ? "join" : "are selected"}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function MarketplaceDetailsDrawer({
  campaign,
  open,
  onOpenChange,
  onJoin,
  joinBlockedReason,
  onViewMyCampaigns,
  applications,
}: MarketplaceDetailsDrawerProps) {
  const isMobile = useIsMobile();

  if (!campaign) return null;

  const content = (
    <CampaignDrawerContent
      campaign={campaign}
      onJoin={onJoin}
      joinBlockedReason={joinBlockedReason}
      isMobile={isMobile}
      onClose={() => onOpenChange(false)}
      onViewMyCampaigns={onViewMyCampaigns}
      applications={applications}
    />
  );

  if (isMobile) {
    return (
      <DrawerPrimitive.Root open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerPrimitive.Portal>
          <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] transition-opacity duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DrawerPrimitive.Content className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white outline-none max-h-[90vh] overflow-hidden">
            <div className="w-10 h-1 bg-neutral-300 rounded-full mx-auto mt-3 mb-4 flex-shrink-0" />
            <div className="flex-1 overflow-hidden flex flex-col">{content}</div>
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="overflow-hidden p-0 bg-white">{content}</DrawerContent>
    </Drawer>
  );
}
