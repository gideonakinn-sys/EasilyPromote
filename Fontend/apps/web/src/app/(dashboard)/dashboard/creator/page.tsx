"use client";

import { useCreatorDashboard } from "../../../../components/creator-dashboard-context";
import { OnboardingView } from "../../../../components/onboarding-view";
import { OnboardingComplete } from "../../../../components/onboarding-complete";
import { CampaignFeed } from "../../../../components/campaign-feed";
import { AudienceDataPrompt } from "../../../../components/creator-profile-sections";
import { MyApplications } from "../../../../components/my-applications";

function CreatorHome() {
  const {
    profile,
    openProfile,
    showAllSet,
    profileComplete,
    filteredCampaigns,
    campaignsFilter,
    setCampaignsFilter,
    handleSelectCampaign,
    handleBrowseCampaigns,
    applications,
    handleWithdrawApplication,
  } = useCreatorDashboard();

  if (showAllSet) {
    return <OnboardingComplete profile={profile} onBrowseCampaigns={handleBrowseCampaigns} />;
  }

  if (!profileComplete) {
    return (
      <OnboardingView
        profile={profile}
        onConnectSocial={() => openProfile("social")}
        onChooseNiches={() => openProfile("niches")}
        onCompleteProfile={() => openProfile("details")}
      />
    );
  }

  return (
    <div className="w-full">
      <AudienceDataPrompt profile={profile} onAddAudience={() => openProfile("audience")} />
      <MyApplications applications={applications} onWithdraw={handleWithdrawApplication} />
      <CampaignFeed
        profile={profile}
        campaigns={filteredCampaigns}
        filter={campaignsFilter}
        onFilterChange={setCampaignsFilter}
        onSelectCampaign={handleSelectCampaign}
        onBrowseCampaign={handleBrowseCampaigns}
      />
    </div>
  );
}

export default function CreatorDashboardHomePage() {
  return <CreatorHome />;
}
