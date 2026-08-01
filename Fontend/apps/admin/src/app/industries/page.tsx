"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface IndustryItem {
  id: string;
  name: string;
  enabled: boolean;
  costPerView?: number | null;
  sortOrder: number;
  creatorCount?: number;
}

export default function AdminIndustriesPage() {
  const router = useRouter();
  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [costPerView, setCostPerView] = useState("");
  const [editingRate, setEditingRate] = useState<Record<string, string>>({});
  const [addLoading, setAddLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchIndustries = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest<{ industries: IndustryItem[] }>("/admin/industries", {
        token: getToken() || undefined,
      });
      setIndustries(data.industries || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load industries");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchIndustries();
  }, [router, fetchIndustries]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      setAddLoading(true);
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>("/admin/industries", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({
          name: name.trim(),
          sortOrder,
          costPerView: costPerView === "" ? null : Number(costPerView),
        }),
      });
      setName("");
      setSortOrder(0);
      setCostPerView("");
      setMessage("Industry added.");
      fetchIndustries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add industry");
    } finally {
      setAddLoading(false);
    }
  };

  const handleToggle = async (industry: IndustryItem) => {
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/industries/${industry.id}`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ enabled: !industry.enabled }),
      });
      fetchIndustries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update industry");
    }
  };

  const handleSaveRate = async (industry: IndustryItem) => {
    const raw = editingRate[industry.id] ?? "";
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/industries/${industry.id}`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ costPerView: raw === "" ? null : Number(raw) }),
      });
      setMessage(`Rate for "${industry.name}" updated.`);
      fetchIndustries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update rate");
    }
  };

  const handleDelete = async (industry: IndustryItem) => {
    if (!window.confirm(`Delete industry "${industry.name}"?`)) return;
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/industries/${industry.id}`, {
        method: "DELETE",
        token: getToken() || undefined,
      });
      setMessage(`Industry "${industry.name}" deleted.`);
      fetchIndustries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete industry");
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Industry Management</h1>
          <p className="text-sm text-stone-500 mt-1">Manage the industries available to brands at signup</p>
        </header>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-6 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-xs font-semibold text-green-700">
            {message}
          </div>
        )}

        {/* Add Industry */}
        <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm mb-8">
          <h3 className="text-sm font-bold text-stone-900 mb-4">Add New Industry</h3>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="Industry name (e.g. Technology, Fashion, Finance)"
              className="flex-1 px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
            />
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              placeholder="Order"
              className="w-24 px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              value={costPerView}
              onChange={(e) => setCostPerView(e.target.value)}
              placeholder="Amount per view (₦)"
              className="w-40 px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
            />
            <button
              onClick={handleAdd}
              disabled={addLoading || !name.trim()}
              className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              {addLoading ? "Adding..." : "Add Industry"}
            </button>
          </div>
        </div>

        {/* Industry List */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
                <tr>
                  <th className="px-6 py-4">Industry</th>
                  <th className="px-6 py-4">Amount per view</th>
                  <th className="px-6 py-4">Creators</th>
                  <th className="px-6 py-4">Order</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-40" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-12" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24 ml-auto" /></td>
                    </tr>
                  ))
                ) : industries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-stone-400">
                      No industries yet. Add your first industry above.
                    </td>
                  </tr>
                ) : (
                  industries.map((i) => (
                    <tr key={i.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="px-6 py-4 font-bold text-stone-900">{i.name}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={editingRate[i.id] ?? (i.costPerView ? String(i.costPerView) : "")}
                            onChange={(e) =>
                              setEditingRate((prev) => ({ ...prev, [i.id]: e.target.value }))
                            }
                            onBlur={() => handleSaveRate(i)}
                            placeholder="—"
                            className="w-24 px-2.5 py-1.5 bg-white border border-stone-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
                          />
                          <span className="text-stone-400 text-[11px]">₦/view</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-stone-600">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-stone-100 text-stone-700 font-semibold">
                          {i.creatorCount ?? 0} creators
                        </span>
                      </td>
                      <td className="px-6 py-4 text-stone-500 font-mono">{i.sortOrder}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider font-mono ${
                            i.enabled ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {i.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggle(i)}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
                              i.enabled
                                ? "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                : "bg-stone-900 text-white hover:bg-stone-800"
                            }`}
                          >
                            {i.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => handleDelete(i)}
                            className="px-3.5 py-1.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-semibold transition-all"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
