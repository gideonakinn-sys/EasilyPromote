"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface SubmissionItem {
  id: string;
  campaignId: string;
  campaignName: string;
  creatorId: string;
  creatorName: string;
  creatorHandle: string;
  videoUrl: string;
  caption?: string;
  status: "new" | "awaiting_post" | "posted" | "verifying" | "approved" | "rejected" | "appealed";
  rejectionReason?: string;
  appealReason?: string;
  adminNotes?: string;
  confidenceScore: number;
  viewsDelivered: number;
  postedPlatforms: Array<{ platform: string; postUrl: string; views: number }>;
  submittedAt: string;
}

export default function AdminVerificationsPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      let statusParam = "all";
      if (activeTab === "pending") statusParam = "new";
      else if (activeTab === "appeals") statusParam = "appealed";
      else if (activeTab === "approved") statusParam = "awaiting_post,approved";
      else if (activeTab === "rejected") statusParam = "rejected";

      const data = await apiRequest<{ submissions: SubmissionItem[] }>(`/admin/submissions?status=${statusParam}`, {
        token: getToken() || undefined,
      });
      setSubmissions(data.submissions || []);
    } catch {
      console.error("Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchSubmissions();
  }, [router, fetchSubmissions]);

  const handleReviewSubmission = async (id: string, status: "approved" | "rejected") => {
    if (status === "rejected" && !rejectReason.trim()) {
      alert("A rejection reason is required to reject a submission.");
      return;
    }
    try {
      setActionLoading(true);
      const data = await apiRequest<{ submission?: { status?: string; rejectionReason?: string } }>(
        `/admin/submissions/${id}/review`,
        {
          method: "PATCH",
          token: getToken() || undefined,
          body: JSON.stringify({ status, rejectionReason: rejectReason, adminNotes }),
        }
      );
      const nextStatus: SubmissionItem["status"] = status === "approved" ? "awaiting_post" : "rejected";
      const nextReason = status === "rejected" ? rejectReason : undefined;
      const resolvedStatus: SubmissionItem["status"] =
        (data?.submission?.status as SubmissionItem["status"]) || nextStatus;
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, status: resolvedStatus, rejectionReason: nextReason }
            : s
        )
      );
      setSelectedSubmission(null);
      setRejectReason("");
      setAdminNotes("");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Review failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveAppeal = async (id: string, decision: "approve" | "reject") => {
    if (decision === "reject" && !adminNotes.trim()) {
      alert("A note/reason is required to uphold a rejection.");
      return;
    }
    try {
      setActionLoading(true);
      await apiRequest(`/admin/submissions/${id}/appeal`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ decision, notes: adminNotes }),
      });
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, status: decision === "approve" ? "awaiting_post" : "rejected", adminNotes: adminNotes || s.adminNotes }
            : s
        )
      );
      setSelectedSubmission(null);
      setAdminNotes("");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Appeal resolution failed");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Verifications & Creator Moderation</h1>
          <p className="text-sm text-stone-500 mt-1">Audit creator video submissions, verify metrics, and resolve appeals</p>
        </header>

        {/* Navigation Tabs */}
        <div className="flex gap-2 border-b border-stone-200 mb-6">
          {[
            { key: "pending", label: "Pending Review" },
            { key: "appeals", label: "Creator Appeals" },
            { key: "approved", label: "Approved Queue" },
            { key: "rejected", label: "Rejected Archive" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 ${
                activeTab === tab.key
                  ? "border-[#FEB604] text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Submissions List */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
              <tr>
                <th className="px-6 py-4">Creator</th>
                <th className="px-6 py-4">Campaign</th>
                <th className="px-6 py-4">Submission & Link</th>
                <th className="px-6 py-4">Confidence</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-28" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-36" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-48" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                    <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-stone-400">
                    No submissions in this queue.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-stone-50/80 transition-colors">
                    <td className="px-6 py-4 font-bold text-stone-900">
                      <div>
                        <p className="text-sm">{sub.creatorName}</p>
                        <span className="text-[11px] text-stone-400 font-mono">@{sub.creatorHandle}</span>
                      </div>
                    </td>

                    <td className="px-6 py-4 font-semibold text-stone-800">
                      {sub.campaignName}
                    </td>

                    <td className="px-6 py-4">
                      {sub.videoUrl || sub.postedPlatforms?.[0]?.postUrl ? (
                        <button
                          onClick={() => setPreviewUrl(sub.videoUrl || sub.postedPlatforms?.[0]?.postUrl || null)}
                          className="inline-flex items-center gap-1.5 text-blue-600 hover:underline font-semibold"
                        >
                          <span>▶ View Submission Link</span>
                        </button>
                      ) : (
                        <span className="text-stone-400 italic">No link provided</span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-mono ${
                        sub.confidenceScore >= 90
                          ? "bg-green-100 text-green-800"
                          : sub.confidenceScore >= 80
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                      }`}>
                        {sub.confidenceScore || 100}% Confidence
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono ${
                        sub.status === "appealed"
                          ? "bg-red-100 text-red-800 animate-bounce"
                          : sub.status === "approved" || sub.status === "posted" || sub.status === "awaiting_post"
                          ? "bg-green-100 text-green-800"
                          : sub.status === "rejected"
                          ? "bg-stone-200 text-stone-700"
                          : "bg-amber-100 text-amber-800"
                      }`}>
                        {sub.status}
                      </span>
                      {sub.status === "rejected" && sub.rejectionReason && (
                        <p className="mt-1 text-[11px] text-red-700 max-w-[220px] leading-snug">
                          {sub.rejectionReason}
                        </p>
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => setSelectedSubmission(sub)}
                        className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal */}
        {selectedSubmission && (
          <div className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4 font-rethink">
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-stone-200">
              <div className="flex items-center justify-between pb-4 border-b border-stone-200 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-stone-900">Submission Verification</h3>
                  <p className="text-xs text-stone-500">Creator: @{selectedSubmission.creatorHandle}</p>
                </div>
                <button
                  onClick={() => setSelectedSubmission(null)}
                  className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600 font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                  <span className="font-bold text-stone-700 block mb-1">Campaign:</span>
                  <span className="text-stone-900 text-sm font-semibold">{selectedSubmission.campaignName}</span>
                </div>

                {selectedSubmission.appealReason && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <span className="font-bold text-red-800 block mb-1">Creator Appeal Ground:</span>
                    <p className="text-red-700 leading-relaxed">{selectedSubmission.appealReason}</p>
                  </div>
                )}

                <div>
                  <label className="font-bold text-stone-700 block mb-1">Admin Notes / Feedback</label>
                  <textarea
                    rows={3}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Enter internal notes or feedback..."
                    className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900"
                  />
                </div>

                {selectedSubmission.status !== "approved" && (
                  <div>
                    <label className="font-bold text-stone-700 block mb-1">Rejection Reason (required to reject)</label>
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="e.g., Content violates brief guidelines..."
                      className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900"
                    />
                    {!rejectReason.trim() && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium">A reason is required before you can reject this submission.</p>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-stone-200 flex justify-end gap-3">
                  {selectedSubmission.status === "appealed" ? (
                    <>
                      <button
                        onClick={() => handleResolveAppeal(selectedSubmission.id, "reject")}
                        disabled={actionLoading || !adminNotes.trim()}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-40"
                      >
                        Uphold Rejection
                      </button>
                      <button
                        onClick={() => handleResolveAppeal(selectedSubmission.id, "approve")}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        Accept Appeal & Approve
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleReviewSubmission(selectedSubmission.id, "rejected")}
                        disabled={actionLoading || !rejectReason.trim()}
                        title={rejectReason.trim() ? undefined : "A rejection reason is required"}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-40"
                      >
                        Reject Submission
                      </button>
                      <button
                        onClick={() => handleReviewSubmission(selectedSubmission.id, "approved")}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        Approve Content
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Video Preview Modal */}
        {previewUrl && (
          <div
            className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4 font-rethink"
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
              <video
                src={previewUrl}
                controls
                autoPlay
                playsInline
                className="w-full max-h-[70vh] bg-black"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
