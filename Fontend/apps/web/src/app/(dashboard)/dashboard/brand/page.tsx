"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@ep/ui/lib/utils";
import { Skeleton } from "../../../../components/ui/skeleton";
import { DraftAlertBanner } from "../../../../components/draft-alert-banner";
import { BrandStatsCards } from "../../../../components/brand/brand-stats-cards";
import { DeliveryChart } from "../../../../components/brand/delivery-chart";
import { TopCampaigns } from "../../../../components/brand/top-campaigns";
import { MonthPicker } from "../../../../components/brand/month-picker";
import { apiRequest, getUser, isAuthenticated, getToken } from "../../../../lib/api";
import { useSocket } from "../../../../lib/socket";
import { useStaggerReveal } from "../../../../hooks/use-stagger-reveal";
import { confirmPendingPayments, currentMonth } from "../../../../lib/brand";
import type { BrandMonthlyStats } from "../../../../lib/brand";

function OverviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [month, setMonth] = useState<string>(currentMonth());
  const [stats, setStats] = useState<BrandMonthlyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [showAlert, setShowAlert] = useState(true);
  const [revealKey, setRevealKey] = useState(0);

  const revealRef = useStaggerReveal<HTMLDivElement>(revealKey);

  const doFetch = useCallback(async (m: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
    try {
      const data = await apiRequest<BrandMonthlyStats>(`/businesses/me/stats?month=${m}`, {
        token: getToken() || undefined,
      });
      setStats(data);
      setFetchError("");
      setRevealKey((k) => k + 1);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : "Could not load stats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auth / email verification / payment redirect (mount + query changes only).
  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }

    const reference = searchParams.get("reference") || searchParams.get("trxref");
    if (reference || searchParams.get("payment") === "success") {
      router.replace("/dashboard/brand");
      return;
    }

    apiRequest<{ emailVerified: boolean }>("/auth/me", { token: getToken() || undefined })
      .then((me) => {
        if (!me.emailVerified) {
          router.push("/login");
          return;
        }
        const freshUser = getUser();
        if (freshUser) {
          freshUser.emailVerified = me.emailVerified;
          localStorage.setItem("user", JSON.stringify(freshUser));
        }
      })
      .catch(() => router.push("/login"));
  }, [searchParams, router]);

  // Data for the selected month.
  useEffect(() => {
    if (!isAuthenticated()) return;
    doFetch(month);
  }, [month, doFetch]);

  // Confirm payments for campaigns still waiting after Paystack checkout, then refresh the stats.
  useEffect(() => {
    if (!isAuthenticated()) return;
    if (searchParams.get("reference") || searchParams.get("trxref") || searchParams.get("payment") === "success") return;
    confirmPendingPayments()
      .then((wentLive) => {
        if (wentLive) doFetch(month, { silent: true });
      })
      .catch(() => {});
    // Once per visit (and after the payment redirect clears its query).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Refresh silently whenever a campaign changes status or a payment lands.
  useSocket(() => doFetch(month, { silent: true }), () => doFetch(month, { silent: true }));

  const handleMonthChange = (m: string) => {
    setMonth(m);
  };

  const handleCreateCampaign = () => {
    localStorage.removeItem("ep-draft-autosave");
    router.push("/dashboard/brand/create-campaign");
  };

  const isEmpty = stats ? stats.summary.totalCampaigns === 0 : false;

  return (
    <div ref={revealRef} className="space-y-6">
      {showAlert && stats && stats.summary.drafts > 0 && (
        <div className="fixed bottom-6 right-4 md:right-6 z-50">
          <DraftAlertBanner draftCount={stats.summary.drafts} onClose={() => setShowAlert(false)} />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h1 className="font-rethink font-semibold text-lg text-neutral-900 tracking-tight">
          Overview
        </h1>
        <MonthPicker
          months={stats?.availableMonths ?? []}
          value={month}
          onChange={handleMonthChange}
          refreshing={refreshing}
        />
      </div>

      {loading && !stats ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : fetchError ? (
        <div className="rounded-2xl border border-neutral-100 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-900">Couldn&apos;t load your dashboard</p>
          <p className="mt-1 text-xs font-medium text-neutral-500">Please try again in a moment.</p>
          <button
            onClick={() => {
              setLoading(true);
              doFetch(month);
            }}
            className="mt-4 rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-medium text-white"
          >
            Try again
          </button>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-neutral-900">No campaigns yet</p>
          <p className="mt-1 max-w-sm text-xs font-medium text-neutral-500">
            Create your first campaign and your views and performance will show up here.
          </p>
          <button
            onClick={handleCreateCampaign}
            className="mt-5 rounded-full bg-[#FEB604] px-6 py-2.5 text-sm font-semibold text-[#171717] border border-neutral-100"
          >
            Create campaign
          </button>
        </div>
      ) : (
        stats && (
          <div
            aria-live="polite"
            className={cn("space-y-6 transition-opacity duration-200", refreshing && "opacity-60")}
          >
            <BrandStatsCards stats={stats} />
            <DeliveryChart key={month} series={stats.dailySeries} />
            <TopCampaigns campaigns={stats.topCampaigns} />
          </div>
        )
      )}
    </div>
  );
}

export default function BrandOverview() {
  return (
    <Suspense
      fallback={
        <div className="py-20 text-center">
          <Skeleton className="h-6 w-40" />
        </div>
      }
    >
      <OverviewContent />
    </Suspense>
  );
}