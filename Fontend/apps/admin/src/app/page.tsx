"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "../components/sidebar";
import { NeedsAttention } from "../components/needs-attention";
import { apiRequest, getToken, isAuthenticated } from "../lib/api";

interface StatsData {
  brands: number;
  creators: number;
  admins: number;
  campaigns: {
    total: number;
    under_review: number;
    live: number;
    draft: number;
    paused: number;
    completed: number;
    cancelled: number;
    pending_payment: number;
  };
  totalEscrowed: number;
  totalReleased: number;
  pendingVerifications: number;
  openAppeals: number;
  autoRefundsEnabled?: boolean;
  recentUsers: Array<{
    _id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    isActive: boolean;
  }>;
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [alertsRefreshKey, setAlertsRefreshKey] = useState(0);
  const [authed, setAuthed] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest<StatsData>("/admin/stats", {
        token: getToken() || undefined,
      });
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    setAuthed(true);
    fetchStats();
  }, [router, fetchStats]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-stone-200 mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Marketplace Overview</h1>
            <p className="text-sm text-stone-500 mt-1">Real-time stats, escrow status, and system operations</p>
          </div>
          <button
            onClick={() => {
              fetchStats();
              setAlertsRefreshKey((key) => key + 1);
            }}
            className="self-start md:self-auto px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm transition-all"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh Metrics
          </button>
        </header>

        {error && (
          <div className="p-4 mb-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {authed && <NeedsAttention refreshKey={alertsRefreshKey} />}

        {stats && stats.autoRefundsEnabled === false && (
          <Link href="/refunds" className="block mb-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-800">
            <span className="block text-sm font-semibold">Automatic Refunds Are Off</span>
            <span className="block text-xs mt-1">
              Unused budget on ended campaigns is only refunded by hand until AUTO_REFUNDS_ENABLED is set to true. Open Refunds →
            </span>
          </Link>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white border border-stone-200 rounded-2xl p-6 animate-pulse h-32" />
            ))}
          </div>
        ) : stats ? (
          <>
            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between text-stone-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Active Escrow</span>
                  <span className="p-2 rounded-xl bg-amber-50 text-[#FEB604]">💰</span>
                </div>
                <div className="text-2xl font-bold text-stone-900">{formatCurrency(stats.totalEscrowed)}</div>
                <div className="mt-2 text-xs text-stone-500">Live & under-review campaigns</div>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between text-stone-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Live Campaigns</span>
                  <span className="p-2 rounded-xl bg-green-50 text-green-600">🚀</span>
                </div>
                <div className="text-2xl font-bold text-stone-900">{stats.campaigns.live}</div>
                <div className="mt-2 text-xs text-stone-500">{stats.campaigns.total} total campaigns created</div>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between text-stone-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Pending Verifications</span>
                  <span className="p-2 rounded-xl bg-blue-50 text-blue-600">🔍</span>
                </div>
                <div className="text-2xl font-bold text-stone-900">{stats.pendingVerifications}</div>
                <div className="mt-2 text-xs text-stone-500">{stats.openAppeals} open creator appeals</div>
              </div>

              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between text-stone-500 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Registered Users</span>
                  <span className="p-2 rounded-xl bg-purple-50 text-purple-600">👥</span>
                </div>
                <div className="text-2xl font-bold text-stone-900">{stats.brands + stats.creators}</div>
                <div className="mt-2 text-xs text-stone-500">{stats.brands} Brands · {stats.creators} Creators</div>
              </div>
            </div>

            {/* Middle Grid: Campaign Breakdown & Urgent Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Campaign Lifecycle Card */}
              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm">
                <h3 className="text-base font-bold text-stone-900 mb-4 flex items-center justify-between">
                  <span>Campaign Lifecycle</span>
                  <Link href="/campaigns" className="text-xs text-[#FEB604] hover:underline font-semibold">View All →</Link>
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 border border-amber-100">
                    <span className="text-xs font-semibold text-stone-700">Under Review</span>
                    <span className="px-2.5 py-1 text-xs font-bold bg-amber-100 text-amber-800 rounded-full">{stats.campaigns.under_review}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-green-50/50 border border-green-100">
                    <span className="text-xs font-semibold text-stone-700">Live & Running</span>
                    <span className="px-2.5 py-1 text-xs font-bold bg-green-100 text-green-800 rounded-full">{stats.campaigns.live}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-stone-200">
                    <span className="text-xs font-semibold text-stone-700">Draft / Unfunded</span>
                    <span className="px-2.5 py-1 text-xs font-bold bg-stone-200 text-stone-700 rounded-full">{stats.campaigns.draft + stats.campaigns.pending_payment}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/50 border border-blue-100">
                    <span className="text-xs font-semibold text-stone-700">Completed</span>
                    <span className="px-2.5 py-1 text-xs font-bold bg-blue-100 text-blue-800 rounded-full">{stats.campaigns.completed}</span>
                  </div>
                </div>
              </div>

              {/* Action Quick Links */}
              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-stone-900 mb-2">Required Actions</h3>
                  <p className="text-xs text-stone-500 mb-4">Queued tasks requiring admin moderation</p>
                  
                  <div className="space-y-3">
                    <Link
                      href="/verifications"
                      className="block p-3.5 rounded-xl border border-stone-200 hover:border-stone-900 transition-all hover:shadow-sm"
                    >
                      <div className="flex items-center justify-between font-semibold text-sm text-stone-900">
                        <span>Review Submissions</span>
                        <span className="text-xs font-bold text-amber-600">{stats.pendingVerifications} Pending</span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1">Verify submitted videos & engagement metrics</p>
                    </Link>

                    <Link
                      href="/verifications?tab=appeals"
                      className="block p-3.5 rounded-xl border border-stone-200 hover:border-stone-900 transition-all hover:shadow-sm"
                    >
                      <div className="flex items-center justify-between font-semibold text-sm text-stone-900">
                        <span>Creator Appeals</span>
                        <span className="text-xs font-bold text-red-600">{stats.openAppeals} Open</span>
                      </div>
                      <p className="text-xs text-stone-500 mt-1">Resolve creator disputes on rejected posts</p>
                    </Link>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500 font-mono">
                  <span>Platform Fee Engine: 30%</span>
                  <span>Released: {formatCurrency(stats.totalReleased)}</span>
                </div>
              </div>

              {/* Recent Registrations */}
              <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm">
                <h3 className="text-base font-bold text-stone-900 mb-4 flex items-center justify-between">
                  <span>Recent User Registrations</span>
                  <Link href="/users" className="text-xs text-[#FEB604] hover:underline font-semibold">Manage Users →</Link>
                </h3>
                <div className="space-y-3">
                  {stats.recentUsers.length === 0 ? (
                    <p className="text-xs text-stone-400">No users registered yet.</p>
                  ) : (
                    stats.recentUsers.map((u) => (
                      <div key={u._id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-stone-50 transition-colors border border-stone-100">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-stone-900 truncate">{u.name}</p>
                          <p className="text-[11px] text-stone-500 truncate">{u.email}</p>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase font-mono ${
                          u.role === "business"
                            ? "bg-amber-100 text-amber-800"
                            : u.role === "creator"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-stone-200 text-stone-800"
                        }`}>
                          {u.role}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
