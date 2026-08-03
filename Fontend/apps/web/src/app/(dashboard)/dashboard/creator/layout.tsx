"use client";

import { usePathname } from "next/navigation";
import {
  CreatorDashboardProvider,
  useCreatorDashboard,
} from "../../../../components/creator-dashboard-context";
import { CreatorHeader } from "../../../../components/creator-header";
import { ProfileView } from "../../../../components/profile-view";
import { CampaignDetailsDrawer } from "../../../../components/campaign-details-drawer";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useReveal } from "../../../../hooks/use-reveal";

function CreatorShell({ children }: { children: React.ReactNode }) {
  useReveal();

  const {
    loading,
    activeTab,
    navigateTab,
    profile,
    profileForm,
    setProfileForm,
    showProfile,
    profileFocus,
    openProfile,
    closeProfile,
    selectedCampaign,
    setSelectedCampaign,
    handleLogout,
    handleRemoveSocial,
    handleSaveNiches,
    handleSaveProfile,
    tiktokStatus,
    handleConnectTikTok,
    handleDisconnectTikTok,
    handleSubmitContent,
    handleUpdateContent,
    handleDetailsSubmitPostUrl,
  } = useCreatorDashboard();

  return (
    <div className="min-h-dvh bg-stone-50 text-[#1C1917] flex flex-col font-rethink">
      <CreatorHeader
        activeTab={activeTab}
        onTabChange={navigateTab}
        profile={profile}
        onLogout={handleLogout}
        onOpenProfile={() => openProfile("details")}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 md:py-10 flex flex-col items-center">
        {loading ? (
          <div className="w-full max-w-7xl mx-auto space-y-4">
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
        ) : showProfile ? (
          <ProfileView
            profile={profile}
            profileForm={profileForm}
            onProfileFormChange={setProfileForm}
            focusSection={profileFocus}
            onClose={closeProfile}
            onRemoveSocial={handleRemoveSocial}
            onSaveNiches={handleSaveNiches}
            onSaveProfile={handleSaveProfile}
            tiktokStatus={tiktokStatus}
            onConnectTikTok={handleConnectTikTok}
            onDisconnectTikTok={handleDisconnectTikTok}
          />
        ) : (
          children
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
    </div>
  );
}

export default function CreatorDashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDetail = /\/campaign\/[^/]+\/?$/.test(pathname);

  if (isDetail) {
    return <>{children}</>;
  }

  return (
    <CreatorDashboardProvider>
      <CreatorShell>{children}</CreatorShell>
    </CreatorDashboardProvider>
  );
}
