"use client";

import { useCreatorDashboard } from "../../../../components/creator-dashboard-context";
import { OnboardingView } from "../../../../components/onboarding-view";
import { OnboardingComplete } from "../../../../components/onboarding-complete";
import { CampaignFeed } from "../../../../components/campaign-feed";

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
    <CampaignFeed
      profile={profile}
      campaigns={filteredCampaigns}
      filter={campaignsFilter}
      onFilterChange={setCampaignsFilter}
      onSelectCampaign={handleSelectCampaign}
      onBrowseCampaign={handleBrowseCampaigns}
    />
  );
}

export default function CreatorDashboardHomePage() {
  return <CreatorHome />;
}
