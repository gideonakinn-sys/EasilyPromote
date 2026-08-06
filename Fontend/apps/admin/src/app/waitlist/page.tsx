"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface WaitlistItem {
  id: string;
  name: string;
  email: string;
  status: "pending" | "invited";
  emailSent: boolean;
  createdAt: string;
}

export default function AdminWaitlistPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<WaitlistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (searchQuery) query.append("search", searchQuery);

      const data = await apiRequest<{ entries: WaitlistItem[]; total: number }>(
        `/waitlist?${query.toString()}`,
        { token: getToken() || undefined }
      );
      setEntries(data.entries || []);
    } catch {
      console.error("Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchEntries();
  }, [router, fetchEntries]);

  const formatDate = (value: string) => {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-stone-200 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Waitlist</h1>
            <p className="text-sm text-stone-500 mt-1">Browse everyone who has signed up for early access</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold text-stone-600">
              {entries.length} total
            </span>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900 w-64"
            />
          </div>
        </header>

        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Email Sent</th>
                <th className="px-6 py-4">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-36" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-48" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20" /></td>
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-stone-400">
                    No waitlist signups found.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-stone-900">{e.name}</td>
                    <td className="px-6 py-4 text-stone-600">{e.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                          e.status === "invited"
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                          e.emailSent
                            ? "bg-green-100 text-green-800"
                            : "bg-stone-200 text-stone-700"
                        }`}
                      >
                        {e.emailSent ? "Sent" : "No"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-stone-600">{formatDate(e.createdAt)}</td>
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