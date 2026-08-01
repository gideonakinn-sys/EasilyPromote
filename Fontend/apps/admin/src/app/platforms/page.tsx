"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface PlatformItem {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
}

export default function AdminPlatformsPage() {
  const router = useRouter();
  const [platforms, setPlatforms] = useState<PlatformItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const fetchPlatforms = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest<{ platforms: PlatformItem[] }>("/admin/platforms", {
        token: getToken() || undefined,
      });
      setPlatforms(data.platforms || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load platforms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchPlatforms();
  }, [router, fetchPlatforms]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      setAddLoading(true);
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>("/admin/platforms", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ name: name.trim() }),
      });
      setName("");
      setMessage("Platform added.");
      fetchPlatforms();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add platform");
    } finally {
      setAddLoading(false);
    }
  };

  const handleToggle = async (platform: PlatformItem) => {
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/platforms/${platform.id}`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ enabled: !platform.enabled }),
      });
      fetchPlatforms();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update platform");
    }
  };

  const handleDelete = async (platform: PlatformItem) => {
    if (!window.confirm(`Delete platform "${platform.name}"?`)) return;
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/platforms/${platform.id}`, {
        method: "DELETE",
        token: getToken() || undefined,
      });
      setMessage(`Platform "${platform.name}" deleted.`);
      fetchPlatforms();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete platform");
    }
  };

  const handleSaveEdit = async (platform: PlatformItem) => {
    const nextName = editName.trim();
    if (!nextName || nextName === platform.name) {
      setEditingId(null);
      return;
    }
    try {
      setError("");
      setMessage("");
      await apiRequest<{ success: boolean }>(`/admin/platforms/${platform.id}`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ name: nextName }),
      });
      setEditingId(null);
      setMessage(`Platform renamed to "${nextName}".`);
      fetchPlatforms();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update platform");
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Platform Management</h1>
          <p className="text-sm text-stone-500 mt-1">Manage the social platforms available to brands and creators</p>
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

        {/* Add Platform */}
        <div className="bg-white border border-stone-200/90 rounded-2xl p-6 shadow-sm mb-8">
          <h3 className="text-sm font-bold text-stone-900 mb-4">Add New Platform</h3>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="Platform name (e.g. TikTok, Instagram, YouTube)"
              className="flex-1 px-4 py-2.5 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
            />
            <button
              onClick={handleAdd}
              disabled={addLoading || !name.trim()}
              className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              {addLoading ? "Adding..." : "Add Platform"}
            </button>
          </div>
        </div>

        {/* Platform List */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
                <tr>
                  <th className="px-6 py-4">Platform</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-40" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24 ml-auto" /></td>
                    </tr>
                  ))
                ) : platforms.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-stone-400">
                        No platforms yet. Add your first platform above.
                      </td>
                    </tr>
                ) : (
                  platforms.map((p) => (
                    <tr key={p.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="px-6 py-4 font-bold text-stone-900">
                        {editingId === p.id ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(p);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                            className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
                          />
                        ) : (
                          p.name
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider font-mono ${
                            p.enabled ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {p.enabled ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {editingId === p.id ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(p)}
                                className="px-3.5 py-1.5 bg-stone-900 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3.5 py-1.5 bg-stone-100 text-stone-600 rounded-lg text-xs font-semibold transition-all"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingId(p.id);
                                  setEditName(p.name);
                                }}
                                className="px-3.5 py-1.5 bg-stone-100 text-stone-700 border border-stone-200 rounded-lg text-xs font-semibold shadow-sm transition-all"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleToggle(p)}
                                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all ${
                                  p.enabled
                                    ? "bg-stone-100 text-stone-600 hover:bg-stone-200"
                                    : "bg-stone-900 text-white hover:bg-stone-800"
                                }`}
                              >
                                {p.enabled ? "Disable" : "Enable"}
                              </button>
                              <button
                                onClick={() => handleDelete(p)}
                                className="px-3.5 py-1.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-semibold transition-all"
                              >
                                Delete
                              </button>
                            </>
                          )}
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
