"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { Card, CardContent } from "@ep/ui/components/card";
import { formatInteger } from "../../lib/brand";
import type { BrandMonthlyStats } from "../../lib/brand";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

export function StatCard({ label, value, hint, accent }: StatCardProps) {
  return (
    <Card data-reveal className="rounded-2xl border-neutral-100 bg-white shadow-none">
      <CardContent className="p-5">
        <p className="text-xs font-medium text-neutral-500">{label}</p>
        <p className={cn("mt-2 text-lg font-semibold tabular-nums text-neutral-900 tracking-tight", accent && "text-[#B45309]")}>
          {value}
        </p>
        {hint && <p className="mt-1 text-xs font-medium text-neutral-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

interface BrandStatsCardsProps {
  stats: BrandMonthlyStats;
}

export function BrandStatsCards({ stats }: BrandStatsCardsProps) {
  const { summary } = stats;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Active campaigns" value={formatInteger(summary.activeCampaigns)} />
      <StatCard label="Views delivered" value={formatInteger(summary.viewsDelivered)} />
      <StatCard label="Campaigns completed" value={formatInteger(summary.campaignsCompleted)} />
    </div>
  );
}