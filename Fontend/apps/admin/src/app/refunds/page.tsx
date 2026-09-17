"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { API_URL, apiRequest, getToken, getUser, isAuthenticated } from "../../lib/api";
import { MONEY_ROLES } from "../../lib/roles";

// Every refund to brands (D23): content budget, views, referral budget and bonus pool refunds, with the
// ones that failed or never reached Paystack retryable from their own row by finance and super admins.
type RefundState = "refunded" | "sent" | "not_sent" | "failed";
type Pot = "views" | "referral" | "fixed" | "bonus";

interface RefundPart {
  chargeReference: string | null;
  amount: number;
  status: "pending" | "processed" | "failed";
  sent: boolean;
  error: string | null;
}

interface RefundRow {
  id: string;
  campaignId: string | null;
  campaignName: string;
  campaignStatus: string | null;
  pot: Pot;
  potLabel: string;
  amount: number;
  state: RefundState;
  retryable: boolean;
  sending: boolean;
  byHand: number;
  error: string | null;
  parts: RefundPart[];
  createdAt: string;
}

type Filter = "attention" | "sent" | "refunded" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "attention", label: "Needs Attention" },
  { value: "sent", label: "Waiting For Paystack" },
  { value: "refunded", label: "Refunded" },
  { value: "all", label: "All" },
];

const STATE_LABEL: Record<RefundState, string> = {
  refunded: "Refunded",
  sent: "Sent, Waiting For Paystack",
  not_sent: "Not Sent",
  failed: "Failed",
};

const STATE_STYLE: Record<RefundState, string> = {
  refunded: "bg-green-50 text-green-700 border-green-200",
  sent: "bg-stone-50 text-stone-600 border-stone-200",
  not_sent: "bg-amber-50 text-amber-700 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200",
};

const naira = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function RefundsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("attention");
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [autoRefundsEnabled, setAutoRefundsEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [canMoveMoney, setCanMoveMoney] = useState(false);
  const [pending, setPending] = useState<RefundRow | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest<{ refunds: RefundRow[]; autoRefundsEnabled?: boolean }>(`/admin/refunds?state=${filter}&limit=200`);
      setRefunds(data.refunds || []);
      setAutoRefundsEnabled(data.autoRefundsEnabled === true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load refunds");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    setCanMoveMoney(MONEY_ROLES.includes(getUser()?.role || ""));
    load();
  }, [router, load]);

  const retry = async () => {
    if (!pending) return;
    setWorking(true);
    setMessage(null);
    try {
      // A retry Paystack still refuses answers 502 with the refund in the body, so it's read directly.
      const token = getToken();
      const res = await fetch(`${API_URL}/admin/refunds/${pending.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = (await res.json().catch(() => ({}))) as { refund?: { amount: number; state: RefundState; error: string | null }; error?: string };
      if (data.refund) {
        const wentThrough = ["sent", "refunded"].includes(data.refund.state);
        setMessage({
          text: wentThrough
            ? `${naira(data.refund.amount)} sent to Paystack. It shows as refunded once Paystack confirms it.`
            : `The retry didn't go through${data.refund.error ? `: ${data.refund.error}` : ""}. You can retry it again.`,
          failed: !wentThrough,
        });
      } else {
        setMessage({ text: data.error || `Request failed (${res.status})`, failed: true });
      }
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "That didn't go through", failed: true });
    } finally {
      setPending(null);
      setWorking(false);
      load();
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6 space-y-1">
          <h1 className="text-2xl font-medium text-stone-900 tracking-tight">Refunds</h1>
          <p className="text-sm text-stone-500 font-medium">
            Unused budget sent back to brands, automatically or by hand. A refund that failed or never reached Paystack is retried from the same
            refund, so it&apos;s never sent twice.
          </p>
        </header>

        {autoRefundsEnabled === false && (
          <div className="mb-5 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-800">
            <p className="text-sm font-medium">Automatic Refunds Are Off</p>
            <p className="text-xs font-medium mt-1">
              Unused budget isn&apos;t refunded automatically on this server (AUTO_REFUNDS_ENABLED isn&apos;t true). Refund ended campaigns by hand from
              Campaigns; retries here still work.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`px-4 py-2 rounded-full text-xs font-semibold border ${
                filter === f.value ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          {!canMoveMoney && <span className="text-[11px] font-medium text-stone-400 ml-2">Only finance admins and super admins can retry refunds.</span>}
        </div>

        {message && <p className={`mb-4 text-xs font-medium ${message.failed ? "text-red-600" : "text-green-700"}`}>{message.text}</p>}
        {error && <p className="mb-4 text-xs font-medium text-red-600">{error}</p>}

        <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 text-[11px] text-stone-500 font-medium">
              <tr>
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-5 py-3 font-medium">Budget</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-stone-200 rounded w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : refunds.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-stone-400 font-medium">
                    {filter === "attention" ? "No refunds need attention." : "No refunds here."}
                  </td>
                </tr>
              ) : (
                refunds.map((refund) => (
                  <tr key={refund.id} className="align-top">
                    <td className="px-5 py-4">
                      {refund.campaignId ? (
                        <Link href={`/campaigns?open=${refund.campaignId}`} className="font-medium text-stone-900 underline-offset-2 underline">
                          {refund.campaignName}
                        </Link>
                      ) : (
                        <span className="font-medium text-stone-900">{refund.campaignName}</span>
                      )}
                      {refund.campaignStatus && <span className="block text-[11px] text-stone-400 font-medium capitalize">{refund.campaignStatus}</span>}
                    </td>
                    <td className="px-5 py-4 font-medium">{refund.potLabel}</td>
                    <td className="px-5 py-4 font-medium text-stone-900 tabular-nums">{naira(refund.amount)}</td>
                    <td className="px-5 py-4 max-w-sm">
                      <span className={`inline-block px-2.5 py-1 rounded-full border text-[11px] font-medium ${STATE_STYLE[refund.state]}`}>
                        {STATE_LABEL[refund.state]}
                      </span>
                      {refund.error && <p className="mt-1.5 text-[11px] font-medium text-stone-500">{refund.error}</p>}
                      {refund.byHand > 0 && (
                        <p className="mt-1 text-[11px] font-medium text-red-600">
                          {naira(refund.byHand)} has no Paystack payment to refund against: refund it by hand in the Paystack dashboard.
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-stone-500 font-medium">{shortDate(refund.createdAt)}</td>
                    <td className="px-5 py-4 text-right">
                      {refund.retryable && (
                        <button
                          type="button"
                          onClick={() => setPending(refund)}
                          disabled={!canMoveMoney || refund.sending || working}
                          title={refund.sending ? "Being sent right now" : undefined}
                          className="px-3.5 py-1.5 border border-stone-300 text-stone-700 rounded-full font-semibold text-[11px] disabled:opacity-40"
                        >
                          {refund.sending ? "Sending…" : "Retry Refund"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {pending && (
        <div className="fixed inset-0 z-[60] bg-stone-950/60 flex items-center justify-center p-4" onClick={() => !working && setPending(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="retry-refund-heading"
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-stone-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="retry-refund-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                Retry {naira(pending.amount)} Refund?
              </h3>
              <p className="text-xs font-medium text-stone-500 leading-relaxed">
                The {pending.potLabel.toLowerCase()} refund for &quot;{pending.campaignName}&quot; is sent again to the brand&apos;s Paystack payment. Parts
                Paystack already has are recognised and not sent twice.
              </p>
            </div>
            <dl className="bg-stone-50 rounded-xl p-4 space-y-2 text-xs">
              {pending.parts.map((part, i) => (
                <div key={`${part.chargeReference}-${i}`} className="flex justify-between gap-3">
                  <dt className="font-medium text-stone-500 truncate">{part.chargeReference || "No payment on record"}</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">
                    {naira(part.amount)} · {part.status === "processed" ? "Refunded" : part.status === "failed" ? "Failed" : part.sent ? "Sent" : "Not Sent"}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={working}
                className="flex-1 py-2.5 border border-stone-200 text-stone-600 rounded-full font-semibold text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={retry}
                disabled={working}
                className="flex-1 py-2.5 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-50"
              >
                {working ? "Retrying…" : "Retry Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
