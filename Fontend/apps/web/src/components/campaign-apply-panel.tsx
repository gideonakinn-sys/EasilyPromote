"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import type { EligibilityFailure, MarketplaceCampaign } from "./types";
import { useCreatorDashboard } from "./creator-dashboard-context";
import { ApplicationStatusBadge } from "./application-status-badge";

// Campaign engine: applications (ticket 06)
// Apply on an Application Required campaign: an optional pitch, then a confirmation.
const MAX_PITCH = 500;

interface CampaignApplyPanelProps {
  campaign: MarketplaceCampaign;
  // Campaign rules this creator misses, and account-wide ones (no social, niches, limit).
  reasons: string[];
  blockedReason: string | null;
  places: number;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export function CampaignApplyPanel({ campaign, reasons, blockedReason, places }: CampaignApplyPanelProps) {
  const { applications, handleApplyToCampaign, handleWithdrawApplication } = useCreatorDashboard();
  const application = applications.find((a) => a.campaignId === campaign.id);
  const [pitch, setPitch] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [justApplied, setJustApplied] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; failures: EligibilityFailure[] } | null>(null);

  React.useEffect(() => {
    setPitch("");
    setJustApplied(false);
    setError(null);
  }, [campaign.id]);

  const allReasons = blockedReason ? [blockedReason, ...reasons] : reasons;
  // Withdrawn and expired applications can be sent again.
  const canReapply = !application || application.status === "withdrawn" || application.status === "expired";
  const canApply = canReapply && allReasons.length === 0 && places > 0 && !sending;

  const apply = async () => {
    setSending(true);
    setError(null);
    const outcome = await handleApplyToCampaign(campaign.id, pitch);
    setSending(false);
    if (outcome.ok) setJustApplied(true);
    else setError({ message: outcome.message, failures: outcome.failures });
  };

  const withdraw = async () => {
    setWithdrawing(true);
    const ok = await handleWithdrawApplication(campaign.id);
    setWithdrawing(false);
    if (ok) setJustApplied(false);
  };

  if (application && application.status === "pending") {
    return (
      <div className="space-y-4">
        <div className="bg-[#DBEAFE] rounded-2xl p-4 space-y-1">
          <p className="text-sm font-medium text-[#1E40AF]">{justApplied ? "Application sent" : "You've applied"}</p>
          <p className="text-xs font-medium text-[#1E40AF] leading-relaxed">
            The brand reviews applicants and picks who takes part. We&apos;ll tell you as soon as they decide
            {application.expiresAt ? `. Your application stays open until ${formatDate(application.expiresAt)}.` : "."}
          </p>
        </div>
        {application.pitch && (
          <div className="border border-stone-200 rounded-2xl p-4 space-y-1">
            <p className="text-xs font-medium text-stone-500">Your pitch</p>
            <p className="text-xs font-medium text-stone-800 leading-relaxed">{application.pitch}</p>
          </div>
        )}
        <button
          type="button"
          onClick={withdraw}
          disabled={withdrawing}
          className="w-full py-3 rounded-full font-semibold text-sm font-rethink bg-stone-100 text-stone-900 disabled:opacity-50"
        >
          {withdrawing ? "Withdrawing…" : "Withdraw Application"}
        </button>
      </div>
    );
  }

  if (application && !canReapply) {
    return (
      <div className="border border-stone-200 rounded-2xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-stone-500">Your application</p>
          <ApplicationStatusBadge status={application.status} />
        </div>
        {application.status === "rejected" && application.rejectionReason && (
          <p className="text-xs font-medium text-stone-700 leading-relaxed">&quot;{application.rejectionReason}&quot;</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {allReasons.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-medium text-amber-900">You can&apos;t apply yet</p>
          <ul className="space-y-1">
            {allReasons.map((reason) => (
              <li key={reason} className="text-xs font-medium text-amber-900 leading-relaxed">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {allReasons.length === 0 && places > 0 && (
        <div className="space-y-2">
          <label htmlFor="application-pitch" className="text-xs font-medium text-stone-500 block">
            Why you? (Optional)
          </label>
          <textarea
            id="application-pitch"
            value={pitch}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPitch(e.target.value.slice(0, MAX_PITCH))}
            rows={3}
            placeholder="A line or two on why you're a good fit"
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-rethink font-medium placeholder-stone-300 focus:outline-none focus:border-stone-400 resize-none"
          />
          <p className="text-[10px] font-medium text-stone-400 text-right">
            {pitch.length}/{MAX_PITCH}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-medium text-red-800">{error.failures.length > 0 ? "You can't apply yet" : error.message}</p>
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

      <div className="space-y-2">
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          className={cn(
            "w-full py-3 rounded-full font-semibold text-sm font-rethink",
            canApply ? "bg-[#FEB604] text-[#1C1917] border border-stone-100" : "bg-stone-200 text-stone-400 cursor-not-allowed"
          )}
        >
          {sending ? "Sending…" : places === 0 ? "Campaign full" : "Apply"}
        </button>
        <p className="text-[11px] text-stone-500 font-medium text-center">
          The brand picks who takes part. Applying doesn&apos;t reserve a place.
        </p>
      </div>
    </div>
  );
}
