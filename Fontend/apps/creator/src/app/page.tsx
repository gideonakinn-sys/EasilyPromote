"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { useToast } from "@ep/ui/components/toast";
import { cn } from "@ep/ui/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { LockIcon } from "@hugeicons/core-free-icons";
import { apiRequest, getToken, getUser } from "../lib/api";
import { useCampaignUpdates, type CampaignUpdate } from "../lib/socket";
import type { CreatorProfile, ActiveTab, CampaignItem, MarketplaceCampaign, WalletData, ProfileForm, ProfileFocusSection, TikTokStatus, MetaStatus, MetaProvider } from "../components/types";
import { CreatorHeader } from "../components/creator-header";
import { OnboardingView } from "../components/onboarding-view";
import { OnboardingComplete } from "../components/onboarding-complete";
import { CampaignFeed } from "../components/campaign-feed";
import { WalletView } from "../components/wallet-view";
import { CampaignMarketplace } from "../components/campaign-marketplace";
import { ProfileView } from "../components/profile-view";
import { CampaignDetailsDrawer } from "../components/campaign-details-drawer";
import { Skeleton } from "../components/ui/skeleton";
import { useReveal } from "../hooks/use-reveal";

function CreatorDashboardContent() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  useReveal();

  const [profile, setProfile] = useState<CreatorProfile>({
    name: "",
    avatar: null,
    displayName: "",
    username: "",
    bio: "",
    country: "",
    socialAccounts: [],
    niches: [],
    rank: "rank1",
    creatorScore: 0,
    lifetimeEarnings: 0,
    completionRate: 0,
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>("home");
  const [showAllSet, setShowAllSet] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileFocus, setProfileFocus] = useState<ProfileFocusSection | null>(null);
  const [campaignsFilter, setCampaignsFilter] = useState<string>("all");
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [marketplaceCampaigns, setMarketplaceCampaigns] = useState<MarketplaceCampaign[]>([]);
  const [marketplaceMeta, setMarketplaceMeta] = useState({ activeSlots: 0, maxSlots: 3, canClaim: true, locked: false, lockReason: "" });
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [tiktokStatus, setTiktokStatus] = useState<TikTokStatus>({ connected: false });
  const [metaStatus, setMetaStatus] = useState<MetaStatus>({ instagram: { connected: false }, facebook: { connected: false } });
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: "",
    nickname: "",
    email: "",
    phone: "",
    avatarUrl: "",
  });

  const [readyPostUrl, setReadyPostUrl] = useState<Record<string, string>>({});

  const handleCampaignUpdate = (data: CampaignUpdate) => {
    const exists = campaigns.some((c) => c.id === data.campaignId);
    if (!exists) {
      fetchCampaigns();
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id !== data.campaignId) return c;
        return {
          ...c,
          status: (data.status as CampaignItem["status"]) || c.status,
          progress: data.progress ?? c.progress,
          currentViews: data.currentViews ?? c.currentViews,
          viewTarget: data.viewTarget ?? c.viewTarget,
          targetViews: data.targetViews ?? c.targetViews,
          reward: data.reward ?? c.reward,
          costPerView: data.costPerView ?? c.costPerView,
          submissionId: data.submissionId ?? c.submissionId,
          comment: data.comment,
          delivery: data.delivery ?? c.delivery,
          postedPlatforms: data.postedPlatforms ?? c.postedPlatforms,
        };
      })
    );
    if (data.status === "delivered") {
      toast("Campaign delivered — you hit your view target!", "success");
      fetchWallet();
    } else if (data.status === "cancelled") {
      toast("Campaign cancelled", "error");
      fetchWallet();
    }
  };

  useCampaignUpdates(handleCampaignUpdate);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const user = getUser();
    if (user?.role === "business") {
      window.location.href = `${window.location.protocol}//${window.location.hostname}:3002`;
      return;
    }
    if (user?.role !== "creator") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      router.push("/login");
      return;
    }

    if (user) {
      setProfile((prev) => ({
        ...prev,
        name: user.name,
        displayName: user.name,
        username: user.email.split("@")[0],
      }));
    }

    fetchAllData();

    const params = new URLSearchParams(window.location.search);
    const tiktokResult = params.get("tiktok");
    if (tiktokResult) {
      if (tiktokResult === "connected") {
        toast("TikTok connected", "success");
        fetchTikTokStatus();
        fetchProfile();
      } else if (tiktokResult === "error") {
        toast("TikTok connection failed. Please try again.", "error");
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("tiktok");
      router.replace(url.pathname + url.search, { scroll: false });
    }

    const metaResult = params.get("meta");
    if (metaResult) {
      const providerParam = params.get("meta_provider");
      const label = providerParam === "facebook" ? "Facebook" : providerParam === "instagram" ? "Instagram" : "Meta";
      if (metaResult === "connected") {
        toast(`${label} connected`, "success");
        fetchMetaStatus();
        fetchProfile();
      } else if (metaResult === "error") {
        toast(`${label} connection failed. Please try again.`, "error");
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("meta");
      url.searchParams.delete("meta_provider");
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.allSettled([
      fetchProfile(),
      fetchCampaigns(),
      fetchMarketplace(),
      fetchWallet(),
      fetchTikTokStatus(),
      fetchMetaStatus(),
    ]);
    setLoading(false);
  };

  const fetchTikTokStatus = async () => {
    try {
      const data = await apiRequest<TikTokStatus>("/tiktok/status", {
        token: getToken() || undefined,
      });
      setTiktokStatus(data);
    } catch {
      setTiktokStatus({ connected: false });
    }
  };

  const fetchMetaStatus = async () => {
    try {
      const data = await apiRequest<MetaStatus>("/meta/status", {
        token: getToken() || undefined,
      });
      setMetaStatus(data);
    } catch {
      setMetaStatus({ instagram: { connected: false }, facebook: { connected: false } });
    }
  };

  const fetchProfile = async () => {
    try {
      const data = await apiRequest<Record<string, unknown>>("/creators/profile/me", {
        token: getToken() || undefined,
      });

      const p: CreatorProfile = {
        name: data.name as string,
        avatar: (data.avatar as string) || null,
        displayName: (data.displayName as string) || (data.name as string),
        username: data.username as string,
        bio: (data.bio as string) || "",
        country: (data.country as string) || "",
        socialAccounts: (data.socialAccounts as CreatorProfile["socialAccounts"]) || [],
        niches: (data.niches as string[]) || [],
        rank: (data.rank as string) || "rank1",
        creatorScore: (data.creatorScore as number) || 0,
        lifetimeEarnings: (data.lifetimeEarnings as number) || 0,
        completionRate: (data.completionRate as number) || 0,
      };

      setProfile(p);
      const user = getUser();
      setProfileForm({
        name: p.name,
        nickname: p.displayName,
        email: user?.email || "",
        phone: user?.phone || "",
        avatarUrl: p.avatar || "",
      });
    } catch {
      console.log("Could not load profile");
    }
  };

  const fetchCampaigns = async () => {
    try {
      const data = await apiRequest<{ campaigns: Array<Record<string, unknown>> }>("/creators/slots/mine", {
        token: getToken() || undefined,
      });

      const items: CampaignItem[] = (data.campaigns || []).map((c) => ({
        id: c.id as string,
        slotId: c.slotId as string,
        title: c.title as string,
        category: c.category as string,
        coverImageUrl: c.coverImageUrl as string,
        delivery: c.delivery as string,
        status: c.status as CampaignItem["status"],
        reward: c.reward as number,
        viewTarget: c.viewTarget as number,
        minViews: c.minViews as number | undefined,
        maxViews: c.maxViews as number | undefined,
        costPerView: c.costPerView as number | undefined,
        comment: c.comment as string,
        progress: c.progress as number,
        currentViews: c.currentViews as number,
        targetViews: c.targetViews as number,
        videoUrl: c.videoUrl as string,
        caption: c.caption as string,
        videoDuration: c.videoDuration as string,
        submittedAgo: c.submittedAgo as string,
        reviewedAgo: c.reviewedAgo as string,
        postedAgo: c.postedAgo as string,
        timeline: c.timeline as CampaignItem["timeline"],
        postedPlatforms: c.postedPlatforms as Array<{ platform: string; views: number }>,
        creatorHandle: c.creatorHandle as string | undefined,
        submissionId: c.submissionId as string,
        contentBrief: c.contentBrief as string,
        description: c.description as string,
        keyMessageCta: c.keyMessageCta as string,
        whatToAvoid: c.whatToAvoid as string,
        platforms: c.platforms as string[],
        contentStyle: c.contentStyle as string[],
        brandName: c.brandName as string | undefined,
        brandAvatar: c.brandAvatar as string | undefined,
        scriptUrl: c.scriptUrl as string | undefined,
        scriptFileName: c.scriptFileName as string | undefined,
      }));

      setCampaigns(items);
    } catch {
      console.log("Could not load campaigns");
    }
  };

  const fetchMarketplace = async () => {
    try {
      const data = await apiRequest<{ campaigns: Array<Record<string, unknown>>; activeSlots: number; maxSlots: number; canClaim: boolean; locked?: boolean; lockReason?: string }>("/creators/marketplace", {
        token: getToken() || undefined,
      });

      const items: MarketplaceCampaign[] = (data.campaigns || []).map((c) => ({
        id: c.id as string,
        title: c.title as string,
        category: c.category as string,
        coverImageUrl: c.coverImageUrl as string,
        reward: c.reward as number,
        platforms: (c.platforms as string[]) || [],
        slotsLeft: c.slotsLeft as number,
        daysLeft: c.daysLeft as number,
        targetViews: c.targetViews as number,
        costPerView: c.costPerView as number,
        contentBrief: c.contentBrief as string,
        brandName: (c.brandName as string) || "Brand",
        brandAvatar: c.brandAvatar as string | undefined,
        minViews: (c.minViews as number) || 1000,
        maxViews: (c.maxViews as number) || undefined,
        viewTarget: (c.viewTarget as number) || undefined,
        description: (c.description as string) || "",
      }));

      setMarketplaceCampaigns(items);
      setMarketplaceMeta({
        activeSlots: data.activeSlots || 0,
        maxSlots: data.maxSlots || 3,
        canClaim: data.canClaim ?? true,
        locked: data.locked ?? false,
        lockReason: data.lockReason || "",
      });
    } catch {
      console.log("Could not load marketplace");
    }
  };

  const fetchWallet = async () => {
    try {
      const data = await apiRequest<WalletData>("/creators/wallet", {
        token: getToken() || undefined,
      });
      setWalletData(data);
    } catch {
      console.log("Could not load wallet");
    }
  };

  const markCompleteIfReady = (next: CreatorProfile) => {
    const complete = next.niches.length > 0 && !!next.avatar;
    if (complete && !profileComplete && !showAllSet) {
      setShowAllSet(true);
    }
  };

  const handleRemoveSocial = (platform: string) => {
    if (platform === "tiktok") {
      handleDisconnectTikTok();
      return;
    }
    if (platform === "instagram" || platform === "facebook") {
      handleDisconnectMeta(platform);
      return;
    }
    setProfile((prev) => ({
      ...prev,
      socialAccounts: prev.socialAccounts.filter((s) => s.platform !== platform),
    }));
  };

  const handleConnectTikTok = async () => {
    try {
      const data = await apiRequest<{ url: string }>("/tiktok/connect", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ returnTo: window.location.origin + window.location.pathname }),
      });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to start TikTok connect:", err);
      toast("Could not connect TikTok. Please try again.", "error");
    }
  };

  const handleDisconnectTikTok = async () => {
    try {
      await apiRequest("/tiktok/disconnect", {
        method: "POST",
        token: getToken() || undefined,
      });
    } catch (err) {
      console.error("Failed to disconnect TikTok:", err);
    }
    setTiktokStatus({ connected: false });
    setProfile((prev) => ({
      ...prev,
      socialAccounts: prev.socialAccounts.filter((s) => s.platform !== "tiktok"),
    }));
    toast("TikTok disconnected", "success");
  };

  const handleConnectMeta = async (provider: MetaProvider) => {
    try {
      const data = await apiRequest<{ url: string }>(`/meta/connect/${provider}`, {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ returnTo: window.location.origin + window.location.pathname }),
      });
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error(`Failed to start ${provider} connect:`, err);
      toast(`Could not connect ${provider === "facebook" ? "Facebook" : "Instagram"}. Please try again.`, "error");
    }
  };

  const handleDisconnectMeta = async (provider: MetaProvider) => {
    try {
      await apiRequest(`/meta/disconnect/${provider}`, {
        method: "POST",
        token: getToken() || undefined,
      });
    } catch (err) {
      console.error(`Failed to disconnect ${provider}:`, err);
    }
    setMetaStatus((prev) => ({ ...prev, [provider]: { connected: false } }));
    setProfile((prev) => ({
      ...prev,
      socialAccounts: prev.socialAccounts.filter((s) => s.platform !== provider),
    }));
    toast(`${provider === "facebook" ? "Facebook" : "Instagram"} disconnected`, "success");
  };

  const handleSaveNiches = async (niches: string[]) => {
    const next: CreatorProfile = { ...profile, niches };
    setProfile(next);
    markCompleteIfReady(next);

    try {
      await apiRequest("/creators/profile/niches", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ niches }),
      });
    } catch (err) {
      console.error(err);
      toast("Failed to save niches. Please try again.", "error");
    }
  };

  const handleSaveProfile = async () => {
    const next: CreatorProfile = {
      ...profile,
      name: profileForm.name,
      displayName: profileForm.nickname,
      avatar: profileForm.avatarUrl || profile.avatar,
    };
    setProfile(next);
    markCompleteIfReady(next);

    try {
      await apiRequest("/creators/profile/me", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({
          displayName: profileForm.nickname,
          avatar: profileForm.avatarUrl || undefined,
        }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const openProfile = (section: ProfileFocusSection) => {
    setProfileFocus(section);
    setShowProfile(true);
  };

  const handleBrowseCampaigns = () => {
    setShowAllSet(false);
    setActiveTab("campaign");
  };

  const handleSubmitContent = async (campaignId: string, videoUrl: string, caption: string) => {
    if (!videoUrl) return;

    try {
      await apiRequest("/submissions", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({
          campaignId,
          videoUrl,
          caption,
        }),
      });

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, status: "under_review" as const, delivery: "Submitted just now", videoUrl, caption }
            : c
        )
      );
    } catch (err) {
      console.error("Failed to submit content:", err);
    }
  };

  const handleUpdateContent = async (campaignId: string, videoUrl: string, caption: string) => {
    if (!videoUrl) return;

    try {
      const submissionId = campaigns.find((c) => c.id === campaignId)?.submissionId;
      if (submissionId) {
        await apiRequest(`/submissions/${submissionId}`, {
          method: "PUT",
          token: getToken() || undefined,
          body: JSON.stringify({ videoUrl, caption }),
        });
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, status: "under_review" as const, comment: undefined, delivery: "Submitted just now", videoUrl, caption }
            : c
        )
      );
    } catch (err) {
      console.error("Failed to update content:", err);
    }
  };

  const handleSubmitPostUrl = async (campaignId: string) => {
    const url = readyPostUrl[campaignId];
    if (!url) return;

    try {
      const submissionId = campaigns.find((c) => c.id === campaignId)?.submissionId;
      if (submissionId) {
        await apiRequest(`/submissions/${submissionId}/mark-posted`, {
          method: "PATCH",
          token: getToken() || undefined,
          body: JSON.stringify({ url, platform: "tiktok" }),
        });
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? {
                ...c,
                status: "live_tracking" as const,
                progress: 0,
                currentViews: 0,
                postUrl: url,
              }
            : c
        )
      );

      setReadyPostUrl((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
    } catch (err) {
      console.error("Failed to submit post URL:", err);
    }
  };

  const handleDetailsSubmitPostUrl = async (campaignId: string, urls: Record<string, string>) => {
    try {
      const submissionId = campaigns.find((c) => c.id === campaignId)?.submissionId;
      if (submissionId) {
        const platforms = Object.entries(urls).filter(([, url]) => url);
        for (const [platform, url] of platforms) {
          await apiRequest(`/submissions/${submissionId}/mark-posted`, {
            method: "PATCH",
            token: getToken() || undefined,
            body: JSON.stringify({ url, platform }),
          });
        }
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? {
                ...c,
                status: "live_tracking" as const,
                progress: 0,
                currentViews: 0,
                postedPlatforms: Object.keys(urls)
                  .filter((k) => urls[k])
                  .map((k) => ({ platform: k, views: 0 })),
              }
            : c
        )
      );
    } catch (err) {
      console.error("Failed to submit post URLs:", err);
    }
  };

  const refreshCampaigns = async () => {
    await Promise.allSettled([
      apiRequest("/tiktok/sync", { method: "POST", token: getToken() || undefined }),
      apiRequest("/meta/sync", { method: "POST", token: getToken() || undefined }),
    ]);
    await fetchCampaigns();
  };

  const handleClaimSlot = async (campaignId: string, views: number) => {
    try {
      await apiRequest("/slots/claim", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ campaignId, committedViews: views }),
      });

      toast("Slot claimed! Check Home for your campaign.", "success");
      await Promise.allSettled([fetchCampaigns(), fetchMarketplace()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to claim slot";
      toast(message, "error");
      await Promise.allSettled([fetchCampaigns(), fetchMarketplace()]);
    }
  };

  useEffect(() => {
    if (selectedCampaign) {
      const updated = campaigns.find((c) => c.id === selectedCampaign.id);
      if (updated) setSelectedCampaign(updated);
    }
  }, [campaigns]);

  const filteredCampaigns = campaigns.filter((c) => {
    if (campaignsFilter === "all") return true;
    return c.status === campaignsFilter;
  });

  const handleLogout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center">
        <div className="space-y-4 w-full max-w-7xl mx-auto px-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const profileComplete = profile.niches.length > 0 && !!profile.avatar;
  const hasConnectedSocial =
    tiktokStatus.connected ||
    metaStatus.instagram.connected ||
    metaStatus.facebook.connected;
  const campaignsUnlocked = profile.niches.length > 0 && hasConnectedSocial;

  const renderOnboardingView = (p: CreatorProfile) => (
    <OnboardingView
      profile={p}
      onConnectSocial={() => openProfile("social")}
      onChooseNiches={() => openProfile("niches")}
      onCompleteProfile={() => openProfile("details")}
    />
  );

  const renderCampaignFeed = () => (
    <CampaignFeed
      profile={profile}
      campaigns={filteredCampaigns}
      filter={campaignsFilter}
      onFilterChange={setCampaignsFilter}
      onSelectCampaign={(camp) => {
        if (isMobile) {
          router.push(`/campaign/${camp.id}`);
        } else {
          setSelectedCampaign(camp);
        }
      }}
      onBrowseCampaign={handleBrowseCampaigns}
    />
  );

  return (
    <div className="min-h-dvh bg-[#F5F5F4] text-[#1C1917] flex flex-col font-rethink">
      <CreatorHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        profile={profile}
        onLogout={handleLogout}
        onOpenProfile={() => openProfile("details")}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 md:py-10 flex flex-col items-center">
        {showProfile ? (
          <ProfileView
            profile={profile}
            profileForm={profileForm}
            onProfileFormChange={setProfileForm}
            focusSection={profileFocus}
            onClose={() => setShowProfile(false)}
            onRemoveSocial={handleRemoveSocial}
            onSaveNiches={handleSaveNiches}
            onSaveProfile={handleSaveProfile}
            tiktokStatus={tiktokStatus}
            onConnectTikTok={handleConnectTikTok}
            onDisconnectTikTok={handleDisconnectTikTok}
            metaStatus={metaStatus}
            onConnectMeta={handleConnectMeta}
            onDisconnectMeta={handleDisconnectMeta}
          />
        ) : (
          <>
            {activeTab === "home" && (
              <>
                {!campaignsUnlocked ? (
                  renderOnboardingView(profile)
                ) : showAllSet ? (
                  <OnboardingComplete
                    profile={profile}
                    onBrowseCampaigns={handleBrowseCampaigns}
                  />
                ) : (
                  renderCampaignFeed()
                )}
              </>
            )}

            {activeTab === "campaign" && (
              <div className="relative w-full">
                <div className={cn(!campaignsUnlocked && "select-none")} aria-hidden={!campaignsUnlocked}>
                  <CampaignMarketplace
                    campaigns={marketplaceCampaigns}
                    meta={marketplaceMeta}
                    onClaimSlot={handleClaimSlot}
                    niches={profile.niches}
                  />
                </div>
                {!campaignsUnlocked && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[24px] bg-[#F5F5F4]/50 backdrop-blur-[3px]">
                    <div className="bg-white/95 border border-stone-200 rounded-3xl px-6 py-6 max-w-sm w-full mx-4 text-center space-y-3 font-rethink">
                      <div className="w-12 h-12 mx-auto rounded-full bg-stone-100 flex items-center justify-center">
                        <HugeiconsIcon icon={LockIcon} size={20} className="text-stone-500" />
                      </div>
                      <h4 className="font-semibold text-base text-stone-900 tracking-tight">
                        Unlock campaigns to start earning
                      </h4>
                      <p className="text-sm font-medium text-stone-500 leading-relaxed tracking-[-0.01em]">
                        {marketplaceMeta.lockReason || "Connect a social account and choose your niches to unlock campaigns."}
                      </p>
                      <div className="pt-2 flex flex-col gap-2">
                        <button
                          onClick={() => openProfile("social")}
                          className="w-full py-3 bg-[#FEB604] text-stone-900 rounded-full font-semibold text-sm border border-stone-100"
                        >
                          Connect social account
                        </button>
                        <button
                          onClick={() => openProfile("niches")}
                          className="w-full py-3 bg-white text-stone-900 rounded-full font-semibold text-sm border border-stone-200"
                        >
                          Choose my niches
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "wallet" && <WalletView profile={profile} walletData={walletData} />}
          </>
        )}

        {selectedCampaign && (
          <CampaignDetailsDrawer
            campaign={selectedCampaign}
            onClose={() => setSelectedCampaign(null)}
            onSubmitContent={handleSubmitContent}
            onUpdateContent={handleUpdateContent}
            onSubmitPostUrl={handleDetailsSubmitPostUrl}
            onRefresh={refreshCampaigns}
          />
        )}
      </main>
    </div>
  );
}

export default function CreatorDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center"><Skeleton className="h-6 w-40" /></div>}>
      <CreatorDashboardContent />
    </Suspense>
  );
}
