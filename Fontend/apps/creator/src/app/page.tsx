"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { apiRequest, getToken, getUser, DEMO_MODE, saveAuth } from "../lib/api";
import type { CreatorProfile, ActiveTab, CampaignItem, MarketplaceCampaign, WalletData, ProfileForm, ProfileFocusSection } from "../components/types";
import { CreatorHeader } from "../components/creator-header";
import { OnboardingView } from "../components/onboarding-view";
import { OnboardingComplete } from "../components/onboarding-complete";
import { CampaignFeed } from "../components/campaign-feed";
import { WalletView } from "../components/wallet-view";
import { CampaignMarketplace } from "../components/campaign-marketplace";
import { ProfileView } from "../components/profile-view";
import { CampaignDetailsDrawer } from "../components/campaign-details-drawer";
import { Skeleton } from "../components/ui/skeleton";
import { HomeStateSwitcher, type HomePreviewState } from "../components/home-state-switcher";
import { useReveal } from "../hooks/use-reveal";

function CreatorDashboardContent() {
  const router = useRouter();
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
  const [homePreview, setHomePreview] = useState<HomePreviewState>("empty");
  const [showAllSet, setShowAllSet] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [profileFocus, setProfileFocus] = useState<ProfileFocusSection | null>(null);
  const [campaignsFilter, setCampaignsFilter] = useState<string>("all");
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [marketplaceCampaigns, setMarketplaceCampaigns] = useState<MarketplaceCampaign[]>([]);
  const [marketplaceMeta, setMarketplaceMeta] = useState({ activeSlots: 0, maxSlots: 3, canClaim: true });
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileForm, setProfileForm] = useState<ProfileForm>({
    displayName: "",
    bio: "",
    country: "",
    avatarUrl: "",
  });

  const [readyPostUrl, setReadyPostUrl] = useState<Record<string, string>>({});

  useEffect(() => {
    if (DEMO_MODE) {
      if (!getToken()) {
        saveAuth("demo-token", {
          id: "demo-user",
          name: "Alex Creative",
          email: "alex@demo.com",
          role: "creator",
          emailVerified: true,
        });
      }
      fetchAllData();
      return;
    }

    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const user = getUser();
    if (user) {
      setProfile((prev) => ({
        ...prev,
        name: user.name,
        displayName: user.name,
        username: user.email.split("@")[0],
      }));
    }

    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.allSettled([
      fetchProfile(),
      fetchCampaigns(),
      fetchMarketplace(),
      fetchWallet(),
    ]);
    setLoading(false);
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
      setProfileForm({
        displayName: p.displayName,
        bio: p.bio,
        country: p.country,
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
        postedPlatforms: c.postedPlatforms as string[],
        submissionId: c.submissionId as string,
        contentBrief: c.contentBrief as string,
        keyMessageCta: c.keyMessageCta as string,
        whatToAvoid: c.whatToAvoid as string,
        platforms: c.platforms as string[],
        contentStyle: c.contentStyle as string,
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
        contentBrief: c.contentBrief as string,
        brandName: (c.brandName as string) || "Brand",
        brandAvatar: c.brandAvatar as string | undefined,
        minViews: (c.minViews as number) || 1000,
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

  const markCompleteIfReady = (next: CreatorProfile) => {
    const complete = next.socialAccounts.length > 0 && next.niches.length > 0 && next.country !== "";
    if (complete && !profileComplete && !showAllSet) {
      setShowAllSet(true);
      setHomePreview("allset");
    }
  };

  const handleConnectSocial = async (platform: string, handle: string) => {
    if (!handle) return;
    const newSocial = {
      platform: platform.toLowerCase(),
      handle: handle.startsWith("@") ? handle : `@${handle}`,
      verified: true,
    };

    const updatedSocials = [
      ...profile.socialAccounts.filter((s) => s.platform !== newSocial.platform),
      newSocial,
    ];
    const next: CreatorProfile = { ...profile, socialAccounts: updatedSocials };
    setProfile(next);
    markCompleteIfReady(next);

    try {
      await apiRequest("/creators/profile/socials", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ platform, handle: newSocial.handle }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveSocial = (platform: string) => {
    setProfile((prev) => ({
      ...prev,
      socialAccounts: prev.socialAccounts.filter((s) => s.platform !== platform),
    }));
  };

  const handleSaveNiches = async (niches: string[]) => {
    if (niches.length === 0) return;

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
    }
  };

  const handleSaveProfile = async () => {
    const next: CreatorProfile = {
      ...profile,
      displayName: profileForm.displayName,
      bio: profileForm.bio,
      country: profileForm.country,
      avatar: profileForm.avatarUrl || profile.avatar,
    };
    setProfile(next);
    markCompleteIfReady(next);

    try {
      await apiRequest("/creators/profile/me", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({
          displayName: profileForm.displayName,
          bio: profileForm.bio,
          country: profileForm.country,
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
    setHomePreview("filled");
    setActiveTab("campaign");
  };

  const handleSubmitContent = async (campaignId: string) => {
    const url = readyPostUrl[campaignId];
    if (!url) return;

    try {
      await apiRequest("/submissions", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({
          campaignId,
          videoUrl: url,
          caption: "",
        }),
      });

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, status: "under_review" as const, delivery: "Submitted just now", videoUrl: url }
            : c
        )
      );

      setReadyPostUrl((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
    } catch (err) {
      console.error("Failed to submit content:", err);
    }
  };

  const handleUpdateContent = async (campaignId: string) => {
    const url = readyPostUrl[campaignId];
    if (!url) return;

    try {
      const submissionId = campaigns.find((c) => c.id === campaignId)?.submissionId;
      if (submissionId) {
        await apiRequest(`/submissions/${submissionId}`, {
          method: "PUT",
          token: getToken() || undefined,
          body: JSON.stringify({ videoUrl: url }),
        });
      }

      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId
            ? { ...c, status: "under_review" as const, comment: undefined, delivery: "Submitted just now", videoUrl: url }
            : c
        )
      );

      setReadyPostUrl((prev) => {
        const next = { ...prev };
        delete next[campaignId];
        return next;
      });
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

  const handleDetailsSubmitPostUrl = async (campaignId: string, urls: { tiktok?: string; instagram?: string; x?: string }) => {
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
                postedPlatforms: Object.keys(urls).filter((k) => urls[k as keyof typeof urls]),
              }
            : c
        )
      );
    } catch (err) {
      console.error("Failed to submit post URLs:", err);
    }
  };

  const handleClaimSlot = async (campaignId: string, views: number) => {
    try {
      await apiRequest("/slots/claim", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ campaignId, committedViews: views }),
      });

      await Promise.allSettled([fetchCampaigns(), fetchMarketplace()]);
    } catch (err) {
      console.error("Failed to claim slot:", err);
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

  const profileComplete = profile.socialAccounts.length > 0 && profile.niches.length > 0 && profile.country !== "";

  const blankProfile: CreatorProfile = {
    ...profile,
    socialAccounts: [],
    niches: [],
    bio: "",
    country: "",
  };

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
      onSelectCampaign={setSelectedCampaign}
      onBrowseCampaign={handleBrowseCampaigns}
    />
  );

  return (
    <div className="min-h-dvh bg-[#F5F5F4] text-[#1C1917] flex flex-col font-rethink">
      <CreatorHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        profile={DEMO_MODE && homePreview === "empty" ? blankProfile : profile}
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
            onConnectSocial={handleConnectSocial}
            onRemoveSocial={handleRemoveSocial}
            onSaveNiches={handleSaveNiches}
            onSaveProfile={handleSaveProfile}
          />
        ) : (
          <>
            {activeTab === "home" && (
              <>
                {DEMO_MODE && homePreview === "empty" ? (
                  renderOnboardingView(blankProfile)
                ) : showAllSet || (DEMO_MODE && homePreview === "allset") ? (
                  <OnboardingComplete
                    profile={profile}
                    onBrowseCampaigns={handleBrowseCampaigns}
                  />
                ) : DEMO_MODE && homePreview === "filled" ? (
                  renderCampaignFeed()
                ) : !profileComplete ? (
                  renderOnboardingView(profile)
                ) : (
                  renderCampaignFeed()
                )}
              </>
            )}

            {activeTab === "campaign" && (
              <CampaignMarketplace
                campaigns={marketplaceCampaigns}
                meta={marketplaceMeta}
                onClaimSlot={handleClaimSlot}
                niches={profile.niches}
              />
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
          />
        )}
      </main>

      {activeTab === "home" && !showProfile && (
        <HomeStateSwitcher
          value={homePreview}
          onChange={(value) => {
            setHomePreview(value);
            setShowAllSet(false);
          }}
        />
      )}
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
