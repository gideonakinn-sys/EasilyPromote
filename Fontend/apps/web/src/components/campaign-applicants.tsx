"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import type { ApplicationCounts, ApplicationRow } from "./types";
import { ApplicationStatusBadge } from "./application-status-badge";
import { ApplicantSnapshotPanel, compactNumber, locationLabel } from "./applicant-snapshot-panel";
import { BADGE_LABELS, RatingSummary } from "./creator-rating-summary";
import { applicationsApi } from "../lib/api";
import { platformLabel } from "../lib/campaign-pay";
import { useApplicationUpdates } from "../lib/socket";

// Campaign engine: applications (ticket 06)
// Applicants on an Application Required campaign: count, status filters, sort by match,
// and the snapshot panel to approve or reject.

const FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

type Filter = (typeof FILTERS)[number]["value"];
type Sort = "match" | "newest";

const EMPTY_COUNTS: ApplicationCounts = { all: 0, pending: 0, approved: 0, rejected: 0, withdrawn: 0, expired: 0 };

interface CampaignApplicantsProps {
  campaignId: string;
}

export function CampaignApplicants({ campaignId }: CampaignApplicantsProps) {
  const [filter, setFilter] = React.useState<Filter>("pending");
  const [sort, setSort] = React.useState<Sort>("match");
  const [counts, setCounts] = React.useState<ApplicationCounts>(EMPTY_COUNTS);
  const [rows, setRows] = React.useState<ApplicationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Only the latest request may update the list when filters change quickly.
  const requestRef = React.useRef(0);
  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const data = await applicationsApi.list(campaignId, { status: filter === "all" ? undefined : filter, sort });
      if (request !== requestRef.current) return;
      setCounts(data.counts);
      setRows(data.applications);
    } catch (err: unknown) {
      if (request !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load applicants");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [campaignId, filter, sort]);

  React.useEffect(() => {
    load();
  }, [load]);

  useApplicationUpdates(({ campaignId: updated }) => {
    if (String(updated) === campaignId) load();
  });

  return (
    <div className="border border-stone-200 rounded-2xl p-4 space-y-4 font-rethink">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-stone-900">Applicants</h3>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-medium",
              counts.pending > 0 ? "bg-[#FEB604] text-stone-950" : "bg-stone-200 text-stone-700"
            )}
            aria-label={`${counts.pending} pending applicants`}
          >
            {counts.pending > 0 ? `${counts.pending} Pending` : counts.all}
          </span>
        </div>
        <div className="flex rounded-full bg-stone-100 p-0.5">
          {(["match", "newest"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium",
                sort === value ? "bg-white text-stone-900" : "text-stone-500"
              )}
            >
              {value === "match" ? "Best Match" : "Recently Applied"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium",
              filter === value ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
            )}
          >
            {label} {counts[value]}
          </button>
        ))}
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      {loading && rows.length === 0 && <p className="text-xs font-medium text-stone-400">Loading applicants…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-xs font-medium text-stone-500">
          {filter === "all" ? "No applications yet. Eligible creators can apply from the marketplace." : `No ${filter} applications.`}
        </p>
      )}

      <div className={cn("divide-y divide-stone-100 transition-opacity", loading && "opacity-50")} aria-busy={loading}>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setOpenId(row.id)}
            className="w-full flex items-center gap-3 py-3 text-left"
          >
            <div className="w-10 h-10 rounded-full bg-stone-200 overflow-hidden flex items-center justify-center text-xs font-medium text-stone-600 shrink-0">
              {row.creator.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.creator.photo} alt="" className="w-full h-full object-cover" />
              ) : (
                row.creator.name.charAt(0)
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-900 truncate flex items-center gap-1">
                {row.creator.name}
                {row.creator.verified && <HugeiconsIcon icon={CheckmarkBadge01Icon} size={12} className="text-[#176448] shrink-0" />}
              </p>
              <p className="text-[11px] font-medium text-stone-500 truncate">
                {[
                  locationLabel(row.creator.location),
                  row.creator.topPlatform
                    ? `${platformLabel(row.creator.topPlatform.platform)}${row.creator.topPlatform.followers !== null ? ` ${compactNumber(row.creator.topPlatform.followers)}` : ""}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {((row.creator.rating?.count ?? 0) > 0 || (row.creator.badges || []).length > 0) && (
                <p className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <RatingSummary rating={row.creator.rating} className="text-[11px]" />
                  {(row.creator.badges || []).map((b) => (
                    <span key={b} className="px-1.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[9px] font-medium">
                      {BADGE_LABELS[b] || b}
                    </span>
                  ))}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-xs font-medium text-stone-900">{row.matchScore}% match</span>
              <ApplicationStatusBadge status={row.status} audience="brand" />
            </div>
          </button>
        ))}
      </div>

      <ApplicantSnapshotPanel campaignId={campaignId} applicationId={openId} onClose={() => setOpenId(null)} onDecided={load} />
    </div>
  );
}
