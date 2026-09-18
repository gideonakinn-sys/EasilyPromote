"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, getUser, isAuthenticated } from "../../lib/api";
import { MONEY_ROLES } from "../../lib/roles";

interface RunLine {
  id: string;
  creatorName: string;
  kind: string;
  viewsAmount: number;
  referralAmount: number;
  fixedAmount?: number;
  bonusAmount?: number;
  amount: number;
  estimatedFee: number;
  requestedAt: string;
  attempts: number;
  adminNotes: string | null;
}

interface RunGroup {
  campaignId: string | null;
  campaignName: string;
  campaignStatus: string | null;
  brandName: string;
  viewsEscrow: number;
  referralEscrow: number;
  fixedEscrow?: number;
  bonusEscrow?: number;
  lines: RunLine[];
  amount: number;
  estimatedFees: number;
}

interface PayoutRun {
  dueBefore: string;
  nextPayoutDate: string;
  groups: RunGroup[];
  totals: { count: number; amount: number; estimatedFees: number };
  upcoming: { count: number; amount: number };
  paystackBalance: number | null;
}

interface ApproveResult {
  paid: number;
  processing: number;
  failed: number;
  skipped: number;
  results: { id: string; ok: boolean; status: string; error: string | null }[];
}

const naira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount || 0);

const payoutDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });

export default function PayoutRunPage() {
  const router = useRouter();
  const [run, setRun] = useState<PayoutRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const [rejectLine, setRejectLine] = useState<RunLine | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState("");
  // Paying or rejecting is for finance admins and super admins; everyone else can look.
  const [canPay, setCanPay] = useState(false);

  useEffect(() => {
    setCanPay(MONEY_ROLES.includes(getUser()?.role || ""));
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await apiRequest<PayoutRun>("/admin/payout-run", { token: getToken() || undefined });
      setRun(data);
      setSelected(new Set(data.groups.flatMap((group) => group.lines.map((line) => line.id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the payout run");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    load();
  }, [router, load]);

  useEffect(() => {
    if (!confirmIds && !rejectLine) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!approving) setConfirmIds(null);
      if (!rejecting) setRejectLine(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmIds, rejectLine, approving, rejecting]);

  const lineById = useMemo(() => {
    const map = new Map<string, RunLine>();
    run?.groups.forEach((group) => group.lines.forEach((line) => map.set(line.id, line)));
    return map;
  }, [run]);

  const selectedTotal = [...selected].reduce((sum, id) => sum + (lineById.get(id)?.amount || 0), 0);
  const selectedFees = [...selected].reduce((sum, id) => sum + (lineById.get(id)?.estimatedFee || 0), 0);

  const toggleLine = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (group: RunGroup) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = group.lines.every((line) => next.has(line.id));
      group.lines.forEach((line) => (allSelected ? next.delete(line.id) : next.add(line.id)));
      return next;
    });

  const approve = async () => {
    if (!confirmIds) return;
    setApproving(true);
    try {
      const data = await apiRequest<ApproveResult>("/admin/payout-run/approve", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ withdrawalIds: confirmIds }),
      });
      setResult(data);
      setConfirmIds(null);
      await load();
    } catch (err) {
      setResult({
        paid: 0,
        processing: 0,
        failed: confirmIds.length,
        skipped: 0,
        results: [{ id: "run", ok: false, status: "failed", error: err instanceof Error ? err.message : "The payout run failed" }],
      });
      setConfirmIds(null);
    } finally {
      setApproving(false);
    }
  };

  const reject = async (e: FormEvent) => {
    e.preventDefault();
    if (!rejectLine) return;
    if (!rejectNote.trim()) {
      setRejectError("Add a reason. The creator sees it.");
      return;
    }
    setRejecting(true);
    setRejectError("");
    try {
      await apiRequest(`/admin/withdrawals/${rejectLine.id}/review`, {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ approve: false, note: rejectNote.trim() }),
      });
      setRejectLine(null);
      setRejectNote("");
      await load();
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : "Couldn't reject the withdrawal");
    } finally {
      setRejecting(false);
    }
  };

  const balanceShort = run && run.paystackBalance !== null && run.paystackBalance < selectedTotal;

  return (
    <div className="min-h-screen bg-[#fafafa] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto min-w-0">
        <header className="pb-6 border-b border-neutral-200 mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Weekly Payout Run</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {run
              ? `Withdrawals requested before ${payoutDay(run.dueBefore)}, grouped by campaign. Requests made since then are paid on ${payoutDay(run.nextPayoutDate)}.`
              : "Creators withdraw once a week per campaign; everything due is paid here in one run."}
          </p>
        </header>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {run && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-neutral-200/90 rounded-2xl p-5">
              <span className="text-xs font-semibold text-neutral-500 block mb-1">Due now</span>
              <span className="text-2xl font-bold text-neutral-900">{naira(run.totals.amount)}</span>
              <span className="text-[11px] text-neutral-400 block mt-1">{run.totals.count} withdrawal{run.totals.count === 1 ? "" : "s"}</span>
            </div>
            <div className="bg-white border border-neutral-200/90 rounded-2xl p-5">
              <span className="text-xs font-semibold text-neutral-500 block mb-1">Paystack fees (est.)</span>
              <span className="text-2xl font-bold text-neutral-900">{naira(run.totals.estimatedFees)}</span>
              <span className="text-[11px] text-neutral-400 block mt-1">Covered by the platform fee</span>
            </div>
            <div className="bg-white border border-neutral-200/90 rounded-2xl p-5">
              <span className="text-xs font-semibold text-neutral-500 block mb-1">Paystack balance</span>
              <span className={`text-2xl font-bold ${balanceShort ? "text-red-600" : "text-neutral-900"}`}>
                {run.paystackBalance === null ? "Unavailable" : naira(run.paystackBalance)}
              </span>
              <span className="text-[11px] text-neutral-400 block mt-1">{balanceShort ? "Doesn't cover the selected payouts" : "Funds every transfer"}</span>
            </div>
            <div className="bg-white border border-neutral-200/90 rounded-2xl p-5">
              <span className="text-xs font-semibold text-neutral-500 block mb-1">Next run</span>
              <span className="text-2xl font-bold text-neutral-900">{naira(run.upcoming.amount)}</span>
              <span className="text-[11px] text-neutral-400 block mt-1">
                {run.upcoming.count} requested for {payoutDay(run.nextPayoutDate)}
              </span>
            </div>
          </div>
        )}

        {result && (
          <div
            role="status"
            className={`mb-6 rounded-2xl border p-4 text-sm ${result.failed > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900"}`}
          >
            <p className="font-semibold">
              {result.paid} paid · {result.processing} on the way · {result.failed} not paid
              {result.skipped > 0 && ` · ${result.skipped} no longer due`}
            </p>
            {result.results.filter((item) => !item.ok).length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {result.results
                  .filter((item) => !item.ok)
                  .map((item) => (
                    <li key={item.id}>
                      {lineById.get(item.id)?.creatorName || "Withdrawal"}: {item.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {run && run.groups.length > 0 && (
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 bg-[#fafafa] py-2">
            <span className="text-sm text-neutral-600">
              {selected.size} selected · <span className="font-semibold text-neutral-900">{naira(selectedTotal)}</span> · est. fees {naira(selectedFees)}
            </span>
            <div className="flex items-center gap-3">
              {!canPay && <span className="text-[11px] text-neutral-500">Only finance admins and super admins can pay or reject</span>}
              <button
                onClick={() => setConfirmIds([...selected])}
                disabled={selected.size === 0 || !canPay}
                className="px-5 py-2.5 rounded-full text-xs font-semibold bg-green-600 text-white disabled:bg-neutral-200 disabled:text-neutral-400"
              >
                Pay selected
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : run && run.groups.length === 0 ? (
          <div className="bg-white border border-dashed border-neutral-300 rounded-2xl p-10 text-center">
            <p className="text-sm font-semibold text-neutral-900">Nothing due right now</p>
            <p className="text-xs text-neutral-500 mt-1">
              {run.upcoming.count > 0
                ? `${run.upcoming.count} withdrawal${run.upcoming.count === 1 ? " is" : "s are"} due on ${payoutDay(run.nextPayoutDate)}.`
                : "New requests show up here once their payout day arrives."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {run?.groups.map((group) => {
              const allSelected = group.lines.every((line) => selected.has(line.id));
              return (
                <section key={group.campaignId || group.campaignName} className="bg-white border border-neutral-200/90 rounded-2xl overflow-hidden">
                  <div className="p-4 bg-neutral-50 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-bold text-sm text-neutral-900">{group.campaignName}</h2>
                      <p className="text-[11px] text-neutral-500">
                        {group.brandName} · {group.campaignStatus || "unknown"} · views escrow {naira(group.viewsEscrow)} · referral budget{" "}
                        {naira(group.referralEscrow)}
                        {(group.fixedEscrow ?? 0) > 0 && ` · fixed pay owed ${naira(group.fixedEscrow ?? 0)}`}
                        {(group.bonusEscrow ?? 0) > 0 && ` · bonus owed ${naira(group.bonusEscrow ?? 0)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-neutral-600">
                        {naira(group.amount)} · est. fees {naira(group.estimatedFees)}
                      </span>
                      <label className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
                        <input type="checkbox" checked={allSelected} onChange={() => toggleGroup(group)} className="w-4 h-4 accent-neutral-900" />
                        Select campaign
                      </label>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-neutral-700">
                      <thead className="bg-neutral-50 border-b border-neutral-200 font-bold uppercase tracking-wider text-[10px] text-neutral-500">
                        <tr>
                          <th className="px-6 py-3 w-10"><span className="sr-only">Select</span></th>
                          <th className="px-6 py-3">Creator</th>
                          <th className="px-6 py-3">Views</th>
                          <th className="px-6 py-3">Referral</th>
                          <th className="px-6 py-3">Fixed</th>
                          <th className="px-6 py-3">Bonus</th>
                          <th className="px-6 py-3">Total</th>
                          <th className="px-6 py-3">Est. fee</th>
                          <th className="px-6 py-3">Requested</th>
                          <th className="px-6 py-3"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {group.lines.map((line) => (
                          <tr key={line.id} className="align-top">
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                aria-label={`Pay ${line.creatorName}`}
                                checked={selected.has(line.id)}
                                onChange={() => toggleLine(line.id)}
                                className="w-4 h-4 accent-neutral-900"
                              />
                            </td>
                            <td className="px-6 py-4">
                              <p className="font-semibold text-neutral-800">{line.creatorName}</p>
                              {line.attempts > 0 && <p className="text-[11px] text-amber-700">{line.attempts} earlier attempt{line.attempts === 1 ? "" : "s"}</p>}
                              {line.adminNotes && <p className="text-[11px] text-neutral-400 max-w-xs">{line.adminNotes}</p>}
                            </td>
                            <td className="px-6 py-4 font-mono">{naira(line.viewsAmount)}</td>
                            <td className="px-6 py-4 font-mono">{naira(line.referralAmount)}</td>
                            <td className="px-6 py-4 font-mono">{naira(line.fixedAmount ?? 0)}</td>
                            <td className="px-6 py-4 font-mono">{naira(line.bonusAmount ?? 0)}</td>
                            <td className="px-6 py-4 font-mono font-bold text-neutral-900">{naira(line.amount)}</td>
                            <td className="px-6 py-4 font-mono text-neutral-500">{naira(line.estimatedFee)}</td>
                            <td className="px-6 py-4 text-neutral-500 whitespace-nowrap">
                              {new Date(line.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </td>
                            <td className="px-6 py-4">
                              <button
                                onClick={() => {
                                  setRejectLine(line);
                                  setRejectNote("");
                                  setRejectError("");
                                }}
                                disabled={!canPay}
                                className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-red-200 text-red-600 disabled:opacity-40"
                              >
                                Reject
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {confirmIds && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm px-4"
          onClick={() => !approving && setConfirmIds(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-run-heading"
            className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-sm w-full space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h3 id="pay-run-heading" className="font-medium text-lg text-neutral-900">
                Pay {confirmIds.length} withdrawal{confirmIds.length === 1 ? "" : "s"}?
              </h3>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                {naira(selectedTotal)} goes to creators&apos; bank accounts through Paystack, one transfer per campaign withdrawal.
                Estimated Paystack fees of {naira(selectedFees)} are recorded against each campaign.
              </p>
              {balanceShort && (
                <p className="text-xs text-red-600 font-medium">Your Paystack balance doesn&apos;t cover this. The run will be refused.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmIds(null)}
                disabled={approving}
                className="flex-1 py-2.5 bg-neutral-50 border border-neutral-200 text-neutral-600 rounded-full font-medium text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={approving}
                className="flex-1 py-2.5 rounded-full font-semibold text-xs text-white bg-green-600 disabled:opacity-50"
              >
                {approving ? "Paying…" : "Pay now"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectLine && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm px-4"
          onClick={() => !rejecting && setRejectLine(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-heading"
            onSubmit={reject}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-sm w-full space-y-5"
          >
            <div className="space-y-1.5">
              <h3 id="reject-heading" className="font-medium text-lg text-neutral-900">
                Reject {rejectLine.creatorName}&apos;s {naira(rejectLine.amount)}?
              </h3>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                Nothing is paid. The creator is told why and can withdraw from this campaign again this week.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="reject-note" className="text-xs font-medium text-neutral-500">
                Reason (required)
              </label>
              <textarea
                id="reject-note"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-900 focus:outline-none focus:border-neutral-400 resize-none"
                placeholder="e.g. Views under review for fraud"
              />
              {rejectError && <p className="text-xs text-red-600 font-medium">{rejectError}</p>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRejectLine(null)}
                disabled={rejecting}
                className="flex-1 py-2.5 bg-neutral-50 border border-neutral-200 text-neutral-600 rounded-full font-medium text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button type="submit" disabled={rejecting} className="flex-1 py-2.5 rounded-full font-semibold text-xs text-white bg-red-600 disabled:opacity-50">
                {rejecting ? "Rejecting…" : "Reject withdrawal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
