"use client";

import * as React from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { API_URL, apiRequest, getToken } from "../lib/api";
import { Skeleton } from "./ui/skeleton";

// The brand payment statement (ticket 11): where every naira a brand paid in went, per campaign and
// overall. The figures come from the API's campaign reconciliation, so they always add up to what was
// paid in.
export interface StatementLine {
  campaignId: string;
  name: string;
  status: string;
  campaignModel: string;
  payShape: string | null;
  paidIn: number;
  deliverables: number;
  views: number;
  referrals: number;
  bonus: number;
  performance: number;
  owedToCreators: number;
  platformFee: number;
  refundsIssued: number;
  refundsPending: number;
  remaining: number;
}

export interface Statement {
  campaigns: StatementLine[];
  totals: StatementLine & { campaigns: number };
}

const naira = (value: number) => `₦${value.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  under_review: "Under Review",
  pending_payment: "Pending Payment",
};

export function fetchStatement(campaignId?: string) {
  const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
  return apiRequest<Statement>(`/payouts/statement${query}`, { token: getToken() || undefined });
}

// apiRequest parses JSON, so the CSV is fetched directly and saved.
export async function downloadStatementCsv(campaignId?: string) {
  const token = getToken();
  const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
  const res = await fetch(`${API_URL}/payouts/statement.csv${query}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({ error: "Download failed" }))) as { error?: string };
    throw new Error(error.error || "Download failed");
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = match ? match[1] : "payment-statement.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The breakdown rows for one line: where the money went, adding up to paid in.
function breakdown(line: StatementLine) {
  const rows: Array<{ label: string; value: number; hint?: string }> = [];
  if (line.deliverables > 0 || line.campaignModel === "content") {
    rows.push({ label: line.payShape === "hybrid" ? "Base Pay For Deliverables" : "Deliverables Paid", value: line.deliverables });
  }
  if (line.views > 0 || line.campaignModel !== "content") rows.push({ label: "Views Paid", value: line.views });
  if (line.referrals > 0) rows.push({ label: "Referrals Paid", value: line.referrals });
  if (line.bonus > 0 || line.payShape === "hybrid") rows.push({ label: "Bonus Paid", value: line.bonus });
  rows.push({ label: "Platform Fee", value: line.platformFee });
  rows.push({ label: "Refunds Issued", value: line.refundsIssued });
  if (line.refundsPending > 0) rows.push({ label: "Refunds Pending", value: line.refundsPending, hint: "Sent, on its way to your payment method" });
  rows.push({ label: "Remaining", value: line.remaining, hint: "Still in the campaign for creators to earn, or to be refunded" });
  return rows;
}

function DownloadButton({ campaignId, className }: { campaignId?: string; className?: string }) {
  const [downloading, setDownloading] = React.useState(false);
  const [error, setError] = React.useState("");
  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={async () => {
          setDownloading(true);
          setError("");
          try {
            await downloadStatementCsv(campaignId);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed");
          } finally {
            setDownloading(false);
          }
        }}
        disabled={downloading}
        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-neutral-200 rounded-full font-rethink font-medium text-sm text-neutral-900 disabled:opacity-50"
      >
        <HugeiconsIcon icon={Download01Icon} size={16} className="text-neutral-500" />
        {downloading ? "Downloading…" : "Download CSV"}
      </button>
      {error && <span className="font-rethink text-[11px] font-medium text-red-600">{error}</span>}
    </div>
  );
}

// One campaign's statement, for its Payouts tab.
export function CampaignStatementCard({ campaignId }: { campaignId: string }) {
  const [line, setLine] = React.useState<StatementLine | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    fetchStatement(campaignId)
      .then((data) => {
        if (!cancelled) setLine(data.campaigns[0] || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the statement");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (loading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (error) return <p className="font-rethink text-xs text-red-600 font-medium">{error}</p>;
  if (!line) return null;

  return (
    <section className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4 font-rethink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-base text-neutral-900">Payment Statement</h3>
          <p className="text-xs text-neutral-500 font-medium">Where the {naira(line.paidIn)} you paid in went.</p>
        </div>
        <DownloadButton campaignId={campaignId} />
      </div>
      <dl className="space-y-2 text-sm">
        {breakdown(line).map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-neutral-500 font-medium">
              {row.label}
              {row.hint && <span className="block text-[11px] text-neutral-400">{row.hint}</span>}
            </dt>
            <dd className="text-neutral-900 font-medium tabular-nums">{naira(row.value)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-neutral-200 pt-2">
          <dt className="text-neutral-900 font-medium">Paid In</dt>
          <dd className="text-neutral-900 font-medium tabular-nums">{naira(line.paidIn)}</dd>
        </div>
      </dl>
      {line.owedToCreators > 0 && (
        <p className="text-[11px] text-neutral-500 font-medium">
          {naira(line.owedToCreators)} of what&apos;s paid to creators is earned and waiting for delivery, a hold or their weekly payout.
        </p>
      )}
    </section>
  );
}

// Every campaign's statement with the totals, for the statement page.
export function PaymentStatementView() {
  const [statement, setStatement] = React.useState<Statement | null>(null);
  const [error, setError] = React.useState("");

  const load = React.useCallback(() => {
    setError("");
    fetchStatement()
      .then(setStatement)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your statement"));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const totals = statement?.totals;
  const cards = totals
    ? [
        { label: "Paid In", value: totals.paidIn },
        { label: "Deliverables Paid", value: totals.deliverables },
        { label: "Performance Paid", value: totals.performance, detail: `Views ${naira(totals.views)} · Referrals ${naira(totals.referrals)} · Bonus ${naira(totals.bonus)}` },
        { label: "Platform Fee", value: totals.platformFee },
        { label: "Refunds", value: totals.refundsIssued + totals.refundsPending, detail: `Issued ${naira(totals.refundsIssued)} · Pending ${naira(totals.refundsPending)}` },
        { label: "Remaining", value: totals.remaining },
      ]
    : [];

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-10 font-rethink">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div className="space-y-1">
          <Link href="/dashboard/brand" className="text-xs font-medium text-neutral-500">
            ← Back To Campaigns
          </Link>
          <h1 className="font-medium text-[23px] leading-[28px] tracking-tighter text-neutral-900">Payment Statement</h1>
          <p className="text-xs text-neutral-500 font-medium max-w-xl">
            Everything you paid in, and where it went: creators, our platform fee, refunds to you, and what&apos;s still in your campaigns.
            Refunds don&apos;t have Paystack fees taken off.
          </p>
        </div>
        {statement && statement.campaigns.length > 0 && <DownloadButton />}
      </div>

      {error && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-3 text-center">
          <p className="text-sm text-neutral-600 font-medium">{error}</p>
          <button type="button" onClick={load} className="px-5 py-2.5 bg-neutral-900 text-white rounded-full text-sm font-medium">
            Try Again
          </button>
        </div>
      )}

      {!statement && !error && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}

      {statement && statement.campaigns.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-2xl p-10 text-center space-y-1">
          <h2 className="font-medium text-lg text-neutral-900">Nothing paid yet</h2>
          <p className="text-xs text-neutral-500 font-medium">Your statement fills in once you pay for a campaign.</p>
        </div>
      )}

      {statement && statement.campaigns.length > 0 && totals && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8">
            {cards.map((card) => (
              <div key={card.label} className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-1">
                <span className="text-[11px] font-medium text-neutral-500 block">{card.label}</span>
                <span className="font-medium text-lg md:text-xl text-neutral-900 block tabular-nums">{naira(card.value)}</span>
                {card.detail && <span className="text-[11px] font-medium text-neutral-400 block">{card.detail}</span>}
              </div>
            ))}
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs text-neutral-700">
              <thead className="border-b border-neutral-200 text-[11px] text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Campaign</th>
                  <th className="px-4 py-3 font-medium text-right">Paid In</th>
                  <th className="px-4 py-3 font-medium text-right">Deliverables</th>
                  <th className="px-4 py-3 font-medium text-right">Performance</th>
                  <th className="px-4 py-3 font-medium text-right">Platform Fee</th>
                  <th className="px-4 py-3 font-medium text-right">Refunds Issued</th>
                  <th className="px-4 py-3 font-medium text-right">Refunds Pending</th>
                  <th className="px-4 py-3 font-medium text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {statement.campaigns.map((line) => (
                  <tr key={line.campaignId}>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/brand/campaign/${line.campaignId}`} className="font-medium text-neutral-900">
                        {line.name}
                      </Link>
                      <span className="block text-[11px] font-medium text-neutral-400">{STATUS_LABEL[line.status] || line.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(line.paidIn)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.deliverables)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.performance)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.platformFee)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.refundsIssued)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.refundsPending)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{naira(line.remaining)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-neutral-200">
                <tr>
                  <td className="px-4 py-3 font-medium text-neutral-900">Total ({totals.campaigns})</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.paidIn)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.deliverables)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.performance)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.platformFee)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.refundsIssued)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.refundsPending)}</td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900 tabular-nums">{naira(totals.remaining)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
