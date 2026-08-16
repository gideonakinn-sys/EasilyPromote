"use client";

import { useCreatorDashboard } from "../../../../../components/creator-dashboard-context";
import { WalletView } from "../../../../../components/wallet-view";
import { SetupRequiredNotice } from "../../../../../components/setup-required-notice";

function CreatorWallet() {
  const { profile, walletData, openProfile } = useCreatorDashboard();

  return (
    <div className="w-full">
      <SetupRequiredNotice
        profile={profile}
        onConnectSocial={() => openProfile("social")}
        onChooseNiches={() => openProfile("niches")}
        onCompleteProfile={() => openProfile("details")}
      />
      <WalletView profile={profile} walletData={walletData} />
    </div>
  );
}

export default function CreatorWalletPage() {
  return <CreatorWallet />;
}
