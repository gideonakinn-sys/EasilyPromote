"use client";

import { useCreatorDashboard } from "../../../../../components/creator-dashboard-context";
import { WalletView } from "../../../../../components/wallet-view";

function CreatorWallet() {
  const { profile, walletData } = useCreatorDashboard();

  return <WalletView profile={profile} walletData={walletData} />;
}

export default function CreatorWalletPage() {
  return <CreatorWallet />;
}
