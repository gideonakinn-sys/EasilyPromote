"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Link01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { API_URL } from "../lib/api";
import { USAGE_RIGHTS_TEXT } from "./brand-wizard/wizard-state";

// M8 batch 7: clicks campaigns (SPEC D29) and custom usage-rights terms (SPEC D30) on the brand's campaign page.

export type UsageRightsDuration = "perpetual" | "3_months" | "6_months" | "12_months" | "24_months";

export interface UsageRightsTerms {
  duration?: UsageRightsDuration;
  exclusivity?: "none" | "category";
  exclusivityPeriod?: string | null;
  paidAdsAllowed?: boolean;
  territories?: string[];
  additionalTerms?: string | null;
}

export interface CampaignUsageRights {
  type: "standard" | "custom";
  version?: number;
  terms?: UsageRightsTerms;
}

// Stored on a placement or application when the creator accepted custom terms.
export interface TermsAccepted {
  version: number | null;
  acceptedAt: string;
}

export interface WithTermsAccepted {
  usageRightsAccepted?: TermsAccepted | null;
}

export const isClicksObjective = (objective: string | null | undefined) => objective === "clicks";

// Tracked links live on the API host: /r/<campaignId>/<referral code> (codes are only unique per brand).
export function trackedLinkFor(campaignId: string, code: string): string {
  const origin = API_URL.replace(/\/api\/?$/, "");
  return `${origin}/r/${campaignId}/${encodeURIComponent(code)}`;
}

export function formatTermsDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

const DURATION_LABELS: Record<UsageRightsDuration, string> = {
  perpetual: "No end date",
  "3_months": "3 months",
  "6_months": "6 months",
  "12_months": "12 months",
  "24_months": "24 months",
};

export function usageRightsRows(terms: UsageRightsTerms | undefined): [string, string][] {
  const t = terms || {};
  const territories = t.territories && t.territories.length ? t.territories.join(", ") : "Worldwide";
  return [
    ["Duration", DURATION_LABELS[t.duration || "perpetual"] || String(t.duration)],
    [
      "Exclusivity",
      t.exclusivity === "category" ? `Category exclusive${t.exclusivityPeriod ? ` for ${t.exclusivityPeriod}` : ""}` : "Not exclusive",
    ],
    ["Paid ads", t.paidAdsAllowed === false ? "Not allowed" : "Allowed"],
    ["Territories", territories],
  ];
}

export function UsageRightsCard({ usageRights }: { usageRights: CampaignUsageRights | null | undefined }) {
  const custom = usageRights?.type === "custom";
  return (
    <section className="space-y-3 font-rethink">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-xs font-medium text-stone-500">Usage rights</h5>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-200 text-stone-700">
          {custom ? `Custom terms${usageRights?.version ? ` · v${usageRights.version}` : ""}` : "Standard licence"}
        </span>
      </div>
      <div className="bg-white border border-stone-200 rounded-[18px] p-4 space-y-3">
        {custom ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              {usageRightsRows(usageRights?.terms).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[10px] font-medium text-stone-500">{label}</dt>
                  <dd className="text-sm font-medium text-stone-900 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {usageRights?.terms?.additionalTerms && (
              <div className="border-t border-stone-100 pt-3">
                <span className="text-[10px] font-medium text-stone-500 block">Additional terms</span>
                <p className="text-xs font-medium text-stone-700 leading-relaxed whitespace-pre-line break-words">
                  {usageRights.terms.additionalTerms}
                </p>
              </div>
            )}
            <p className="text-[11px] text-stone-500 font-medium leading-relaxed">
              Creators accept these terms when they join or apply. They can&apos;t change now that the campaign is paid for.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-stone-500 font-medium leading-relaxed">{USAGE_RIGHTS_TEXT}</p>
        )}
      </div>
    </section>
  );
}

export function TermsAcceptedNote({ accepted, className }: { accepted: TermsAccepted | null | undefined; className?: string }) {
  if (!accepted || !accepted.acceptedAt) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium text-[#176448] font-rethink ${className || ""}`}>
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} className="shrink-0" />
      Terms accepted {formatTermsDate(accepted.acceptedAt)}
    </span>
  );
}

export function CopyLinkButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, failed]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setFailed(true);
        }
      }}
      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-stone-200 rounded-full text-[11px] font-semibold text-stone-900 font-rethink"
    >
      <HugeiconsIcon icon={Copy01Icon} size={12} />
      {copied ? "Copied" : failed ? "Couldn't copy" : label}
    </button>
  );
}

export function DestinationLinkCard({ url }: { url: string | null | undefined }) {
  return (
    <section className="space-y-3 font-rethink">
      <h5 className="text-xs font-medium text-stone-500">Destination link</h5>
      <div className="bg-white border border-stone-200 rounded-[18px] p-4 space-y-2">
        {url ? (
          <div className="flex items-center gap-3">
            <HugeiconsIcon icon={Link01Icon} size={16} className="text-stone-500 shrink-0" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex-1 min-w-0 text-sm font-medium text-stone-900 underline underline-offset-2 break-all"
            >
              {url}
            </a>
            <CopyLinkButton value={url} />
          </div>
        ) : (
          <p className="text-sm font-medium text-stone-500">No destination link set yet</p>
        )}
        <p className="text-[11px] text-stone-500 font-medium leading-relaxed">
          Each creator shares their own tracked link. It only ever sends people here, and each person counts once a day per link.
        </p>
      </div>
    </section>
  );
}
