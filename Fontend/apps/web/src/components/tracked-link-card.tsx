"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, CheckIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { formatNaira } from "../lib/referral";
import { trackedLinkFor } from "../lib/creator-campaign-terms";
import type { CampaignReferral } from "./types";

// M8 batch 7 (SPEC D29): a clicks campaign's tracked link, which pays per valid click.
interface TrackedLinkCardProps {
  campaignId: string;
  referralCode: string | null;
  destinationDomain?: string | null;
  // The creator's referral stats for this campaign, when the dashboard has them.
  referral?: CampaignReferral | null;
}

export function TrackedLinkCard({ campaignId, referralCode, destinationDomain, referral }: TrackedLinkCardProps) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const link = referralCode ? trackedLinkFor(campaignId, referralCode) : null;
  const rate = referral?.rewardPerConversion || 0;
  const earnings = referral?.earnings;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3 font-rethink">
      <span className="text-[10px] font-medium text-stone-500 tracking-[-0.01em] block">Your tracked link</span>

      {link ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 font-mono text-xs font-medium text-stone-900 break-all select-all">{link}</code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy tracked link"
            className={cn(
              "h-9 px-3 flex-shrink-0 flex items-center gap-1.5 rounded-full text-xs font-medium",
              copied === "copied" ? "bg-[#CBF5E5] text-[#176448]" : "bg-stone-100 text-stone-700"
            )}
          >
            <HugeiconsIcon icon={copied === "copied" ? CheckIcon : Copy01Icon} size={14} />
            {copied === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="text-sm font-medium text-stone-400 tracking-[-0.01em]">Your link is being set up. It will appear here.</p>
      )}
      {copied === "failed" && (
        <p className="text-[11px] font-medium text-red-700">Couldn&apos;t copy. Select the link and copy it manually.</p>
      )}

      <p className="text-xs font-medium text-stone-500 leading-relaxed tracking-[-0.01em]">
        Share this link. You&apos;re paid for each valid click, once per person per day.
      </p>
      {destinationDomain && (
        <p className="text-xs font-medium text-stone-500 tracking-[-0.01em]">
          Takes people to <span className="text-stone-900">{destinationDomain}</span>
        </p>
      )}

      {referral && rate === 0 && (
        <p className="text-xs font-medium text-stone-500 leading-relaxed tracking-[-0.01em]">
          Easily Promote is setting your reward per click. Valid clicks already count and are paid once it&apos;s set.
        </p>
      )}
      {rate > 0 && (
        <p className="text-xs font-medium text-stone-900 tracking-[-0.01em]">
          You earn {formatNaira(rate)} per valid click.
          {referral?.paying === false && (
            <span className="block text-amber-700 mt-0.5">
              The brand&apos;s budget has run out, so new clicks aren&apos;t paid until they add more.
            </span>
          )}
        </p>
      )}

      {referral && link && (
        <>
          <div className="border-t border-stone-100" />
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-stone-500 tracking-[-0.01em]">Valid clicks</span>
            <span className="text-sm font-medium text-stone-900 tabular-nums">{referral.conversions.toLocaleString()}</span>
          </div>
          {earnings && earnings.earned > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Earned", earnings.earned],
                ["On hold", earnings.pending],
                ["Withdrawable", earnings.availableToWithdraw],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-stone-50 rounded-xl px-3 py-2">
                  <span className="text-[10px] font-medium text-stone-500 block">{label}</span>
                  <span className="text-sm font-medium text-stone-900 tabular-nums">{formatNaira(value as number)}</span>
                </div>
              ))}
            </div>
          )}
          {earnings && earnings.pending > 0 && (
            <p className="text-[11px] font-medium text-stone-500 leading-relaxed">
              Click earnings are held for 7 days, then you can withdraw them from your wallet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
