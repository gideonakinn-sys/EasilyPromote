"use client";

import { useCreatorDashboard } from "../../../../../components/creator-dashboard-context";
import { CampaignMarketplace } from "../../../../../components/campaign-marketplace";
import { SetupRequiredNotice } from "../../../../../components/setup-required-notice";
import { AudienceDataPrompt } from "../../../../../components/creator-profile-sections";

function CreatorCampaigns() {
  const {
    marketplaceCampaigns,
    marketplaceMeta,
    handleJoinCampaign,
    profile,
    openProfile,
    navigateTab,
    applications,
    handleApplyToCampaign,
    handleWithdrawApplication,
  } = useCreatorDashboard();

  return (
    <div className="w-full">
      <SetupRequiredNotice
        profile={profile}
        onConnectSocial={() => openProfile("social")}
        onChooseNiches={() => openProfile("niches")}
        onCompleteProfile={() => openProfile("details")}
      />
      <AudienceDataPrompt profile={profile} onAddAudience={() => openProfile("audience")} />
      <CampaignMarketplace
        campaigns={marketplaceCampaigns}
        meta={marketplaceMeta}
        onJoin={handleJoinCampaign}
        onViewMyCampaigns={() => navigateTab("home")}
        applications={{ list: applications, onApply: handleApplyToCampaign, onWithdraw: handleWithdrawApplication }}
      />
    </div>
  );
}

export default function CreatorCampaignsPage() {
  return <CreatorCampaigns />;
}
