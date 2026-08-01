"use client";

import { useCreatorDashboard } from "../../../../../components/creator-dashboard-context";
import { CampaignMarketplace } from "../../../../../components/campaign-marketplace";

function CreatorCampaigns() {
  const { marketplaceCampaigns, marketplaceMeta, handleClaimSlot, profile } = useCreatorDashboard();

  return (
    <CampaignMarketplace
      campaigns={marketplaceCampaigns}
      meta={marketplaceMeta}
      onClaimSlot={handleClaimSlot}
      niches={profile.niches}
    />
  );
}

export default function CreatorCampaignsPage() {
  return <CreatorCampaigns />;
}
