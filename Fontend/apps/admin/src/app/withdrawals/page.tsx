"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface WithdrawalItem {
  id: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string | null;
  brandName: string;
  creatorId: string;
  creatorName: string;
  amount: number;
  status: "pending" | "rejected" | "released";
  adminNotes?: string | null;
  targetViews: number | null;
  viewsDelivered: number;
  escrowBalance: number;
  requestedAt: string;
  reviewedAt?: string | null;
  releasedAt?: string | null;
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "released", label: "Released" },
  { value: "rejected", label: "Rejected" },
];

export default function AdminWithdrawalsPage() {
  const router = useRouter();
  const [withdrawals, setWithdrawals] = useState<WithdrawalItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const fetchWithdrawals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest<{ withdrawals: WithdrawalItem[]; pendingCount: number }>(
        `/admin/withdrawals?status=${filter}`,
        { token: getToken() || undefined }
      );
      setWithdrawals(data.withdrawals || []);
      setPendingCount(data.pendingCount || 0);
    } catch {
      console.error("Failed to load withdrawals");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchWithdrawals();
  }, [router, fetchWithdrawals]);

  const review = async (id: string, approve: boolean) => {
    setActing(id);
    try {
      await apiRequest(`/admin/withdrawals/${id}/review`, {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ approve, note: note[id] || undefined }),
      });
      fetchWithdrawals();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActing(null);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

  const hitTarget = (w: WithdrawalItem) => w.viewsDelivered >= (w.targetViews || 0);

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Withdrawal Requests</h1>
          <p className="text-sm text-stone-500 mt-1">
            Review creator withdrawals against their campaign targets, then release funds from the campaign's escrow.
          </p>
        </header>

        <div className="bg-white border border-stone-200/90 rounded-2xl p-5 mb-6">
          <span className="text-xs font-semibold text-stone-500 block mb-1">Pending Requests</span>
          <span className="text-2xl font-bold text-amber-600">{pendingCount}</span>
        </div>

        <div className="mb-6 flex gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilter(s.value)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                filter === s.value
                  ? "bg-stone-900 text-white"
                  : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden">
          <div className="p-4 bg-stone-50 border-b border-stone-200">
            <h3 className="font-bold text-sm text-stone-900">Requests</h3>
          </div>

          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-4">Creator</th>
                <th className="px-6 py-4">Campaign</th>
                <th className="px-6 py-4">Brand Owner</th>
                <th className="px-6 py-4">Views vs Target</th>
                <th className="px-6 py-4">Escrow</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-28" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-36" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-28" /></td>
                  </tr>
                ))
              ) : withdrawals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-stone-400">
                    No withdrawal requests found.
                  </td>
                </tr>
              ) : (
                withdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-stone-50/80 transition-colors align-top">
                    <td className="px-6 py-4 font-semibold text-stone-800">{w.creatorName}</td>

                    <td className="px-6 py-4">
                      <p className="font-semibold text-stone-800">{w.campaignName}</p>
                      <p className="text-[10px] text-stone-400 uppercase mt-0.5">{w.campaignStatus}</p>
                    </td>

                    <td className="px-6 py-4 text-stone-600">{w.brandName}</td>

                    <td className="px-6 py-4">
                      <span className={`font-mono ${hitTarget(w) ? "text-green-600" : "text-amber-600"}`}>
                        {w.viewsDelivered.toLocaleString()} / {(w.targetViews || 0).toLocaleString()}
                      </span>
                      {!hitTarget(w) && (
                        <p className="text-[10px] text-amber-600 mt-0.5">below target</p>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-stone-600">{formatCurrency(w.escrowBalance)}</td>

                    <td className="px-6 py-4 font-bold text-stone-900">{formatCurrency(w.amount)}</td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                        w.status === "released"
                          ? "bg-green-100 text-green-800"
                          : w.status === "rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}>
                        {w.status}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      {w.status === "pending" ? (
                        <div className="space-y-2">
                          <input
                            value={note[w.id] || ""}
                            onChange={(e) => setNote((prev) => ({ ...prev, [w.id]: e.target.value }))}
                            placeholder="Note (optional)"
                            className="w-full border border-stone-200 rounded-lg px-3 py-1.5 text-xs font-rethink text-stone-700 outline-none focus:border-stone-400"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => review(w.id, true)}
                              disabled={acting === w.id}
                              className="flex-1 py-1.5 rounded-full text-[11px] font-semibold bg-green-600 text-white disabled:opacity-50"
                            >
                              {acting === w.id ? "…" : "Approve & Release"}
                            </button>
                            <button
                              onClick={() => review(w.id, false)}
                              disabled={acting === w.id}
                              className="flex-1 py-1.5 rounded-full text-[11px] font-semibold bg-red-600 text-white disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : w.adminNotes ? (
                        <p className="text-[11px] text-stone-500">{w.adminNotes}</p>
                      ) : (
                        <span className="text-[11px] text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
