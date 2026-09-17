"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { conversionNounFor, formatNaira } from "../lib/referral";
import type { CampaignReferral } from "./types";

const STATUS_COPY: Record<CampaignReferral["status"], { label: string; className: string; hint: string }> = {
  active: {
    label: "Active",
    className: "bg-[#CBF5E5] text-[#176448]",
    hint: "Ask your audience to enter this code when they sign up.",
  },
  awaiting_business: {
    label: "Activating",
    className: "bg-amber-50 text-amber-800",
    hint: "The brand is adding this code to their app. Start sharing it once it shows Active.",
  },
  awaiting_code: {
    label: "Coming soon",
    className: "bg-stone-100 text-stone-600",
    hint: "The brand will assign your code shortly. It will appear here.",
  },
  disabled: {
    label: "Turned off",
    className: "bg-red-50 text-red-700",
    hint: "The brand has turned this code off. Stop sharing it.",
  },
};

export function ReferralCodeCard({ referral }: { referral: CampaignReferral }) {
  const { toast } = useToast();
  const copy = STATUS_COPY[referral.status] || STATUS_COPY.awaiting_code;
  const rate = referral.rewardPerConversion || 0;
  const earnings = referral.earnings;

  const handleCopy = async () => {
    if (!referral.code) return;
    try {
      await navigator.clipboard.writeText(referral.code);
      toast("Code copied", "success");
    } catch {
      toast("Couldn't copy. Select the code and copy it manually.", "error");
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium text-stone-500 tracking-[-0.01em]">Your referral code</span>
        <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium font-rethink", copy.className)}>
          {copy.label}
        </span>
      </div>

      {referral.code ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 font-mono text-lg font-medium text-stone-900 tracking-wide break-all">
            {referral.code}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy referral code"
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center bg-stone-100 text-stone-700 rounded-full"
          >
            <HugeiconsIcon icon={Copy01Icon} size={16} />
          </button>
        </div>
      ) : (
        <p className="font-rethink text-sm font-medium text-stone-400 tracking-[-0.01em]">No code yet</p>
      )}

      <p className="font-rethink text-xs font-medium text-stone-500 leading-relaxed tracking-[-0.01em]">{copy.hint}</p>

      {rate === 0 && referral.code && (
        <p className="font-rethink text-xs font-medium text-stone-500 leading-relaxed tracking-[-0.01em]">
          Easily Promote is setting your reward per {conversionNounFor(referral.eventTypes || [referral.eventType], 1)}. Ones through your code already
          count and are paid once it&apos;s set.
        </p>
      )}

      {rate > 0 && (
        <p className="font-rethink text-xs font-medium text-stone-900 tracking-[-0.01em]">
          You earn {formatNaira(rate)} per {conversionNounFor(referral.eventTypes || [referral.eventType], 1)} through your code.
          {referral.paying === false && (
            <span className="block text-amber-700 mt-0.5">
              The brand&apos;s referral budget has run out, so new {conversionNounFor(referral.eventTypes || [referral.eventType], 2)} aren&apos;t paid until they add more.
            </span>
          )}
        </p>
      )}

      {referral.code && (
        <>
          <div className="border-t border-stone-100" />
          <div className="flex items-baseline justify-between font-rethink">
            <span className="text-xs font-medium text-stone-500 tracking-[-0.01em]">Tracked through your code</span>
            <span className="text-sm font-medium text-stone-900 tabular-nums">
              {referral.conversions.toLocaleString()} {conversionNounFor(referral.eventTypes || [referral.eventType], referral.conversions)}
            </span>
          </div>
          {earnings && earnings.earned > 0 && (
            <div className="grid grid-cols-3 gap-2 font-rethink">
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
            <p className="font-rethink text-[11px] font-medium text-stone-500 leading-relaxed">
              Referral earnings are held for 7 days after each conversion, then you can withdraw them from your wallet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
