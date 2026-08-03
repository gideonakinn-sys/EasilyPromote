"use client";

import type { CreatorProfile, WalletData } from "./types";
import { useReveal } from "../hooks/use-reveal";

interface WalletViewProps {
  profile: CreatorProfile;
  walletData: WalletData | null;
}

export function WalletView({ profile, walletData }: WalletViewProps) {
  useReveal();

  const withdrawable = walletData?.withdrawableBalance ?? walletData?.balance ?? 0;
  const pending = walletData?.pendingBalance ?? 0;
  const pendingByCampaign = walletData?.pendingByCampaign ?? [];
  const lifetimeEarnings = walletData?.lifetimeEarnings ?? profile.lifetimeEarnings;
  const completionRate = walletData?.completionRate ?? profile.completionRate;
  const totalReleased = walletData?.totalReleased ?? 0;

  return (
    <div data-reveal className="w-full max-w-lg bg-white border border-stone-200 rounded-3xl p-8 text-center">
      <h2 className="font-rethink font-medium text-xl mb-3 text-stone-900">Earnings Wallet</h2>
      <p className="text-sm text-stone-500 mb-6 font-medium">
        Manage your payouts, bank withdrawal accounts, and view overall statistics.
      </p>

      <div className="bg-[#FAFAF9] border border-stone-200 rounded-2xl p-6 mb-6">
        <div className="text-xs font-medium text-stone-500 mb-1">
          Withdrawable Balance
        </div>
        <div className="font-rethink text-3xl font-medium text-stone-900 mb-2">
          ₦{withdrawable.toLocaleString()}.00
        </div>
        <span className="text-[10px] font-medium px-2.5 py-1 bg-green-50 text-green-700 border border-green-100 rounded-full">
          Available to withdraw
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 text-left">
          <span className="text-[10px] font-medium text-stone-500">Lifetime Earnings</span>
          <p className="font-rethink text-lg font-medium mt-0.5 text-stone-900">₦{lifetimeEarnings.toLocaleString()}</p>
        </div>
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 text-left">
          <span className="text-[10px] font-medium text-stone-500">Completion Rate</span>
          <p className="font-rethink text-lg font-medium mt-0.5 text-stone-900">{completionRate}%</p>
        </div>
      </div>

      {pendingByCampaign.length > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-stone-500">Pending Balance (non-withdrawable)</span>
            <span className="font-rethink text-sm font-medium text-stone-900">₦{pending.toLocaleString()}</span>
          </div>
          <div className="space-y-2.5">
            {pendingByCampaign.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <p className="font-rethink font-medium text-stone-800 truncate">{c.title}</p>
                  <p className="font-rethink text-xs text-stone-500">
                    {c.views.toLocaleString()} / {c.viewTarget.toLocaleString()} views
                  </p>
                </div>
                <span className="font-rethink font-medium text-stone-900">₦{c.earned.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalReleased > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left">
          <span className="text-[10px] font-medium text-stone-500">Total Released</span>
          <p className="font-rethink text-lg font-medium mt-0.5 text-stone-900">₦{totalReleased.toLocaleString()}</p>
        </div>
      )}

      <button
        onClick={() => alert("Payout request submitted. Processing batch window.")}
        disabled={withdrawable <= 0}
        className="w-full py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
      >
        Withdraw Funds
      </button>
    </div>
  );
}
