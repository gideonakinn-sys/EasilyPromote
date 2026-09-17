"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@ep/ui/components/card";
import { StatusChip } from "./status-chip";
import { formatCompactViews } from "../../lib/brand";
import type { BrandStatsCampaign } from "../../lib/brand";

interface TopCampaignsProps {
  campaigns: BrandStatsCampaign[];
}

export function TopCampaigns({ campaigns }: TopCampaignsProps) {
  const router = useRouter();

  const openCampaign = (c: BrandStatsCampaign) => {
    if (c.status === "draft" || c.status === "pending_payment") {
      router.push(`/dashboard/brand/create-campaign?id=${c.id}`);
    } else {
      router.push(`/dashboard/brand/campaign/${c.id}`);
    }
  };

  return (
    <Card data-reveal className="rounded-2xl border-stone-100 bg-white shadow-none">
      <CardHeader className="flex flex-row items-center justify-between p-5 pb-3">
        <CardTitle className="text-sm font-semibold text-stone-900 tracking-tight">
          Top performing campaigns
        </CardTitle>
        <Link
          href="/dashboard/brand/campaigns"
          className="text-xs font-semibold text-stone-900 underline underline-offset-2"
        >
          View all
        </Link>
      </CardHeader>
      <CardContent className="p-2">
        {campaigns.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs font-medium text-stone-500">
            No views yet this month.
          </p>
        ) : (
          <ul className="flex flex-col">
            {campaigns.map((c, index) => (
              <li key={c.id}>
                <button
                  onClick={() => openCampaign(c)}
                  className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left"
                >
                  <span aria-hidden="true" className="w-5 shrink-0 text-xs font-semibold tabular-nums text-stone-400">
                    {index + 1}
                  </span>
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-stone-100">
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-stone-900">{c.name}</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-stone-500">
                      {c.category || "General"}
                    </p>
                  </div>
                  <StatusChip status={c.status} className="hidden sm:inline-flex" />
                  <div className="w-28 shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-stone-900">
                      {formatCompactViews(c.views)}
                    </p>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full rounded-full bg-[#1C1917]"
                        style={{ width: `${c.progressPercent}%` }}
                      />
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}