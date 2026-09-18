"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, isAuthenticated } from "../../lib/api";

// Creators' connected TikTok, Instagram and Facebook accounts, with the ones the platform stopped
// accepting (SPEC D32) flagged so support can ask the creator to reconnect.
type Platform = "tiktok" | "instagram" | "facebook";
type PlatformFilter = "all" | Platform;
type StatusFilter = "all" | "healthy" | "needs_reconnect";

interface ConnectionRow {
  id: string;
  creator: { id: string; name: string; email: string; avatar: string | null; verified: boolean };
  platform: Platform;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  handle: string | null;
  followers: number | null;
  followersSource: "api" | "self_reported" | null;
  followersSyncedAt: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  needsReconnect: boolean;
  needsReconnectAt: string | null;
  needsReconnectReason: string | null;
}

interface Totals {
  connectedCreators: number;
  tiktok: number;
  instagram: number;
  facebook: number;
  needsReconnect: number;
}

interface ConnectionsResponse {
  connections: ConnectionRow[];
  totals: Totals;
  total: number;
  page: number;
  pages: number;
}

const PLATFORM_LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };

const PLATFORM_STYLE: Record<Platform, string> = {
  tiktok: "bg-neutral-900 text-white border-neutral-900",
  instagram: "bg-pink-50 text-pink-700 border-pink-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
};

const PLATFORM_FILTERS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "All Platforms" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Any Status" },
  { value: "healthy", label: "Healthy" },
  { value: "needs_reconnect", label: "Needs Reconnecting" },
];

const PAGE_SIZE = 25;

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

const compact = (n: number) => new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export default function SocialConnectionsPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Search after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ platform, status, page: String(page), limit: String(PAGE_SIZE) });
      if (query) params.set("q", query);
      setData(await apiRequest<ConnectionsResponse>(`/admin/social-connections?${params.toString()}`));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load social connections");
    } finally {
      setLoading(false);
    }
  }, [platform, status, query, page]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    load();
  }, [router, load]);

  const totals = data?.totals;
  const rows = data?.connections || [];
  const cards: Array<{ label: string; value: number | undefined; tone?: string; onClick?: () => void }> = [
    { label: "Connected Creators", value: totals?.connectedCreators },
    { label: "TikTok", value: totals?.tiktok, onClick: () => { setPlatform("tiktok"); setPage(1); } },
    { label: "Instagram", value: totals?.instagram, onClick: () => { setPlatform("instagram"); setPage(1); } },
    { label: "Facebook", value: totals?.facebook, onClick: () => { setPlatform("facebook"); setPage(1); } },
    {
      label: "Needs Reconnecting",
      value: totals?.needsReconnect,
      tone: totals && totals.needsReconnect > 0 ? "text-amber-700" : undefined,
      onClick: () => { setStatus("needs_reconnect"); setPage(1); },
    },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-neutral-200 mb-6 space-y-1">
          <h1 className="text-2xl font-medium text-neutral-900 tracking-tight">Social Connections</h1>
          <p className="text-sm text-neutral-500 font-medium">
            Every TikTok, Instagram and Facebook account creators have connected. A connection the platform stopped accepting needs the creator to
            reconnect before its views sync again.
          </p>
        </header>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {cards.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              disabled={!card.onClick}
              className="text-left bg-white border border-neutral-200 rounded-2xl p-4 enabled:hover:border-neutral-300 transition-colors"
            >
              <p className="text-[11px] font-medium text-neutral-500">{card.label}</p>
              <p className={`mt-1 text-2xl font-medium tabular-nums ${card.tone || "text-neutral-900"}`}>
                {card.value === undefined ? <span className="inline-block h-6 w-10 bg-neutral-200 rounded animate-pulse" /> : card.value}
              </p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {PLATFORM_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => { setPlatform(f.value); setPage(1); }}
              className={`px-4 py-2 rounded-full text-xs font-semibold border ${
                platform === f.value ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"
              }`}
            >
              {f.label}
            </button>
          ))}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}
            className="px-4 py-2 rounded-full text-xs font-semibold border border-neutral-200 bg-white text-neutral-600 focus:outline-none"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, email or handle"
            className="ml-auto w-full sm:w-72 px-4 py-2 rounded-full text-xs font-medium border border-neutral-200 bg-white text-neutral-700 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400"
          />
        </div>

        {error && (
          <div className="mb-5 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-700 flex items-center justify-between gap-3">
            <p className="text-xs font-medium">{error}</p>
            <button type="button" onClick={load} className="px-3.5 py-1.5 border border-red-300 rounded-full font-semibold text-[11px]">
              Try Again
            </button>
          </div>
        )}

        <div className="bg-white border border-neutral-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left text-xs text-neutral-700">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-[11px] text-neutral-500 font-medium">
              <tr>
                <th className="px-5 py-3 font-medium">Creator</th>
                <th className="px-5 py-3 font-medium">Platform</th>
                <th className="px-5 py-3 font-medium">Handle</th>
                <th className="px-5 py-3 font-medium">Followers</th>
                <th className="px-5 py-3 font-medium">Connected</th>
                <th className="px-5 py-3 font-medium">Last Synced</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Creator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-neutral-200 rounded w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-neutral-400 font-medium">
                    {query || platform !== "all" || status !== "all"
                      ? "No connected accounts match these filters."
                      : "No creator has connected a social account yet."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const avatar = row.creator.avatar || row.avatarUrl;
                  const handle = row.username || row.handle;
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover border border-neutral-200 flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-[#FEB604]/20 text-neutral-800 border border-[#FEB604]/30 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {(row.creator.name || "?").substring(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-neutral-900 truncate flex items-center gap-1">
                              {row.creator.name}
                              {row.creator.verified && (
                                <span title="Verified creator" className="text-green-600 flex-shrink-0">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-neutral-400 font-medium truncate">{row.creator.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full border text-[11px] font-medium ${PLATFORM_STYLE[row.platform]}`}>
                          {PLATFORM_LABEL[row.platform] || row.platform}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium text-neutral-900">{handle ? `@${handle.replace(/^@/, "")}` : "—"}</p>
                        {row.displayName && row.displayName !== handle && (
                          <p className="text-[11px] text-neutral-400 font-medium">{row.displayName}</p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {row.followers === null ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <>
                            <p className="font-medium text-neutral-900 tabular-nums">{compact(row.followers)}</p>
                            <p className="text-[11px] text-neutral-400 font-medium">
                              {row.followersSource === "api" ? `From ${PLATFORM_LABEL[row.platform]}` : "Self-reported"}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-5 py-4 text-neutral-500 font-medium whitespace-nowrap">{shortDate(row.connectedAt)}</td>
                      <td className="px-5 py-4 text-neutral-500 font-medium whitespace-nowrap">{shortDate(row.lastSyncedAt)}</td>
                      <td className="px-5 py-4 max-w-xs">
                        {row.needsReconnect ? (
                          <>
                            <span
                              title={row.needsReconnectReason || undefined}
                              className="inline-block px-2.5 py-1 rounded-full border text-[11px] font-medium bg-amber-50 text-amber-700 border-amber-200"
                            >
                              Needs Reconnecting{row.needsReconnectAt ? ` since ${shortDate(row.needsReconnectAt)}` : ""}
                            </span>
                            {row.needsReconnectReason && (
                              <p className="mt-1.5 text-[11px] font-medium text-neutral-500">{row.needsReconnectReason}</p>
                            )}
                          </>
                        ) : (
                          <span className="inline-block px-2.5 py-1 rounded-full border text-[11px] font-medium bg-green-50 text-green-700 border-green-200">
                            Healthy
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href="/users"
                          title={`Find ${row.creator.email} in Users & Creators`}
                          className="inline-block px-3.5 py-1.5 border border-neutral-300 text-neutral-700 rounded-full font-semibold text-[11px] whitespace-nowrap"
                        >
                          Open In Users
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between mt-4 text-xs font-medium text-neutral-500">
            <span>
              Page {data.page} of {data.pages} · {data.total} accounts
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={loading || data.page <= 1}
                className="px-3.5 py-1.5 border border-neutral-200 bg-white rounded-full font-semibold text-[11px] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || data.page >= data.pages}
                className="px-3.5 py-1.5 border border-neutral-200 bg-white rounded-full font-semibold text-[11px] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
