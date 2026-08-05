"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { useToast } from "@ep/ui/components/toast";
import { apiRequest, getToken, getUser } from "../lib/api";
import { useCampaignUpdates, type CampaignUpdate } from "../lib/socket";
import type {
  CreatorProfile,
  ActiveTab,
  CampaignItem,
  MarketplaceCampaign,
  WalletData,
  ProfileForm,
  ProfileFocusSection,
  TikTokStatus,
} from "./types";

interface CreatorDashboardValue {
  profile: CreatorProfile;
  profileForm: ProfileForm;
  setProfileForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
  loading: boolean;
  activeTab: ActiveTab;
  navigateTab: (tab: ActiveTab) => void;
  isMobile: boolean;
  showProfile: boolean;
  profileFocus: ProfileFocusSection | null;
  openProfile: (section: ProfileFocusSection) => void;
  closeProfile: () => void;
  showAllSet: boolean;
  profileComplete: boolean;
  filteredCampaigns: CampaignItem[];
  campaignsFilter: string;
  setCampaignsFilter: (filter: string) => void;
  handleSelectCampaign: (camp: CampaignItem) => void;
  handleBrowseCampaigns: () => void;
  handleLogout: () => void;
  marketplaceCampaigns: MarketplaceCampaign[];
  marketplaceMeta: { activeSlots: number; maxSlots: number; canClaim: boolean };
  walletData: WalletData | null;
  selectedCampaign: CampaignItem | null;
  setSelectedCampaign: (camp: CampaignItem | null) => void;
  handleClaimSlot: (campaignId: string, views: number) => void;
  handleRemoveSocial: (platform: string) => void;
  handleSaveNiches: (niches: string[]) => void;
  handleSaveProfile: () => void;
  tiktokStatus: TikTokStatus;
  handleConnectTikTok: () => void;
  handleDisconnectTikTok: () => void;
  handleSubmitContent: (campaignId: string, videoUrl: string, caption: string) => void;
  handleUpdateContent: (campaignId: string, videoUrl: string, caption: string) => void;
  handleDetailsSubmitPostUrl: (campaignId: string, urls: Record<string, string>) => void;
  refreshCampaigns: () => Promise<void>;
}

const CreatorDashboardContext = React.createContext<CreatorDashboardValue | null>(null);

export function useCreatorDashboard(): CreatorDashboardValue {
  const ctx = React.useContext(CreatorDashboardContext);
  if (!ctx) {
    throw new Error("useCreatorDashboard must be used within a CreatorDashboardProvider");
  }
  return ctx;
}

export function CreatorDashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const activeTab: ActiveTab =
    pathname.endsWith("/campaign") || pathname.includes("/campaign/")
      ? "campaign"
      : pathname.endsWith("/wallet")
        ? "wallet"
        : "home";

  const [profile, setProfile] = React.useState<CreatorProfile>({
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

  const [showAllSet, setShowAllSet] = React.useState(false);
  const [showProfile, setShowProfile] = React.useState(false);
  const [profileFocus, setProfileFocus] = React.useState<ProfileFocusSection | null>(null);
  const [campaignsFilter, setCampaignsFilter] = React.useState<string>("all");
  const [campaigns, setCampaigns] = React.useState<CampaignItem[]>([]);
  const [marketplaceCampaigns, setMarketplaceCampaigns] = React.useState<MarketplaceCampaign[]>([]);
  const [marketplaceMeta, setMarketplaceMeta] = React.useState({ activeSlots: 0, maxSlots: 3, canClaim: true });
  const [walletData, setWalletData] = React.useState<WalletData | null>(null);
  const [tiktokStatus, setTiktokStatus] = React.useState<TikTokStatus>({ connected: false });
  const [selectedCampaign, setSelectedCampaign] = React.useState<CampaignItem | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [profileForm, setProfileForm] = React.useState<ProfileForm>({
    name: "",
    nickname: "",
    email: "",
    phone: "",
    avatarUrl: "",
  });

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const user = getUser();
    if (user?.role === "business") {
      router.push("/dashboard/brand");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.allSettled([
      fetchProfile(),
      fetchCampaigns(),
      fetchMarketplace(),
      fetchWallet(),
      fetchTikTokStatus(),
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
        postedPlatforms: c.postedPlatforms as Array<{ platform: string; views: number }>,
        creatorHandle: c.creatorHandle as string | undefined,
        submissionId: c.submissionId as string,
        contentBrief: c.contentBrief as string,
        description: c.description as string,
        keyMessageCta: c.keyMessageCta as string,
        whatToAvoid: c.whatToAvoid as string,
        goal: c.goal as string | undefined,
        competitors: c.competitors as string | undefined,
        uniqueSellingPoint: c.uniqueSellingPoint as string | undefined,
        funFact: c.funFact as string | undefined,
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
      const data = await apiRequest<{ campaigns: Array<Record<string, unknown>>; activeSlots: number; maxSlots: number; canClaim: boolean }>("/creators/marketplace", {
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
        creatorPool: c.creatorPool as number | undefined,
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

  const profileComplete = profile.niches.length > 0 && !!profile.avatar;

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

  const closeProfile = () => setShowProfile(false);

  const handleBrowseCampaigns = () => {
    setShowAllSet(false);
    navigateTab("campaign");
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
    try {
      await apiRequest("/tiktok/sync", {
        method: "POST",
        token: getToken() || undefined,
      });
    } catch {
      // sync is best-effort
    }
    await fetchCampaigns();
  };

  const handleCampaignUpdate = (data: CampaignUpdate) => {
    const exists = campaigns.some((c) => c.id === data.campaignId);
    if (!exists) {
      fetchCampaigns();
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) =>
        c.id !== data.campaignId
          ? c
          : {
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
            }
      )
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

  const handleClaimSlot = async (campaignId: string, views: number) => {
    try {
      await apiRequest("/slots/claim", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ campaignId, committedViews: views }),
      });

      toast("Slot claimed! Check Home for your campaign.", "success");
      await Promise.allSettled([fetchCampaigns(), fetchMarketplace()]);    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to claim slot";
      toast(message, "error");
      await Promise.allSettled([fetchCampaigns(), fetchMarketplace()]);
    }
  };

  const handleSelectCampaign = (camp: CampaignItem) => {
    if (isMobile) {
      router.push(`/dashboard/creator/campaign/${camp.id}`);
    } else {
      setSelectedCampaign(camp);
    }
  };

  React.useEffect(() => {
    if (selectedCampaign) {
      const updated = campaigns.find((c) => c.id === selectedCampaign.id);
      if (updated) setSelectedCampaign(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns]);

  const filteredCampaigns = campaigns.filter((c) => {
    if (campaignsFilter === "all") return true;
    return c.status === campaignsFilter;
  });

  const handleLogout = React.useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  }, [router]);

  const navigateTab = (tab: ActiveTab) => {
    router.push(tab === "home" ? "/dashboard/creator" : `/dashboard/creator/${tab}`);
  };

  const value: CreatorDashboardValue = {
    profile,
    profileForm,
    setProfileForm,
    loading,
    activeTab,
    navigateTab,
    isMobile,
    showProfile,
    profileFocus,
    openProfile,
    closeProfile,
    showAllSet,
    profileComplete,
    filteredCampaigns,
    campaignsFilter,
    setCampaignsFilter,
    handleSelectCampaign,
    handleBrowseCampaigns,
    handleLogout,
    marketplaceCampaigns,
    marketplaceMeta,
    walletData,
    selectedCampaign,
    setSelectedCampaign,
    handleClaimSlot,
    handleRemoveSocial,
    handleSaveNiches,
    handleSaveProfile,
    tiktokStatus,
    handleConnectTikTok,
    handleDisconnectTikTok,
    handleSubmitContent,
    handleUpdateContent,
    handleDetailsSubmitPostUrl,
    refreshCampaigns,
  };

  return (
    <CreatorDashboardContext.Provider value={value}>
      {children}
    </CreatorDashboardContext.Provider>
  );
}
