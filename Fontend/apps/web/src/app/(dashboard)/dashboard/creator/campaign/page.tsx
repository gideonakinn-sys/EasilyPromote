"use client";

import { useCreatorDashboard } from "../../../../../components/creator-dashboard-context";
import { CampaignMarketplace } from "../../../../../components/campaign-marketplace";
import { SetupRequiredNotice } from "../../../../../components/setup-required-notice";

function CreatorCampaigns() {
  const { marketplaceCampaigns, marketplaceMeta, handleClaimSlot, profile, openProfile } =
    useCreatorDashboard();

  return (
    <div className="w-full">
      <SetupRequiredNotice
        profile={profile}
        onConnectSocial={() => openProfile("social")}
        onChooseNiches={() => openProfile("niches")}
        onCompleteProfile={() => openProfile("details")}
      />
      <CampaignMarketplace
        campaigns={marketplaceCampaigns}
        meta={marketplaceMeta}
        onClaimSlot={handleClaimSlot}
        niches={profile.niches}
      />
    </div>
  );
}

export default function CreatorCampaignsPage() {
  return <CreatorCampaigns />;
}
