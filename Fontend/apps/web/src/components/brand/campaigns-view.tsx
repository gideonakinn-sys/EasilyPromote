"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { StatusChip } from "./status-chip";
import { apiRequest, getToken } from "../../lib/api";
import { useBrandGuard } from "../../hooks/use-brand-guard";
import type { BrandCampaign } from "../active-dashboard";

export interface CampaignRow extends BrandCampaign {
  costPerView?: number;
  startDate?: string | null;
  endDate?: string | null;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "under_review", label: "Under review" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const STATUS_SORT: Record<string, number> = {
  draft: 0,
  pending_payment: 1,
  under_review: 2,
  live: 3,
  paused: 4,
  completed: 5,
  cancelled: 6,
};

export function CampaignsView() {
  useBrandGuard();
  const router = useRouter();

  const [campaigns, setCampaigns] = React.useState<CampaignRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["value"]>("all");

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiRequest<{ campaigns: CampaignRow[]; draftCount: number }>("/campaigns", {
      method: "GET",
      token,
    })
      .then((data) => setCampaigns(data.campaigns || []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load campaigns"))
      .finally(() => setLoading(false));
  }, [router]);

  const normalized = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "");

  const visible = campaigns
    .filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!query.trim()) return true;
      const q = normalized(query);
      return (
        normalized(c.name).includes(q) ||
        normalized(c.category || "").includes(q)
      );
    })
    .sort((a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9));

  const openCampaign = (c: CampaignRow) => {
    if (c.status === "draft" || c.status === "pending_payment") {
      router.push(`/dashboard/brand/create-campaign?id=${c.id}`);
    } else {
      router.push(`/dashboard/brand/campaign/${c.id}`);
    }
  };

  const counts = (status: string) => campaigns.filter((c) => c.status === status).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-rethink font-semibold text-lg text-stone-900 tracking-tight">
          Campaigns
        </h2>
        <p className="mt-1 text-xs font-medium text-stone-500">
          {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} total
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter campaigns by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-medium",
                filter === f.value
                  ? "bg-stone-900 text-white"
                  : "bg-white text-stone-600 border border-stone-200"
              )}
            >
              {f.label}
              {f.value !== "all" && campaigns.length > 0 && (
                <span className={cn("ml-1.5", filter === f.value ? "text-stone-300" : "text-stone-400")}>
                  {counts(f.value)}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative md:w-64">
          <HugeiconsIcon icon={Search01Icon} size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaigns"
            aria-label="Search campaigns"
            className="w-full rounded-full border border-stone-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-stone-900 placeholder-stone-400 outline-none focus:border-stone-400"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-stone-100 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-900">Campaigns didn&apos;t load</p>
          <p className="mt-1 text-xs font-medium text-stone-500">{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
          <p className="text-sm font-medium text-stone-900">
            {campaigns.length === 0 ? "No campaigns yet" : "No campaigns match your search"}
          </p>
          <p className="mt-1 text-xs font-medium text-stone-500">
            {campaigns.length === 0 ? "Create your first campaign to get started." : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-stone-100 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                <th className="px-5 py-3 font-semibold">Campaign</th>
                <th className="hidden px-5 py-3 font-semibold md:table-cell">Status</th>
                <th className="hidden px-5 py-3 font-semibold lg:table-cell">Views</th>
                <th className="hidden px-5 py-3 font-semibold sm:table-cell">Progress</th>
                <th className="px-5 py-3 text-right font-semibold">Budget</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {visible.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openCampaign(c)}
                  className="cursor-pointer transition-colors hover:bg-stone-50"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-stone-100">
                        {c.coverImageUrl ? (
                          <Image
                            src={c.coverImageUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-full w-full object-cover"
                            unoptimized
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-stone-900">{c.name}</p>
                        <p className="truncate text-xs font-medium text-stone-500">
                          {c.category || "General"}
                          {c.costPerView ? ` · ₦${c.costPerView.toFixed(3)} per view` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-5 py-4 md:table-cell">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="hidden px-5 py-4 lg:table-cell">
                    <p className="text-sm font-medium text-stone-900">
                      {c.viewsDelivered.toLocaleString()}
                      <span className="text-stone-400"> / {c.targetViews.toLocaleString()}</span>
                    </p>
                    <p className="text-[11px] font-medium text-stone-400">{c.progressPercent}% delivered</p>
                  </td>
                  <td className="hidden px-5 py-4 sm:table-cell">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-[#1C1917]"
                        style={{ width: `${c.progressPercent}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right text-sm font-semibold text-stone-900">
                    ₦{c.budget.toLocaleString()}
                    <p className="text-[11px] font-medium text-stone-400">{c.status === "draft" ? "Draft" : "Funded"}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}