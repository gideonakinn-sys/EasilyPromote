"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@ep/ui/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { StatCard } from "./brand-stats-cards";
import { DeliveryChart } from "./delivery-chart";
import { CampaignBars } from "./campaign-bars";
import { apiRequest, getToken } from "../../lib/api";
import { useBrandGuard } from "../../hooks/use-brand-guard";
import { formatCompactViews } from "../../lib/brand";
import type { BrandStatsPayload } from "../../lib/brand";

const STATUS_BLOCKS = [
  { key: "activeCampaigns", label: "Active", color: "bg-[#176448]" },
  { key: "drafts", label: "Drafts", color: "bg-neutral-300" },
  { key: "completed", label: "Completed", color: "bg-emerald-400" },
  { key: "cancelled", label: "Cancelled", color: "bg-red-400" },
] as const;

export function AnalyticsView() {
  useBrandGuard();
  const router = useRouter();

  const [stats, setStats] = React.useState<BrandStatsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiRequest<BrandStatsPayload>("/businesses/me/stats", { method: "GET", token })
      .then(setStats)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load analytics"))
      .finally(() => setLoading(false));
  }, [router]);

  const total = stats ? Math.max(stats.summary.totalCampaigns, 1) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-rethink font-semibold text-lg text-neutral-900 tracking-tight">
          Analytics
        </h2>
        <p className="mt-1 text-xs font-medium text-neutral-500">How your campaigns are performing.</p>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-neutral-100 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-900">Analytics didn&apos;t load</p>
          <p className="mt-1 text-xs font-medium text-neutral-500">{error}</p>
        </div>
      ) : (
        stats && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label="Active campaigns"
                value={String(stats.summary.activeCampaigns)}
                hint={`${stats.summary.completed} completed`}
              />
              <StatCard
                label="Views delivered"
                value={formatCompactViews(stats.summary.viewsDelivered)}
                hint={`${stats.summary.progressPercent}% of ${formatCompactViews(stats.summary.viewsTarget)} pledged`}
              />
              <StatCard
                label="Campaigns completed"
                value={String(stats.summary.completed)}
                hint={`${stats.summary.drafts} drafts`}
              />
              <StatCard
                label="Avg cost per view"
                value={`₦${stats.money.avgCostPerView.toFixed(2)}`}
                accent
              />
            </div>

            {/* Status distribution */}
            <div className="rounded-2xl border border-neutral-100 bg-white p-5">
              <h3 className="text-sm font-semibold text-neutral-900">Status breakdown</h3>
              <div className="mt-4 space-y-3">
                {STATUS_BLOCKS.map((block) => {
                  const count = stats.summary[block.key];
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={block.key} className="flex items-center gap-3">
                      <span className="w-24 text-xs font-medium text-neutral-500">{block.label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <div className={cn("h-full rounded-full", block.color)} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs font-semibold text-neutral-900">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <DeliveryChart series={stats.deliverySeries} />
              <CampaignBars campaigns={stats.topCampaigns} />
            </div>

            {stats.conversions > 0 && (
              <div className="rounded-2xl border border-neutral-100 bg-white p-5">
                <h3 className="text-sm font-semibold text-neutral-900">Referral conversions</h3>
                <p className="mt-1 text-xs font-medium text-neutral-500">
                  {stats.conversions} conversion{stats.conversions === 1 ? "" : "s"} counted across your campaigns.
                </p>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}