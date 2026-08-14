"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getToken, isAuthenticated } from "../../lib/api";

interface CampaignItem {
  id: string;
  name: string;
  category: string;
  status: "draft" | "pending_payment" | "under_review" | "live" | "paused" | "completed" | "cancelled";
  budget: number;
  costPerView: number;
  creatorPool: number;
  platformFee: number;
  targetViews: number;
  viewsDelivered: number;
  progressPercent: number;
  coverImageUrl?: string;
  contentBrief?: string;
  platforms?: string[];
  contentStyle?: string[];
  niches?: string[];
  slotCount?: number;
  creatorCount?: number;
  statusNote?: string;
  createdAt: string;
  brand?: { id: string; name: string; email: string };
}

const AVAILABLE_NICHES = [
  "Music",
  "Lifestyle",
  "Tech",
  "Beauty",
  "Fashion",
  "Gaming",
  "Food",
  "Fitness",
  "Travel",
  "Comedy",
  "Education",
  "Sports",
  "Photography",
  "Art",
  "Pets",
  "DIY",
  "Finance",
  "Health",
  "Vlogs",
  "Dance",
];

const PLATFORM_OPTIONS = ["TikTok", "Instagram", "X (Twitter)", "Facebook", "YouTube"];

const CONTENT_STYLE_PRESETS = ["Fun & Energetic", "Lifestyle", "Comedy", "Trend/Challenge"];

interface PlatformItem {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
}

interface IndustryItem {
  id: string;
  name: string;
  enabled: boolean;
}

export default function AdminCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [editCategory, setEditCategory] = useState("Music");
  const [editPlatforms, setEditPlatforms] = useState<string[]>([]);
  const [editContentStyle, setEditContentStyle] = useState<string[]>([]);
  const [editNiches, setEditNiches] = useState<string[]>([]);
  const [editSlotCount, setEditSlotCount] = useState(5);
  const [customStyleInput, setCustomStyleInput] = useState("");
  const [customNicheInput, setCustomNicheInput] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [platformOptions, setPlatformOptions] = useState<string[]>(PLATFORM_OPTIONS);
  const [industryOptions, setIndustryOptions] = useState<string[]>([]);
  const [campaignDetail, setCampaignDetail] = useState<{
    submissions: Array<{
      _id?: string;
      id?: string;
      creatorHandle: string;
      creatorId?: { name?: string; email?: string };
      status: string;
      viewsDelivered: number;
      postedPlatforms?: Array<{ platform: string; postUrl?: string; views?: number; likes?: number; comments?: number }>;
      videoUrl?: string;
      postedAt?: string;
      submittedAt?: string;
    }>;
  } | null>(null);

  const fetchPlatforms = useCallback(async () => {
    try {
      const data = await apiRequest<{ platforms: PlatformItem[] }>("/admin/platforms", {
        token: getToken() || undefined,
      });
      const enabled = (data.platforms || [])
        .filter((p) => p.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => p.name);
      if (enabled.length > 0) setPlatformOptions(enabled);
    } catch {
      setPlatformOptions(PLATFORM_OPTIONS);
    }
  }, []);

  const fetchIndustries = useCallback(async () => {
    try {
      const data = await apiRequest<{ industries: IndustryItem[] }>("/admin/industries", {
        token: getToken() || undefined,
      });
      const enabled = (data.industries || [])
        .filter((i) => i.enabled)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => i.name);
      if (enabled.length > 0) setIndustryOptions(enabled);
    } catch {
      setIndustryOptions([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedCampaign) return;
    setEditCategory(selectedCampaign.category || industryOptions[0] || "Music");
    setEditPlatforms(selectedCampaign.platforms || []);
    setEditContentStyle(selectedCampaign.contentStyle || []);
    setEditNiches(selectedCampaign.niches || []);
    setEditSlotCount(selectedCampaign.slotCount ?? 5);
    setCustomStyleInput("");
    setCustomNicheInput("");
    setSavedMessage("");
  }, [selectedCampaign]);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (selectedStatus !== "all") query.append("status", selectedStatus);
      if (searchQuery) query.append("q", searchQuery);

      const data = await apiRequest<{ campaigns: CampaignItem[] }>(`/admin/campaigns?${query.toString()}`, {
        token: getToken() || undefined,
      });
      setCampaigns(data.campaigns || []);
    } catch {
      console.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [selectedStatus, searchQuery]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    fetchCampaigns();
    fetchPlatforms();
    fetchIndustries();
  }, [router, fetchCampaigns, fetchPlatforms, fetchIndustries]);

  const handleStatusChange = async (campaignId: string, newStatus: string) => {
    if (newStatus === "cancelled" && !statusNote.trim()) {
      alert("A reason is required to cancel a campaign.");
      return;
    }
    if (newStatus === "under_review" && !statusNote.trim()) {
      alert("A reason is required to reject a campaign.");
      return;
    }
    try {
      setActionLoading(true);
      await apiRequest(`/admin/campaigns/${campaignId}/status`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ status: newStatus, note: statusNote }),
      });
      setStatusNote("");
      setSelectedCampaign(null);
      fetchCampaigns();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update campaign status");
    } finally {
      setActionLoading(false);
    }
  };

  const fetchCampaignDetail = useCallback(async (campaignId: string) => {
    try {
      const data = await apiRequest<{
        submissions: Array<{
          _id?: string;
          id?: string;
          creatorHandle: string;
          creatorId?: { name?: string; email?: string };
          status: string;
          viewsDelivered: number;
          postedPlatforms?: Array<{
            platform: string;
            postUrl?: string;
            views?: number;
            likes?: number;
            comments?: number;
          }>;
          videoUrl?: string;
          postedAt?: string;
          submittedAt?: string;
        }>;
      }>(`/admin/campaigns/${campaignId}`, {
        token: getToken() || undefined,
      });
      setCampaignDetail(data);
    } catch {
      setCampaignDetail(null);
    }
  }, []);

  const handleDeleteCampaign = async () => {
    if (!selectedCampaign) return;
    if (!window.confirm(`Delete "${selectedCampaign.name}"? This cannot be undone.`)) return;
    try {
      setActionLoading(true);
      await apiRequest(`/admin/campaigns/${selectedCampaign.id}`, {
        method: "DELETE",
        token: getToken() || undefined,
      });
      setSelectedCampaign(null);
      fetchCampaigns();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete campaign");
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(val);

  const handleSaveEdit = async () => {
    if (!selectedCampaign) return;
    try {
      setSaveLoading(true);
      const data = await apiRequest<{ success: boolean; campaign: { id: string; category: string; costPerView: number } }>(
        `/admin/campaigns/${selectedCampaign.id}`,
        {
          method: "PATCH",
          token: getToken() || undefined,
          body: JSON.stringify({
            category: editCategory,
            platforms: editPlatforms,
            contentStyle: editContentStyle,
            niches: editNiches,
            slotCount: editSlotCount,
          }),
        }
      );
      setSavedMessage("Campaign details updated.");
      setSelectedCampaign((prev) =>
        prev
          ? {
              ...prev,
              category: editCategory,
              platforms: editPlatforms,
              contentStyle: editContentStyle,
              niches: editNiches,
              slotCount: editSlotCount,
              costPerView: data.campaign.costPerView ?? prev.costPerView,
            }
          : prev
      );
      fetchCampaigns();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update campaign details");
    } finally {
      setSaveLoading(false);
    }
  };

  const toggleItem = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((i) => i !== item) : [...list, item];

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-stone-200 mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Campaign Moderation</h1>
            <p className="text-sm text-stone-500 mt-1">Review, approve, pause, or cancel platform campaigns</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search campaigns or brand..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900 w-64"
            />
          </div>
        </header>

        {/* Status Filters */}
        <div className="flex gap-2 overflow-x-auto pb-4 mb-4">
          {["all", "pending_approval", "under_review", "live", "paused", "completed", "cancelled", "draft"].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold capitalize whitespace-nowrap transition-all ${
                selectedStatus === st
                  ? "bg-stone-900 text-white shadow-sm"
                  : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
              }`}
            >
              {st === "pending_approval" ? "Pending Approval" : st.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white border border-stone-200/90 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
                <tr>
                  <th className="px-6 py-4">Campaign</th>
                  <th className="px-6 py-4">Brand</th>
                  <th className="px-6 py-4">Budget & Pool</th>
                  <th className="px-6 py-4">Creators Matched</th>
                  <th className="px-6 py-4">View Progress</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-40" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-28" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-24" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-20" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-32" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-16" /></td>
                      <td className="px-6 py-4"><div className="h-4 bg-stone-200 rounded w-12 ml-auto" /></td>
                    </tr>
                  ))
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-stone-400">
                      No campaigns found for this filter.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="px-6 py-4 font-semibold text-stone-900">
                        <div className="flex items-center gap-3">
                          {c.coverImageUrl ? (
                            <img src={c.coverImageUrl} alt="" className="w-10 h-10 rounded-xl object-cover border border-stone-200" />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-stone-100 border border-stone-200 flex items-center justify-center font-bold text-stone-400">
                              {c.name.substring(0, 1)}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-sm text-stone-900">{c.name}</p>
                            <span className="text-[10px] text-stone-400 uppercase font-mono">{c.category || "General"}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <p className="font-semibold text-stone-900">{c.brand?.name || "Unknown Brand"}</p>
                        <p className="text-[11px] text-stone-400">{c.brand?.email}</p>
                      </td>

                      <td className="px-6 py-4">
                        <p className="font-bold text-stone-900">{formatCurrency(c.budget)}</p>
                        <p className="text-[11px] text-stone-500">Creator Pool: {formatCurrency(c.creatorPool)}</p>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            (c.creatorCount ?? 0) > 0
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-stone-100 text-stone-400"
                          }`}
                        >
                          {c.creatorCount ?? 0} creators
                        </span>
                        <p className="text-[10px] text-stone-400 mt-1">{c.category || "General"} niche</p>
                      </td>

                      <td className="px-6 py-4">
                        <div className="w-36">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-stone-700 mb-1">
                            <span>{c.viewsDelivered.toLocaleString()}</span>
                            <span className="text-stone-400">/ {c.targetViews.toLocaleString()}</span>
                          </div>
                          <div className="w-full bg-stone-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-[#FEB604] h-1.5 rounded-full transition-all"
                              style={{ width: `${c.progressPercent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider font-mono ${
                            c.status === "live"
                              ? "bg-green-100 text-green-800"
                              : c.status === "under_review"
                              ? "bg-amber-100 text-amber-800 animate-pulse"
                              : c.status === "paused"
                              ? "bg-yellow-100 text-yellow-800"
                              : c.status === "completed"
                              ? "bg-blue-100 text-blue-800"
                              : c.status === "cancelled"
                              ? "bg-red-100 text-red-800"
                              : "bg-stone-100 text-stone-600"
                          }`}
                        >
                          {c.status.replace("_", " ")}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedCampaign(c);
                            fetchCampaignDetail(c.id);
                          }}
                          className="px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-sm transition-all"
                        >
                          Inspect & Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Campaign Detail Modal */}
        {selectedCampaign && (
          <div className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-stone-200 font-rethink">
              <div className="flex items-center justify-between pb-4 border-b border-stone-200 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-stone-900">{selectedCampaign.name}</h3>
                  <p className="text-xs text-stone-500">Brand: {selectedCampaign.brand?.name} ({selectedCampaign.brand?.email})</p>
                </div>
                <button
                  onClick={() => {
                    setSelectedCampaign(null);
                    setCampaignDetail(null);
                  }}
                  className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600 font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-6 text-xs text-stone-700">
                {/* Financial Summary */}
                <div className="grid grid-cols-3 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-200">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Total Budget</span>
                    <span className="text-base font-bold text-stone-900">{formatCurrency(selectedCampaign.budget)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Creator Pool (70%)</span>
                    <span className="text-base font-bold text-stone-900">{formatCurrency(selectedCampaign.creatorPool)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Platform Fee (30%)</span>
                    <span className="text-base font-bold text-stone-900">{formatCurrency(selectedCampaign.platformFee)}</span>
                  </div>
                </div>

                {/* Content Brief */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">Content Brief</h4>
                  <p className="p-4 bg-white border border-stone-200 rounded-xl leading-relaxed text-stone-800">
                    {selectedCampaign.contentBrief || "No brief specified."}
                  </p>
                </div>

                {/* Platform Metrics per Creator */}
                <div className="pt-4 border-t border-stone-200">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500">Platform Metrics</h4>
                    <span className="text-[11px] text-stone-400">
                      Total {selectedCampaign.viewsDelivered.toLocaleString()} / {selectedCampaign.targetViews.toLocaleString()} views
                    </span>
                  </div>

                  <div className="w-full bg-stone-100 rounded-full h-1.5 overflow-hidden mb-4">
                    <div
                      className="bg-[#FEB604] h-1.5 rounded-full transition-all"
                      style={{ width: `${selectedCampaign.progressPercent || 0}%` }}
                    />
                  </div>

                  {campaignDetail && campaignDetail.submissions.length > 0 ? (
                    <div className="space-y-3">
                      {campaignDetail.submissions.map((sub) => {
                        const postedPlatforms = sub.postedPlatforms || [];
                        return (
                          <div key={sub.id || sub._id || sub.creatorHandle} className="bg-stone-50 border border-stone-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <p className="text-sm font-bold text-stone-900">
                                  {sub.creatorId?.name || sub.creatorHandle || "Creator"}
                                </p>
                                <p className="text-[11px] text-stone-400">@{sub.creatorHandle} · {sub.status}</p>
                              </div>
                              <span className="text-sm font-bold text-stone-900">
                                {sub.viewsDelivered.toLocaleString()} views
                              </span>
                            </div>

                            {postedPlatforms.length === 0 ? (
                              <p className="text-[11px] text-stone-400">No platform links yet.</p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {postedPlatforms.map((pp) => (
                                  <div
                                    key={pp.platform}
                                    className="bg-white border border-stone-200 rounded-lg px-3 py-2"
                                  >
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400 mb-1">
                                      {pp.platform}
                                    </p>
                                    <div className="flex gap-3 text-xs font-semibold text-stone-700">
                                      <span>{pp.views || 0} views</span>
                                      <span>{pp.likes || 0} likes</span>
                                      <span>{pp.comments || 0} comments</span>
                                    </div>
                                    {pp.postUrl && (
                                      <a
                                        href={pp.postUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] text-blue-600 hover:underline mt-1 block truncate"
                                      >
                                        {pp.postUrl}
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-stone-400">
                      {campaignDetail ? "No submissions yet." : "Loading submissions..."}
                    </p>
                  )}
                </div>

                {/* Target Platforms */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">Platforms</h4>
                  <div className="flex gap-2 flex-wrap">
                    {(editPlatforms.length > 0 ? editPlatforms : selectedCampaign.platforms || ["TikTok", "Instagram"]).map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-stone-100 border border-stone-200 rounded-full font-semibold text-stone-700"
                      >
                        {p}
                        <button
                          type="button"
                          onClick={() => setEditPlatforms((prev) => prev.filter((x) => x !== p))}
                          aria-label={`Remove ${p}`}
                          className="text-stone-400 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <div className="flex items-center gap-1">
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value && !editPlatforms.includes(e.target.value)) {
                            setEditPlatforms((prev) => [...prev, e.target.value]);
                          }
                          e.target.value = "";
                        }}
                        className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-600 focus:outline-none"
                      >
                        <option value="">+ Add platform</option>
                        {platformOptions
                          .filter((opt) => !editPlatforms.includes(opt))
                          .map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-2">
                    Removing a platform here also removes it from the campaign target platforms. Click "Save Campaign Updates" to persist.
                  </p>
                </div>

                {/* Edit Campaign Details */}
                <div className="pt-4 border-t border-stone-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-3">Edit Campaign Details</h4>

                  <div className="space-y-4">
                    {/* What are you promoting? */}
                    <div>
                      <label className="font-bold text-stone-700 block mb-1.5">What are you promoting?</label>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 bg-white"
                      >
                        {industryOptions.map((ind) => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>

                    {/* Number of slots */}
                    <div>
                      <label className="font-bold text-stone-700 block mb-1.5">
                        Number of slots
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={editSlotCount}
                        onChange={(e) => setEditSlotCount(Number(e.target.value))}
                        className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 bg-white"
                      />
                      <p className="text-xs text-stone-500 mt-1">
                        Each slot splits target views and creator pool equally. Available slots
                        are rebuilt to this count on save.
                      </p>
                    </div>

                    {/* Content styles */}
                    <div>
                      <label className="font-bold text-stone-700 block mb-1.5">Preferred content styles</label>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={customStyleInput}
                          onChange={(e) => setCustomStyleInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && customStyleInput.trim()) {
                              e.preventDefault();
                              setEditContentStyle((prev) =>
                                prev.includes(customStyleInput.trim()) ? prev : [...prev, customStyleInput.trim()]
                              );
                              setCustomStyleInput("");
                            }
                          }}
                          placeholder="Add a custom style..."
                          className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (customStyleInput.trim()) {
                              setEditContentStyle((prev) =>
                                prev.includes(customStyleInput.trim()) ? prev : [...prev, customStyleInput.trim()]
                              );
                              setCustomStyleInput("");
                            }
                          }}
                          className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold"
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {CONTENT_STYLE_PRESETS.map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => setEditContentStyle((prev) => toggleItem(prev, style))}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                              editContentStyle.includes(style)
                                ? "bg-stone-900 text-white"
                                : "bg-stone-100 text-stone-600 border border-stone-200"
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                        {editContentStyle
                          .filter((s) => !CONTENT_STYLE_PRESETS.includes(s))
                          .map((style) => (
                            <span
                              key={style}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-stone-900 text-white text-xs font-semibold"
                            >
                              {style}
                              <button
                                type="button"
                                onClick={() => setEditContentStyle((prev) => prev.filter((s) => s !== style))}
                                aria-label={`Remove ${style}`}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                      </div>
                    </div>

                    {/* Niches */}
                    <div>
                      <label className="font-bold text-stone-700 block mb-1.5">Target niches</label>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={customNicheInput}
                          onChange={(e) => setCustomNicheInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && customNicheInput.trim()) {
                              e.preventDefault();
                              setEditNiches((prev) =>
                                prev.includes(customNicheInput.trim()) ? prev : [...prev, customNicheInput.trim()]
                              );
                              setCustomNicheInput("");
                            }
                          }}
                          placeholder="Add a custom niche..."
                          className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-stone-900"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (customNicheInput.trim()) {
                              setEditNiches((prev) =>
                                prev.includes(customNicheInput.trim()) ? prev : [...prev, customNicheInput.trim()]
                              );
                              setCustomNicheInput("");
                            }
                          }}
                          className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold"
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_NICHES.map((niche) => (
                          <button
                            key={niche}
                            type="button"
                            onClick={() => setEditNiches((prev) => toggleItem(prev, niche))}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                              editNiches.includes(niche)
                                ? "bg-stone-900 text-white"
                                : "bg-stone-100 text-stone-600 border border-stone-200"
                            }`}
                          >
                            {niche}
                          </button>
                        ))}
                        {editNiches
                          .filter((n) => !AVAILABLE_NICHES.includes(n))
                          .map((niche) => (
                            <span
                              key={niche}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-stone-900 text-white text-xs font-semibold"
                            >
                              {niche}
                              <button
                                type="button"
                                onClick={() => setEditNiches((prev) => prev.filter((n) => n !== niche))}
                                aria-label={`Remove ${niche}`}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                      </div>
                    </div>

                    {savedMessage && (
                      <p className="text-xs font-bold text-green-700">{savedMessage}</p>
                    )}

                    <button
                      onClick={handleSaveEdit}
                      disabled={saveLoading}
                      className="w-full px-4 py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                    >
                      {saveLoading ? "Saving..." : "Save Campaign Updates"}
                    </button>
                  </div>
                </div>

                {/* Moderation Actions */}
                <div className="pt-4 border-t border-stone-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-3">Admin Actions</h4>

                  {selectedCampaign.statusNote && (
                    <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block mb-1">
                        Last status note (sent to brand)
                      </span>
                      <p className="text-xs text-amber-900 font-medium leading-relaxed">{selectedCampaign.statusNote}</p>
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block mb-1">
                      Note / Reason for status change
                    </label>
                    <textarea
                      rows={2}
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="Required when rejecting or cancelling a campaign — sent to the brand..."
                      className="w-full p-3 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-stone-900 text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {selectedCampaign.status !== "live" && (
                      <button
                        onClick={() => handleStatusChange(selectedCampaign.id, "live")}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        Approve & Launch Live
                      </button>
                    )}

                    {selectedCampaign.status === "live" && (
                      <button
                        onClick={() => handleStatusChange(selectedCampaign.id, "under_review")}
                        disabled={actionLoading || !statusNote.trim()}
                        title={statusNote.trim() ? undefined : "A reason is required to reject"}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-40"
                      >
                        Reject & Send Back to Review
                      </button>
                    )}

                    {selectedCampaign.status === "live" && (
                      <button
                        onClick={() => handleStatusChange(selectedCampaign.id, "paused")}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        Pause Campaign
                      </button>
                    )}

                    {selectedCampaign.status !== "cancelled" && (
                      <button
                        onClick={() => handleStatusChange(selectedCampaign.id, "cancelled")}
                        disabled={actionLoading || !statusNote.trim()}
                        title={statusNote.trim() ? undefined : "A reason is required to cancel"}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-40"
                      >
                        Cancel Campaign
                      </button>
                    )}

                    {["draft", "pending_payment", "cancelled"].includes(selectedCampaign.status) && (
                      <button
                        onClick={handleDeleteCampaign}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-bold text-xs shadow-sm transition-all disabled:opacity-50"
                      >
                        Delete Campaign
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
