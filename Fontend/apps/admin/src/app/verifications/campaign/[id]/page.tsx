"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "../../../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../../../lib/api";

interface ActivityEvent {
  id: string;
  submissionId: string;
  type: string;
  label: string;
  actor: "creator" | "brand" | "admin" | "system";
  actorName?: string | null;
  creatorHandle?: string | null;
  statusAfter?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  at: string;
  ago?: string;
}

interface ActivitySubmission {
  id: string;
  creatorHandle: string;
  status: string;
  videoUrl?: string;
  caption?: string;
  confidenceScore: number;
  viewsDelivered: number;
  payoutAmount: number;
  payoutStatus: string;
  rejectionReason?: string;
  adminNotes?: string;
  postedPlatforms: Array<{ platform: string; postUrl: string; views: number }>;
  submittedAt?: string;
  reviewedAt?: string;
  postedAt?: string;
}

interface ActivityCampaign {
  id: string;
  name: string;
  status: string;
  brandName?: string | null;
  targetViews: number;
  viewsDelivered: number;
  creatorPool: number;
  createdAt: string;
}

const ACTOR_STYLES: Record<ActivityEvent["actor"], string> = {
  creator: "bg-blue-100 text-blue-800",
  brand: "bg-purple-100 text-purple-800",
  admin: "bg-amber-100 text-amber-800",
  system: "bg-stone-200 text-stone-700",
};

const NEGATIVE_TYPES = ["rejected", "appeal_rejected"];
const POSITIVE_TYPES = ["approved", "appeal_approved", "posted", "paid"];

function dotColor(type: string) {
  if (NEGATIVE_TYPES.includes(type)) return "bg-red-500";
  if (POSITIVE_TYPES.includes(type)) return "bg-green-500";
  return "bg-stone-400";
}

export default function CampaignVerificationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const campaignId = params?.id as string;

  const [campaign, setCampaign] = useState<ActivityCampaign | null>(null);
  const [submissions, setSubmissions] = useState<ActivitySubmission[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [creatorFilter, setCreatorFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    if (!campaignId) return;
    try {
      setLoading(true);
      const data = await apiRequest<{
        campaign: ActivityCampaign;
        submissions: ActivitySubmission[];
        events: ActivityEvent[];
      }>(`/admin/campaigns/${campaignId}/activity`, { token: getToken() || undefined });
      setCampaign(data.campaign);
      setSubmissions(data.submissions || []);
      setEvents(data.events || []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign activity");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchActivity();
  }, [router, fetchActivity]);

  const visibleEvents =
    creatorFilter === "all" ? events : events.filter((e) => e.submissionId === creatorFilter);

  const progress = campaign && campaign.targetViews
    ? Math.min((campaign.viewsDelivered / campaign.targetViews) * 100, 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <Link
          href="/verifications"
          className="text-xs font-bold text-stone-500 hover:text-stone-900 transition-colors"
        >
          ← Back to verifications
        </Link>

        <header className="pt-4 pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">
            {loading ? "Loading…" : campaign?.name || "Campaign"}
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            Full verification history — every action taken on this campaign, by whom, and when
          </p>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold">
            {error}
          </div>
        )}

        {campaign && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Brand" value={campaign.brandName || "—"} />
            <StatCard label="Status" value={campaign.status} mono />
            <StatCard
              label="Views delivered"
              value={`${campaign.viewsDelivered.toLocaleString()} / ${campaign.targetViews.toLocaleString()}`}
              sub={`${progress.toFixed(1)}% of target`}
            />
            <StatCard label="Creator pool" value={campaign.creatorPool.toLocaleString()} />
          </div>
        )}

        {/* Submissions on this campaign */}
        <section className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-stone-200 bg-stone-50">
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              Submissions ({submissions.length})
            </h2>
          </div>
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-3">Creator</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Video</th>
                <th className="px-6 py-3">Confidence</th>
                <th className="px-6 py-3">Views</th>
                <th className="px-6 py-3">Payout</th>
                <th className="px-6 py-3 text-right">History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-stone-400">
                    Loading…
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-stone-400">
                    No submissions on this campaign yet.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-6 py-3 font-bold text-stone-900 font-mono">@{sub.creatorHandle}</td>
                    <td className="px-6 py-3">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono bg-stone-100 text-stone-700">
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono">
                      {sub.videoUrl ? (
                        <button
                          onClick={() => setPreviewUrl(sub.videoUrl || null)}
                          className="text-blue-600 hover:underline font-semibold font-rethink"
                        >
                          ▶ Preview
                        </button>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono">{sub.confidenceScore ?? 100}%</td>
                    <td className="px-6 py-3 font-mono">{(sub.viewsDelivered || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 font-mono">
                      {(sub.payoutAmount || 0).toLocaleString()}
                      <span className="ml-1.5 text-[10px] text-stone-400">{sub.payoutStatus}</span>
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() =>
                          setCreatorFilter(creatorFilter === sub.id ? "all" : sub.id)
                        }
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                          creatorFilter === sub.id
                            ? "bg-stone-900 text-white"
                            : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                        }`}
                      >
                        {creatorFilter === sub.id ? "Showing" : "Filter feed"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* Activity feed */}
        <section className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-stone-500">
              Activity ({visibleEvents.length})
            </h2>
            {creatorFilter !== "all" && (
              <button
                onClick={() => setCreatorFilter("all")}
                className="text-[11px] font-bold text-stone-500 hover:text-stone-900"
              >
                Clear filter
              </button>
            )}
          </div>

          <div className="p-6">
            {loading ? (
              <p className="text-xs text-stone-400 text-center py-8">Loading…</p>
            ) : visibleEvents.length === 0 ? (
              <p className="text-xs text-stone-400 text-center py-8">
                No activity recorded yet. Events are captured from the moment this was deployed —
                anything that happened before then has no record.
              </p>
            ) : (
              <ol className="relative border-l border-stone-200 ml-2 space-y-6">
                {visibleEvents.map((event) => (
                  <li key={event.id} className="ml-6">
                    <span
                      className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${dotColor(event.type)}`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-stone-900">{event.label}</p>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono ${ACTOR_STYLES[event.actor]}`}
                      >
                        {event.actor}
                      </span>
                      {event.creatorHandle && (
                        <span className="text-[11px] text-stone-400 font-mono">
                          @{event.creatorHandle}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {event.actorName ? `${event.actorName} · ` : ""}
                      {event.ago} · {new Date(event.at).toLocaleString()}
                    </p>

                    {event.reason && (
                      <div className="mt-2 p-3 bg-stone-50 border border-stone-200 rounded-xl">
                        <p className="text-xs text-stone-700 leading-relaxed">{event.reason}</p>
                      </div>
                    )}

                    {event.type === "views_synced" && (
                      <p className="mt-2 text-xs font-mono text-stone-600">
                        {Number(event.metadata?.previousViews ?? 0).toLocaleString()} →{" "}
                        {Number(event.metadata?.views ?? 0).toLocaleString()} views
                        <span className="ml-2 text-green-700">
                          +{Number(event.metadata?.delta ?? 0).toLocaleString()}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {previewUrl && (
          <div
            className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <div
              className="bg-stone-950 rounded-2xl border border-stone-800 max-w-3xl w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800">
                <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                  Submission Preview
                </span>
                <button
                  onClick={() => setPreviewUrl(null)}
                  className="w-8 h-8 rounded-full bg-stone-800 hover:bg-stone-700 flex items-center justify-center text-stone-300 font-bold"
                >
                  ✕
                </button>
              </div>
              <video src={previewUrl} controls autoPlay playsInline className="w-full max-h-[70vh] bg-black" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">{label}</p>
      <p className={`text-sm font-bold text-stone-900 mt-1 ${mono ? "font-mono uppercase" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-stone-400 mt-0.5">{sub}</p>}
    </div>
  );
}
