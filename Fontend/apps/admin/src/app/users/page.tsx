"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: "business" | "creator" | "admin" | "super_admin" | "support";
  isActive: boolean;
  emailVerified: boolean;
  walletBalance: number;
  createdAt: string;
  campaignCount: number;
  submissionCount: number;
  creatorProfile?: {
    rank: string;
    creatorScore: number;
    lifetimeEarnings: number;
    socialAccounts?: Array<{ platform: string; handle: string; verified: boolean }>;
    niches?: string[];
  } | null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [rankInput, setRankInput] = useState<string>("rank1");
  const [scoreInput, setScoreInput] = useState<number>(50);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (selectedRole !== "all") query.append("role", selectedRole);
      if (searchQuery) query.append("q", searchQuery);

      const data = await apiRequest<{ users: UserItem[] }>(`/admin/users?${query.toString()}`, {
        token: getToken() || undefined,
      });
      setUsers(data.users || []);
    } catch {
      console.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [selectedRole, searchQuery]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchUsers();
  }, [router, fetchUsers]);

  const toggleUserStatus = async (id: string, currentStatus: boolean) => {
    try {
      setActionLoading(true);
      await apiRequest(`/admin/users/${id}/status`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ isActive: !currentStatus }),
      });
      fetchUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Status change failed");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteUser = async (user: UserItem) => {
    if (!window.confirm(`Delete account for "${user.name}"?\n\nThis permanently removes the user, their profile, campaigns, submissions, slots, transactions, and notifications. This cannot be undone.`)) return;
    try {
      setActionLoading(true);
      await apiRequest(`/admin/users/${user.id}`, {
        method: "DELETE",
        token: getToken() || undefined,
      });
      fetchUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveRank = async () => {
    if (!selectedUser) return;
    try {
      setActionLoading(true);
      await apiRequest(`/admin/users/${selectedUser.id}/rank`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ rank: rankInput, creatorScore: Number(scoreInput) }),
      });
      setSelectedUser(null);
      fetchUsers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update creator rank");
    } finally {
      setActionLoading(false);
    }
  };

  const openRankModal = (user: UserItem) => {
    setSelectedUser(user);
    setRankInput(user.creatorProfile?.rank || "rank1");
    setScoreInput(user.creatorProfile?.creatorScore || 50);
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-stone-200 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">User & Creator Roster</h1>
            <p className="text-sm text-stone-500 mt-1">Manage brand and creator accounts, ranks, and access control</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search user by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900 w-64"
            />
          </div>
        </header>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: "all", label: "All Users" },
            { key: "business", label: "Brands / Businesses" },
            { key: "creator", label: "Creators" },
            { key: "admin", label: "Admins" },
          ].map((roleTab) => (
            <button
              key={roleTab.key}
              onClick={() => setSelectedRole(roleTab.key)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all ${
                selectedRole === roleTab.key
                  ? "bg-stone-900 text-white shadow-sm"
                  : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
              }`}
            >
              {roleTab.label}
            </button>
          ))}
        </div>

        {/* Users Table */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Rank / Score</th>
                <th className="px-6 py-4">Activity</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-36" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-28 ml-auto" /></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400">
                    No users found matching query.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <p className="font-bold text-stone-900">{u.name}</p>
                      <p className="text-[11px] text-stone-400">{u.email}</p>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                        u.role === "business"
                          ? "bg-amber-100 text-amber-800"
                          : u.role === "creator"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-stone-200 text-stone-800"
                      }`}>
                        {u.role}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      {u.role === "creator" ? (
                        <div>
                          <span className="font-bold uppercase text-stone-900 font-mono text-[11px]">
                            {u.creatorProfile?.rank || "rank1"}
                          </span>
                          <span className="text-[11px] text-stone-400 block">Score: {u.creatorProfile?.creatorScore || 0}/100</span>
                        </div>
                      ) : (
                        <span className="text-stone-400">N/A</span>
                      )}
                    </td>

                    <td className="px-6 py-4 text-stone-600 font-medium">
                      {u.role === "business" ? (
                        <span>{u.campaignCount} Campaigns</span>
                      ) : u.role === "creator" ? (
                        <span>{u.submissionCount} Submissions</span>
                      ) : (
                        <span>System Admin</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase ${
                        u.isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}>
                        {u.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {u.role === "creator" && (
                          <button
                            onClick={() => openRankModal(u)}
                            className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-semibold transition-all"
                          >
                            Edit Rank
                          </button>
                        )}
                        <button
                          onClick={() => toggleUserStatus(u.id, u.isActive)}
                          disabled={actionLoading}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            u.isActive
                              ? "bg-red-50 text-red-700 hover:bg-red-100"
                              : "bg-green-50 text-green-700 hover:bg-green-100"
                          }`}
                        >
                          {u.isActive ? "Deactivate" : "Activate"}
                        </button>
                        {u.role !== "admin" && u.role !== "super_admin" && (
                          <button
                            onClick={() => deleteUser(u)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-lg text-xs font-semibold transition-all"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Edit Rank Modal */}
        {selectedUser && (
          <div className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4 font-rethink">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200">
              <h3 className="text-xl font-bold text-stone-900 mb-2">Update Creator Rank & Score</h3>
              <p className="text-xs text-stone-500 mb-4">Editing profile for: {selectedUser.name}</p>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="font-bold text-stone-700 block mb-1">Rank Tier</label>
                  <select
                    value={rankInput}
                    onChange={(e) => setRankInput(e.target.value)}
                    className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 bg-white font-mono"
                  >
                    <option value="rank1">Rank 1 (1K - 5K views target)</option>
                    <option value="rank2">Rank 2 (5K - 10K views target)</option>
                    <option value="rank3">Rank 3 (10K - 25K views target)</option>
                    <option value="rank4">Rank 4 (25K - 50K views target)</option>
                    <option value="rank5">Rank 5 (50K - 100K views target)</option>
                    <option value="elite">Elite (100K+ views target)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-stone-700 block mb-1">Creator Score (0 - 100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scoreInput}
                    onChange={(e) => setScoreInput(Number(e.target.value))}
                    className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </div>

                <div className="pt-4 border-t border-stone-200 flex justify-end gap-3">
                  <button
                    onClick={() => setSelectedUser(null)}
                    className="px-4 py-2 text-stone-600 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRank}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
