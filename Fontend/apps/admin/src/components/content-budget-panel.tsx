"use client";

import * as React from "react";
import { API_URL, apiRequest, getToken, getUser } from "../lib/api";
import { MONEY_ROLES } from "../lib/roles";

// Fixed pay and unused budget for one content campaign (ticket 09).
type RefundState = "refunded" | "sent" | "not_sent" | "failed";

interface ContentRefund {
  id: string;
  amount: number;
  deliverables: number;
  state: RefundState;
  error: string | null;
  retryable: boolean;
  createdAt: string;
}

interface UndeliveredItem {
  submissionId: string;
  creatorHandle: string | null;
  approvedAt: string | null;
  credited: boolean;
  voidableFrom: string;
  voidable: boolean;
}

// Hybrid pay (ticket 10): a hybrid campaign's bonus pool beside its base.
interface BonusRefund {
  id: string;
  amount: number;
  status: "refund_pending" | "refunded" | "refund_failed";
  state: RefundState;
  retryable: boolean;
  byHand: number;
  error: string | null;
  createdAt: string;
}

interface BonusBudget {
  metric: "views" | "signups" | "downloads";
  pool: number;
  platformFee: number;
  capPerCreator: number;
  ratePerThousandViews: number | null;
  rewardPerConversion: number | null;
  creators: number;
  creditedAmount: number;
  paidOut: number;
  owedAmount: number;
  poolRemaining: number;
  refundedPool: number;
  refundAllowed: boolean;
  refundableFrom: string | null;
  refundable: { pool: number; platformFee: number; amount: number };
  refunds: BonusRefund[];
}

const BONUS_METRIC_LABEL: Record<BonusBudget["metric"], string> = { views: "Views", signups: "Sign-ups", downloads: "Downloads" };

interface ContentBudget {
  status: string;
  payShape?: "fixed" | "hybrid";
  bonus?: BonusBudget | null;
  ratePerDeliverable: number;
  deliverables: number;
  completed: number;
  owed: number;
  credited: number;
  creditedAmount: number;
  paidOut: number;
  owedAmount: number;
  inProgress: number;
  refunded: number;
  refundedAmount: number;
  refundPendingAmount: number;
  unused: number;
  refundAllowed: boolean;
  refundable: { deliverables: number; creatorBudget: number; platformFee: number; amount: number };
  refunds: ContentRefund[];
  undelivered: UndeliveredItem[];
  reconciliation: { ok: boolean; problems: string[] } | null;
}

interface RefundResponse {
  refund: ContentRefund;
}

type PendingAction =
  | { kind: "refund" }
  | { kind: "refundBonus" }
  | { kind: "retry"; refund: ContentRefund }
  | { kind: "retryBonus"; refund: BonusRefund }
  | { kind: "void"; item: UndeliveredItem };

interface ContentBudgetPanelProps {
  campaignId: string;
  campaignName: string;
}

const naira = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const REFUND_STATE_LABEL: Record<RefundState, string> = {
  refunded: "Refunded",
  sent: "Sent, Waiting For Paystack",
  not_sent: "Not Sent",
  failed: "Failed",
};

// What happened, in words, after a refund request came back.
function outcomeMessage(refund: ContentRefund) {
  if (refund.state === "refunded") return `${naira(refund.amount)} refunded.`;
  if (refund.state === "sent") return `${naira(refund.amount)} sent to Paystack. It shows as refunded once Paystack confirms it.`;
  if (refund.state === "failed") return `Refund failed: ${refund.error || "Paystack didn't accept it"}. You can retry it.`;
  return `${naira(refund.amount)} refund wasn't sent${refund.error ? `: ${refund.error}` : ""}. Retry it.`;
}

export function ContentBudgetPanel({ campaignId, campaignName }: ContentBudgetPanelProps) {
  const [budget, setBudget] = React.useState<ContentBudget | null>(null);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; failed: boolean } | null>(null);
  // Refunds, retries and voids move money: finance admins and super admins only.
  const [canMoveMoney, setCanMoveMoney] = React.useState(false);

  React.useEffect(() => {
    setCanMoveMoney(MONEY_ROLES.includes(getUser()?.role || ""));
  }, []);

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

  const runAction = async () => {
    if (!budget || !pending) return;
    setWorking(true);
    setError("");
    setMessage(null);
    try {
      if (pending.kind === "void") {
        const data = await apiRequest<{ voided: boolean; amount: number }>(
          `/admin/submissions/${pending.item.submissionId}/void-undelivered`,
          { method: "POST", token: getToken() || undefined }
        );
        setMessage({
          text: data.voided ? `${naira(data.amount)} voided and returned to the campaign.` : "This pay was already voided.",
          failed: false,
        });
      } else if (pending.kind === "refundBonus" && budget.bonus) {
        // A failed refund answers 502 with the refund in the body, so it's read directly.
        const token = getToken();
        const res = await fetch(`${API_URL}/admin/campaigns/${campaignId}/refund-unused-bonus`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ expectedAmount: budget.bonus.refundable.amount }),
        });
        const data = (await res.json().catch(() => ({}))) as { refund?: BonusRefund; error?: string };
        if (data.refund) {
          const failed = !["sent", "refunded"].includes(data.refund.state);
          setMessage({
            text: failed
              ? `Bonus refund didn't go through: ${data.refund.error || "Paystack didn't accept it"}. You can retry it.`
              : `${naira(data.refund.amount)} of unused bonus sent to Paystack.`,
            failed,
          });
        } else setError(data.error || `Request failed (${res.status})`);
      } else if (pending.kind === "retryBonus") {
        const token = getToken();
        const res = await fetch(`${API_URL}/admin/refunds/${pending.refund.id}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = (await res.json().catch(() => ({}))) as { refund?: { amount: number; state: RefundState; error: string | null }; error?: string };
        if (data.refund) {
          const failed = !["sent", "refunded"].includes(data.refund.state);
          setMessage({
            text: failed ? `Bonus refund retry didn't go through: ${data.refund.error || "Paystack didn't accept it"}.` : `${naira(data.refund.amount)} of unused bonus sent to Paystack.`,
            failed,
          });
        } else setError(data.error || `Request failed (${res.status})`);
      } else {
        const path =
          pending.kind === "retry"
            ? `/admin/campaigns/${campaignId}/refunds/${pending.refund.id}/retry`
            : `/admin/campaigns/${campaignId}/refund-unused`;
        const body = pending.kind === "refund" ? JSON.stringify({ expectedAmount: budget.refundable.amount }) : undefined;
        // A failed refund answers 502 with the refund in the body, so it's read directly.
        const token = getToken();
        const res = await fetch(`${API_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body,
        });
        const data = (await res.json().catch(() => ({}))) as Partial<RefundResponse> & { error?: string };
        // Only a refund Paystack took is good news; not sent and failed both need a retry.
        if (data.refund) setMessage({ text: outcomeMessage(data.refund), failed: !["sent", "refunded"].includes(data.refund.state) });
        else setError(data.error || `Request failed (${res.status})`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setPending(null);
      setWorking(false);
      load();
    }
  };

  const stats: Array<{ label: string; value: number }> = budget
    ? [
        { label: "Bought", value: budget.deliverables },
        { label: "Completed", value: budget.completed },
        { label: "Awaiting Delivery", value: budget.owed },
        { label: "In Progress", value: budget.inProgress },
        { label: "Unused", value: budget.unused },
        // Held for refunds not yet confirmed as well as ones Paystack completed; the list below has each state.
        { label: "Refund Reserved", value: budget.refunded },
      ]
    : [];

  const openRefund = budget ? budget.refunds.some((r) => r.retryable) : false;

  return (
    <div className="pt-4 border-t border-stone-200 space-y-3 font-rethink">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-stone-500">{budget?.bonus ? "Deliverables And Base Pay" : "Deliverables And Fixed Pay"}</h4>
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
            Credited {naira(budget.creditedAmount)} · Paid out {naira(budget.paidOut)} · Owed {naira(budget.owedAmount)}
          </p>
          {budget.reconciliation && !budget.reconciliation.ok && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1">
              <span className="text-[11px] font-medium text-red-700 block">Books Don&apos;t Balance</span>
              {budget.reconciliation.problems.map((problem) => (
                <p key={problem} className="text-[11px] font-medium text-red-700">
                  {problem}
                </p>
              ))}
            </div>
          )}

          {budget.refunds.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium text-stone-400 block">Refunds</span>
              {budget.refunds.map((refund) => (
                <div key={refund.id} className="flex items-center justify-between gap-3 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-900">
                      {naira(refund.amount)} · {refund.deliverables} deliverable{refund.deliverables === 1 ? "" : "s"} · {shortDate(refund.createdAt)}
                    </p>
                    <p className={refund.state === "failed" ? "text-[11px] font-medium text-red-600" : "text-[11px] font-medium text-stone-500"}>
                      {REFUND_STATE_LABEL[refund.state]}
                      {refund.error && `: ${refund.error}`}
                    </p>
                  </div>
                  {refund.retryable && (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "retry", refund })}
                      disabled={working || !canMoveMoney}
                      className="shrink-0 px-3 py-1.5 border border-stone-300 text-stone-700 rounded-full font-semibold text-[11px] disabled:opacity-40"
                    >
                      Retry Refund
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {budget.undelivered.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium text-stone-400 block">Approved, Not Delivered</span>
              {budget.undelivered.map((item) => (
                <div key={item.submissionId} className="flex items-center justify-between gap-3 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                  <p className="text-[11px] font-medium text-stone-600 min-w-0">
                    @{item.creatorHandle || "creator"}
                    {item.approvedAt && ` · approved ${shortDate(item.approvedAt)}`}
                    {!item.voidable && ` · can be voided from ${shortDate(item.voidableFrom)}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPending({ kind: "void", item })}
                    disabled={!item.voidable || working || !canMoveMoney}
                    className="shrink-0 px-3 py-1.5 border border-stone-300 text-stone-700 rounded-full font-semibold text-[11px] disabled:opacity-40"
                  >
                    Void Undelivered Pay
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-stone-500">
              {!budget.refundAllowed
                ? "Unused budget can be refunded once the campaign is completed or cancelled."
                : openRefund
                  ? "Retry the refund that didn't go through before starting another."
                  : budget.refundable.amount > 0
                    ? `${naira(budget.refundable.amount)} refundable for ${budget.refundable.deliverables} unused deliverable${budget.refundable.deliverables === 1 ? "" : "s"}.`
                    : "Nothing to refund."}
            </p>
            <button
              type="button"
              onClick={() => setPending({ kind: "refund" })}
              disabled={!budget.refundAllowed || openRefund || budget.refundable.amount <= 0 || working || !canMoveMoney}
              className="shrink-0 px-4 py-2 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-40"
            >
              Refund Unused Budget
            </button>
          </div>
          {budget.bonus && (
            <div className="pt-3 border-t border-stone-200 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-stone-500">Bonus Pool</h4>
                <span className="text-[11px] font-medium text-stone-400">
                  {BONUS_METRIC_LABEL[budget.bonus.metric]} ·{" "}
                  {budget.bonus.metric === "views"
                    ? `${naira(budget.bonus.ratePerThousandViews ?? 0)} per 1,000 views`
                    : budget.bonus.rewardPerConversion
                      ? `${naira(budget.bonus.rewardPerConversion)} per conversion`
                      : "reward not set"}{" "}
                  · cap {naira(budget.bonus.capPerCreator)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Pool", value: budget.bonus.pool },
                  { label: "Fee On Pool", value: budget.bonus.platformFee },
                  { label: "Credited", value: budget.bonus.creditedAmount },
                  { label: "Paid Out", value: budget.bonus.paidOut },
                  { label: "Owed", value: budget.bonus.owedAmount },
                  { label: "Left In Pool", value: budget.bonus.poolRemaining },
                ].map((stat) => (
                  <div key={stat.label} className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                    <span className="text-[10px] font-medium text-stone-400 block">{stat.label}</span>
                    <span className="text-sm font-medium text-stone-900 tabular-nums">{naira(stat.value)}</span>
                  </div>
                ))}
              </div>
              {budget.bonus.refunds.map((refund) => (
                <div key={refund.id} className="flex items-center justify-between gap-3 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-900">
                      {naira(refund.amount)} unused bonus · {shortDate(refund.createdAt)}
                    </p>
                    <p className={refund.state === "failed" ? "text-[11px] font-medium text-red-600" : "text-[11px] font-medium text-stone-500"}>
                      {REFUND_STATE_LABEL[refund.state]}
                      {refund.error && `: ${refund.error}`}
                    </p>
                  </div>
                  {refund.retryable && (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "retryBonus", refund })}
                      disabled={working || !canMoveMoney}
                      className="shrink-0 px-3 py-1.5 border border-stone-300 text-stone-700 rounded-full font-semibold text-[11px] disabled:opacity-40"
                    >
                      Retry Refund
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-medium text-stone-500">
                  {!budget.bonus.refundAllowed
                    ? budget.bonus.refundableFrom
                      ? `The unused bonus can be refunded from ${shortDate(budget.bonus.refundableFrom)}, once conversions stop counting.`
                      : "The unused bonus can be refunded once the campaign is completed or cancelled."
                    : budget.bonus.refundable.amount > 0
                      ? `${naira(budget.bonus.refundable.amount)} refundable: ${naira(budget.bonus.refundable.pool)} unused pool and its fee.`
                      : "No unused bonus to refund."}
                </p>
                <button
                  type="button"
                  onClick={() => setPending({ kind: "refundBonus" })}
                  disabled={!budget.bonus.refundAllowed || budget.bonus.refundable.amount <= 0 || working || !canMoveMoney}
                  className="shrink-0 px-4 py-2 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-40"
                >
                  Refund Unused Bonus
                </button>
              </div>
            </div>
          )}
          {!canMoveMoney && (
            <p className="text-[11px] font-medium text-stone-400">Only finance admins and super admins can refund, retry refunds or void pay.</p>
          )}
        </>
      )}

      {message && (
        <p className={message.failed ? "text-[11px] font-medium text-red-600" : "text-[11px] font-medium text-green-700"}>{message.text}</p>
      )}
      {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}

      {pending && budget && (
        <div className="fixed inset-0 z-[60] bg-stone-950/60 flex items-center justify-center p-4" onClick={() => !working && setPending(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="content-budget-action-heading"
            className="bg-white rounded-2xl max-w-sm w-full p-6 border border-stone-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.kind === "refundBonus" && budget.bonus ? (
              <>
                <div className="space-y-1">
                  <h3 id="content-budget-action-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                    Refund {naira(budget.bonus.refundable.amount)} Of Unused Bonus?
                  </h3>
                  <p className="text-xs font-medium text-stone-500 leading-relaxed">
                    Sent back to the brand&apos;s Paystack payment for &quot;{campaignName}&quot;. No more bonus can be earned from what&apos;s refunded;
                    bonus already credited stays owed to creators. Paystack fees aren&apos;t deducted.
                  </p>
                </div>
                <dl className="bg-stone-50 rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="font-medium text-stone-500">Unused Pool</dt>
                    <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.bonus.refundable.pool)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="font-medium text-stone-500">Platform Fee On It</dt>
                    <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.bonus.refundable.platformFee)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-stone-200 pt-2">
                    <dt className="font-medium text-stone-900">Refund</dt>
                    <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.bonus.refundable.amount)}</dd>
                  </div>
                </dl>
              </>
            ) : pending.kind === "void" ? (
              <div className="space-y-1">
                <h3 id="content-budget-action-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                  Void Undelivered Pay?
                </h3>
                <p className="text-xs font-medium text-stone-500 leading-relaxed">
                  @{pending.item.creatorHandle || "creator"}&apos;s approved content for &quot;{campaignName}&quot; was never delivered. Their fixed pay
                  goes back to the campaign, and they&apos;re told. They can appeal within 7 days; after that (or once an appeal is denied) the
                  deliverable becomes refundable.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <h3 id="content-budget-action-heading" className="text-lg font-medium text-stone-900 tracking-tight">
                    {pending.kind === "retry" || pending.kind === "retryBonus" ? `Retry ${naira(pending.refund.amount)} Refund?` : `Refund ${naira(budget.refundable.amount)}?`}
                  </h3>
                  <p className="text-xs font-medium text-stone-500 leading-relaxed">
                    Sent back to the brand&apos;s Paystack payment for &quot;{campaignName}&quot;. Money owed to creators stays in the campaign. Paystack
                    fees aren&apos;t deducted.
                  </p>
                </div>
                {pending.kind === "refund" && (
                  <dl className="bg-stone-50 rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="font-medium text-stone-500">Unused Deliverables</dt>
                      <dd className="font-medium text-stone-900 tabular-nums">{budget.refundable.deliverables}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="font-medium text-stone-500">Creator Budget</dt>
                      <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.creatorBudget)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="font-medium text-stone-500">Platform Fee On Them</dt>
                      <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.platformFee)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-stone-200 pt-2">
                      <dt className="font-medium text-stone-900">Refund</dt>
                      <dd className="font-medium text-stone-900 tabular-nums">{naira(budget.refundable.amount)}</dd>
                    </div>
                  </dl>
                )}
              </>
            )}
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
                onClick={runAction}
                disabled={working}
                className="flex-1 py-2.5 bg-stone-900 text-white rounded-full font-semibold text-xs disabled:opacity-50"
              >
                {working ? "Working..." : pending.kind === "void" ? "Void Pay" : pending.kind === "retry" || pending.kind === "retryBonus" ? "Retry Refund" : "Confirm Refund"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
