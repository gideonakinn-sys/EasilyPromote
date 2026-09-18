"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, isAuthenticated } from "../../lib/api";

interface ActivityEntry {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string | null; role: string | null };
}

const TARGET_FILTERS = [
  { value: "", label: "All" },
  { value: "campaign", label: "Campaigns" },
  { value: "user", label: "Users" },
  { value: "withdrawal", label: "Withdrawals" },
  { value: "referral_code", label: "Referral codes" },
  { value: "webhook_key", label: "Signing keys" },
  { value: "conversion", label: "Conversions" },
  { value: "ops_alert", label: "Alerts" },
  { value: "price_table", label: "Price table" },
  { value: "rating", label: "Ratings" },
];

const ACTION_LABELS: Record<string, string> = {
  "campaign.status_changed": "Changed campaign status",
  "user.activated": "Activated user",
  "user.deactivated": "Deactivated user",
  "withdrawal.approved": "Approved withdrawal",
  "withdrawal.rejected": "Rejected withdrawal",
  "referral_code.disabled": "Disabled referral code",
  "referral_code.enabled": "Re-enabled referral code",
  "webhook_key.revoked": "Revoked signing key",
  "conversion.voided": "Voided conversion",
  "ops_alert.resolved": "Resolved alert",
  "pricing.view_tiers_updated": "Changed per-view price table",
  "rating.hidden": "Hid brand rating",
  "rating.unhidden": "Unhid brand rating",
  "creator.badge_granted": "Granted badge",
  "creator.badge_revoked": "Revoked badge",
  "creator.badge_override_cleared": "Returned badge to automatic",
};

const ACTION_TONES: Record<string, string> = {
  "user.deactivated": "bg-red-100 text-red-800",
  "withdrawal.rejected": "bg-red-100 text-red-800",
  "referral_code.disabled": "bg-red-100 text-red-800",
  "webhook_key.revoked": "bg-red-100 text-red-800",
  "conversion.voided": "bg-red-100 text-red-800",
  "rating.hidden": "bg-red-100 text-red-800",
  "creator.badge_revoked": "bg-red-100 text-red-800",
  "creator.badge_granted": "bg-green-100 text-green-800",
  "withdrawal.approved": "bg-green-100 text-green-800",
  "user.activated": "bg-green-100 text-green-800",
  "referral_code.enabled": "bg-green-100 text-green-800",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function describeChange(metadata: Record<string, unknown>) {
  if (metadata.from !== undefined && metadata.to !== undefined) {
    const show = (value: unknown) => (typeof value === "boolean" ? (value ? "active" : "inactive") : String(value).replace(/_/g, " "));
    return `${show(metadata.from)} → ${show(metadata.to)}`;
  }
  if (typeof metadata.amount === "number") {
    return `₦${metadata.amount.toLocaleString()}`;
  }
  return null;
}

export default function AdminActivityPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [query, setQuery] = useState({ targetType: "", q: "", page: 1 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(query.page), limit: "50" });
    if (query.targetType) params.set("targetType", query.targetType);
    if (query.q) params.set("q", query.q);
    apiRequest<{ activity: ActivityEntry[]; total: number; page: number; pages: number }>(`/admin/activity?${params}`)
      .then((data) => {
        setEntries(data.activity);
        setMeta({ total: data.total, page: data.page, pages: data.pages });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load activity"))
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <div className="min-h-screen bg-[#fafafa] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto min-w-0">
        <header className="pb-6 border-b border-neutral-200 mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Activity Log</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Every change admins make to campaigns, users, withdrawals, referral codes and signing keys — who did it, when and why.
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {TARGET_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setQuery((prev) => ({ ...prev, targetType: filter.value, page: 1 }))}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                query.targetType === filter.value ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {filter.label}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery((prev) => ({ ...prev, q: search.trim(), page: 1 }));
            }}
            className="flex gap-2 ml-auto"
          >
            <label htmlFor="activity-search" className="sr-only">
              Search activity
            </label>
            <input
              id="activity-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search admin, target or note"
              className="w-64 max-w-full border border-neutral-200 rounded-full px-4 py-2 text-xs text-neutral-700 outline-none focus:border-neutral-400 bg-white"
            />
            <button type="submit" className="px-4 py-2 rounded-full text-xs font-semibold bg-neutral-900 text-white">
              Search
            </button>
          </form>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <div className="bg-white border border-neutral-200/90 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-xs text-neutral-700">
              <thead className="bg-neutral-50 border-b border-neutral-200 font-bold uppercase tracking-wider text-[10px] text-neutral-500">
                <tr>
                  <th className="px-6 py-4">When</th>
                  <th className="px-6 py-4">Admin</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Target</th>
                  <th className="px-6 py-4">Change</th>
                  <th className="px-6 py-4">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading || entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-neutral-400">
                      {loading ? "Loading…" : "No admin activity recorded yet."}
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="px-6 py-4 text-neutral-500 whitespace-nowrap">{formatDateTime(entry.createdAt)}</td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-neutral-800">{entry.actor.name || "Unknown admin"}</p>
                        <p className="text-[10px] text-neutral-400 font-mono">{entry.actor.role?.replace(/_/g, " ")}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono whitespace-nowrap ${ACTION_TONES[entry.action] || "bg-neutral-100 text-neutral-700"}`}>
                          {ACTION_LABELS[entry.action] || entry.action}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-semibold text-neutral-800 break-words min-w-[140px]">{entry.targetLabel || entry.targetId}</p>
                        <p className="text-[10px] text-neutral-400">{entry.targetType.replace(/_/g, " ")}</p>
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">{describeChange(entry.metadata) || "—"}</td>
                      <td className="px-6 py-4 text-neutral-600 min-w-[240px] max-w-sm break-words">{entry.note || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {meta.pages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-200 text-xs text-neutral-500">
              <span>
                Page {meta.page} of {meta.pages} · {meta.total.toLocaleString()} entries
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setQuery((prev) => ({ ...prev, page: prev.page - 1 }))}
                  disabled={meta.page <= 1}
                  className="px-3 py-1.5 rounded-full border border-neutral-200 bg-white font-semibold disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setQuery((prev) => ({ ...prev, page: prev.page + 1 }))}
                  disabled={meta.page >= meta.pages}
                  className="px-3 py-1.5 rounded-full border border-neutral-200 bg-white font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
