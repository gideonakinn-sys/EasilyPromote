"use client";

import * as React from "react";
import { apiRequest, getToken } from "../lib/api";

// Fixed pay and unused budget for one content campaign (ticket 09).
interface ContentBudget {
  status: string;
  ratePerDeliverable: number;
  deliverables: number;
  completed: number;
  owed: number;
  credited: number;
  creditedAmount: number;
  inProgress: number;
  refunded: number;
  refundedAmount: number;
  unused: number;
  refundAllowed: boolean;
  refundable: { deliverables: number; creatorBudget: number; platformFee: number; amount: number };
  reconciliation: { ok: boolean; problems: string[] } | null;
}

interface ContentBudgetPanelProps {
  campaignId: string;
  campaignName: string;
}

const naira = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);

export function ContentBudgetPanel({ campaignId, campaignName }: ContentBudgetPanelProps) {
  const [budget, setBudget] = React.useState<ContentBudget | null>(null);
  const [error, setError] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [refunding, setRefunding] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      setError("");
      const data = await apiRequest<ContentBudget>(`/admin/campaigns/${campaignId}/content-budget`, {
        token: getToken() || undefined,
      });
      setBudget(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load deliverables");
    }
  }, [campaignId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleRefund = async () => {
    if (!budget) return;
    setRefunding(true);
    setError("");
    try {
      const data = await apiRequest<{ refund: { amount: number; deliverables: number } }>(
        `/admin/campaigns/${campaignId}/refund-unused`,
        {
          method: "POST",
          token: getToken() || undefined,
          body: JSON.stringify({ expectedAmount: budget.refundable.amount }),
        }
      );
      setMessage(`${naira(data.refund.amount)} refund sent to Paystack for ${data.refund.deliverables} unused deliverable${data.refund.deliverables === 1 ? "" : "s"}.`);
      setConfirming(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Refund failed");
      setConfirming(false);
    } finally {
      setRefunding(false);
      load();
    }
  };

  const stats: Array<{ label: string; value: number }> = budget
    ? [
        { label: "Bought", value: budget.deliverables },
        { label: "Completed", value: budget.completed },
        { label: "Owed", value: budget.owed },
        { label: "In Progress", value: budget.inProgress },
        { label: "Unused", value: budget.unused },
        { label: "Refunded", value: budget.refunded },
      ]
    : [];

  return (
    <div className="pt-4 border-t border-stone-200 space-y-3 font-rethink">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-stone-500">Deliverables And Fixed Pay</h4>
        {budget && (
          <span className="text-[11px] font-medium text-stone-400">{naira(budget.ratePerDeliverable)} per deliverable</span>
        )}
      </div>

      {!budget && !error && <p className="text-[11px] font-medium text-stone-400">Loading deliverables...</p>}

      {budget && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                <span className="text-[10px] font-medium text-stone-400 block">{stat.label}</span>
                <span className="text-sm font-medium text-stone-900 tabular-nums">{stat.value}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] font-medium text-stone-500">
            Credited to creators {naira(budget.creditedAmount)}
            {budget.refundedAmount > 0 && ` · Refunded ${naira(budget.refundedAmount)}`}
          </p>
          {budget.reconciliation && !budget.reconciliation.ok && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-red-700 block">Books don&apos;t balance</span>
              {budget.reconciliation.problems.map((problem) => (
                <p key={problem} className="text-[11px] font-medium text-red-700">
                  {problem}
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-stone-500">
              {budget.refundAllowed
                ? budget.refundable.amount > 0
                  ? `${naira(budget.refundable.amount)} refundable for ${budget.refundable.deliverables} unused deliverable${budget.refundable.deliverables === 1 ? "" : "s"}.`
                  : "Nothing to refund."
                : "Unused budget can be refunded once the campaign is completed or cancelled."}
            </p>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!budget.refundAllowed || budget.refundable.amount <= 0 || refunding}
              className="shrink-0 px-4 py-2 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-40"
            >
              Refund Unused Budget
            </button>
          </div>
        </>
      )}

      {message && <p className="text-[11px] font-medium text-green-700">{message}</p>}
      {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}

      {confirming && budget && (
        <div
          className="fixed inset-0 z-[60] bg-stone-950/60 flex items-center justify-center p-4"
          onClick={() => !refunding && setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-unused-heading"
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-stone-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="refund-unused-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                Refund {naira(budget.refundable.amount)}?
              </h3>
              <p className="text-xs font-medium text-stone-500 leading-relaxed">
                Sent back to the brand&apos;s Paystack payment for &quot;{campaignName}&quot;. Money owed to creators stays in the campaign.
                This can&apos;t be undone.
              </p>
            </div>
            <dl className="bg-stone-50 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-stone-500">Unused deliverables</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{budget.refundable.deliverables}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-stone-500">Creator budget</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.creatorBudget)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-stone-500">Platform fee on them</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.platformFee)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-stone-200 pt-2">
                <dt className="font-medium text-stone-900">Refund</dt>
                <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.amount)}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={refunding}
                className="flex-1 py-2.5 border border-stone-200 text-stone-600 rounded-full font-semibold text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRefund}
                disabled={refunding}
                className="flex-1 py-2.5 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-50"
              >
                {refunding ? "Refunding..." : "Confirm Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
