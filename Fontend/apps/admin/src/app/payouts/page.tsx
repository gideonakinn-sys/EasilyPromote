"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface TransactionItem {
  id: string;
  campaignName: string;
  creatorHandle: string;
  type: "escrow_deposit" | "release" | "refund" | "topup";
  amount: number;
  status: "escrow_deposit" | "released" | "refunded" | "failed";
  views?: number;
  date: string;
}

interface FinancialSummary {
  escrowDeposited: number;
  releasedPayouts: number;
  refunds: number;
}

export default function AdminPayoutsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [summary, setSummary] = useState<FinancialSummary>({ escrowDeposited: 0, releasedPayouts: 0, refunds: 0 });
  const [loading, setLoading] = useState(true);

  const fetchPayouts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest<{ transactions: TransactionItem[]; summary: FinancialSummary }>("/admin/payouts", {
        token: getToken() || undefined,
      });
      setTransactions(data.transactions || []);
      if (data.summary) setSummary(data.summary);
    } catch {
      console.error("Failed to load payout transactions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchPayouts();
  }, [router, fetchPayouts]);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Payouts & Escrow Ledger</h1>
          <p className="text-sm text-stone-500 mt-1">Audit escrow fund deposits, creator payouts, and financial transactions</p>
        </header>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Total Escrow Deposited</span>
            <span className="text-2xl font-bold text-stone-900">{formatCurrency(summary.escrowDeposited)}</span>
          </div>

          <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Released Creator Payouts</span>
            <span className="text-2xl font-bold text-green-600">{formatCurrency(summary.releasedPayouts)}</span>
          </div>

          <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider block mb-1">Brand Refunds Issued</span>
            <span className="text-2xl font-bold text-stone-900">{formatCurrency(summary.refunds)}</span>
          </div>
        </div>

        {/* Transaction History Table */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-bold text-sm text-stone-900">Transaction History</h3>
            <span className="text-xs text-stone-500 font-mono">Immutable Financial Ledger</span>
          </div>

          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-4">Transaction Type</th>
                <th className="px-6 py-4">Campaign / Reference</th>
                <th className="px-6 py-4">Recipient / Party</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
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
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24" /></td>
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400">
                    No financial transactions recorded yet.
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-stone-900 capitalize">
                      {tx.type.replace("_", " ")}
                    </td>

                    <td className="px-6 py-4 font-semibold text-stone-800">
                      {tx.campaignName}
                    </td>

                    <td className="px-6 py-4 font-mono text-stone-600">
                      {tx.creatorHandle}
                    </td>

                    <td className="px-6 py-4 font-bold text-stone-900">
                      {formatCurrency(tx.amount)}
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                        tx.status === "released"
                          ? "bg-green-100 text-green-800"
                          : tx.status === "escrow_deposit"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-800"
                      }`}>
                        {tx.status}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-stone-500 font-mono text-[11px]">
                      {new Date(tx.date).toLocaleDateString()}
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
