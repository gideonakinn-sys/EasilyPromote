"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@ep/ui/lib/utils";
import { Skeleton } from "../ui/skeleton";
import { useBrandGuard } from "../../hooks/use-brand-guard";
import { apiRequest, getToken } from "../../lib/api";
import {
  TRANSACTION_LABELS,
  formatNaira,
  type BrandStatsPayload,
  type BrandTransaction,
  type BrandTransactionsPayload,
} from "../../lib/brand";

const FILTERS = ["all", "escrow_deposit", "topup", "release", "refund"] as const;

type FilterValue = (typeof FILTERS)[number];

const STATUS_STYLES: Record<string, string> = {
  escrow_deposit: "bg-[#CBF5E5] text-[#176448]",
  released: "bg-[#CBF5E5] text-[#176448]",
  refunded: "bg-blue-50 text-blue-700",
  refund_pending: "bg-amber-50 text-amber-700",
  refund_failed: "bg-red-50 text-red-600",
  failed: "bg-red-50 text-red-600",
  under_review: "bg-amber-50 text-amber-700",
};

function statusLabel(s: string): string {
  return s.replace(/_/g, " ");
}

export function BillingView() {
  useBrandGuard();
  const router = useRouter();

  const [stats, setStats] = React.useState<BrandStatsPayload | null>(null);
  const [transactions, setTransactions] = React.useState<BrandTransaction[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [filter, setFilter] = React.useState<FilterValue>("all");

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    Promise.all([
      apiRequest<BrandStatsPayload>("/businesses/me/stats", { method: "GET", token }),
      apiRequest<BrandTransactionsPayload>("/businesses/me/transactions", { method: "GET", token }),
    ])
      .then(([s, t]) => {
        setStats(s);
        setTransactions(t.transactions || []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load billing"))
      .finally(() => setLoading(false));
  }, [router]);

  const visible = filter === "all" ? transactions : transactions.filter((t) => t.type === filter);

  const moneyCards = stats
    ? [
        { label: "Deposited", value: formatNaira(stats.money.deposited) },
        { label: "Paid to creators", value: formatNaira(stats.money.released) },
        { label: "Refunded", value: formatNaira(stats.money.refunded) },
        { label: "In escrow", value: formatNaira(stats.money.escrowBalance) },
      ]
    : [];

  const signed = (t: BrandTransaction) =>
    t.type === "release" ? `-${formatNaira(t.amount)}` : `+${formatNaira(t.amount)}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-rethink font-semibold text-lg text-stone-900 tracking-tight">
          Billing & payments
        </h2>
        <p className="mt-1 text-xs font-medium text-stone-500">Money in, money out, and what&apos;s held in escrow.</p>
      </div>

      {loading && !stats ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-stone-100 bg-white p-8 text-center">
          <p className="text-sm font-medium text-stone-900">Billing didn&apos;t load</p>
          <p className="mt-1 text-xs font-medium text-stone-500">{error}</p>
        </div>
      ) : (
        <>
          {moneyCards.length > 0 && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {moneyCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-stone-100 bg-white p-5">
                  <p className="text-xs font-medium text-stone-500">{card.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-stone-900 tracking-tight">{card.value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-4 py-2 text-xs font-medium capitalize",
                  filter === f ? "bg-stone-900 text-white" : "bg-white text-stone-600 border border-stone-200"
                )}
              >
                {f === "all" ? "All" : TRANSACTION_LABELS[f]}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
              <p className="text-sm font-medium text-stone-900">No transactions yet</p>
              <p className="mt-1 text-xs font-medium text-stone-500">Payments and payouts will appear here.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white">
              <ul className="divide-y divide-stone-100">
                {visible.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-900">
                        {TRANSACTION_LABELS[t.type] || t.type.replace(/_/g, " ")}
                        <span className="ml-2 text-[11px] font-medium text-stone-400">
                          {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs font-medium text-stone-500">
                        {t.campaignName || "No campaign"}
                        {t.bucket === "referral" && " · Referral"}
                        {t.views ? ` · ${t.views.toLocaleString()} views` : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                          STATUS_STYLES[t.status] || "bg-stone-100 text-stone-600"
                        )}
                      >
                        {statusLabel(t.status)}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          t.type === "release" ? "text-red-600" : "text-[#176448]"
                        )}
                      >
                        {signed(t)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}