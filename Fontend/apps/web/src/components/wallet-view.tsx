"use client";

import * as React from "react";
import type { CreatorProfile, WalletData, WithdrawalItem } from "./types";
import { useReveal } from "../hooks/use-reveal";
import { useToast } from "@ep/ui/components/toast";
import { apiRequest, getToken } from "../lib/api";
import { cn } from "@ep/ui/lib/utils";

interface WalletViewProps {
  profile: CreatorProfile;
  walletData: WalletData | null;
}

interface BankOption {
  name: string;
  code: string;
  slug?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  rejected: "Rejected",
  released: "Released",
};

export function WalletView({ profile, walletData }: WalletViewProps) {
  useReveal();
  const { toast } = useToast();

  const withdrawable = walletData?.withdrawableBalance ?? walletData?.balance ?? 0;
  const pending = walletData?.pendingBalance ?? 0;
  const pendingByCampaign = walletData?.pendingByCampaign ?? [];
  const lifetimeEarnings = walletData?.lifetimeEarnings ?? profile.lifetimeEarnings;
  const completionRate = walletData?.completionRate ?? profile.completionRate;
  const totalReleased = walletData?.totalReleased ?? 0;
  const [localBank, setLocalBank] = React.useState<{
    accountName: string;
    bankName: string | null;
    maskedAccountNumber: string | null;
  } | null>(null);

  const hasBankAccount = localBank ? true : (walletData?.hasBankAccount ?? false);
  const bankAccountName = localBank?.accountName || walletData?.accountName || "Account";
  const bankDisplay = `${localBank?.bankName || walletData?.bankName || "Bank"} · ${localBank?.maskedAccountNumber || walletData?.maskedAccountNumber || ""}`;

  const [showBankForm, setShowBankForm] = React.useState(false);
  const [banks, setBanks] = React.useState<BankOption[]>([]);
  const [accountNumber, setAccountNumber] = React.useState("");
  const [bankCode, setBankCode] = React.useState("");
  const [savingBank, setSavingBank] = React.useState(false);

  const [showWithdraw, setShowWithdraw] = React.useState(false);
  const [withdrawCampaignId, setWithdrawCampaignId] = React.useState("");
  const [withdrawAmount, setWithdrawAmount] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [withdrawals, setWithdrawals] = React.useState<WithdrawalItem[]>([]);

  const eligibleCampaigns = pendingByCampaign.filter((c) => c.earned > 0 && c.status !== "under_review");
  const selectedCampaign = pendingByCampaign.find((c) => c.id === withdrawCampaignId);

  const fetchWithdrawals = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ withdrawals: WithdrawalItem[] }>("/creators/withdrawals", {
        token: getToken() || undefined,
      });
      setWithdrawals(data.withdrawals || []);
    } catch {
      // best-effort
    }
  }, []);

  const fetchBanks = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ banks: BankOption[] }>("/creators/banks", {
        token: getToken() || undefined,
      });
      const seen = new Set<string>();
      const unique = (data.banks || []).filter((b) => {
        if (seen.has(b.code)) return false;
        seen.add(b.code);
        return true;
      });
      setBanks(unique);
    } catch {
      // best-effort
    }
  }, []);

  React.useEffect(() => {
    fetchWithdrawals();
    fetchBanks();
  }, [fetchWithdrawals, fetchBanks]);

  const handleSaveBank = async () => {
    if (!/^\d{10}$/.test(accountNumber)) {
      toast("Enter a valid 10-digit account number", "error");
      return;
    }
    if (!bankCode) {
      toast("Select your bank", "error");
      return;
    }
    setSavingBank(true);
    try {
      const bankName = banks.find((b) => b.code === bankCode)?.name || null;
      const data = await apiRequest<{ hasBankAccount: boolean; accountName: string; bankName: string | null; maskedAccountNumber: string }>(
        "/creators/bank-account",
        {
          method: "POST",
          token: getToken() || undefined,
          body: JSON.stringify({ accountNumber, bankCode, bankName }),
        }
      );
      toast(`Bank account saved (${data.accountName})`, "success");
      setLocalBank({
        accountName: data.accountName,
        bankName: data.bankName,
        maskedAccountNumber: data.maskedAccountNumber,
      });
      setShowBankForm(false);
      setAccountNumber("");
      setBankCode("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save bank account", "error");
    } finally {
      setSavingBank(false);
    }
  };

  const handleRemoveBank = async () => {
    try {
      await apiRequest<{ success: boolean; hasBankAccount: boolean }>("/creators/bank-account", {
        method: "DELETE",
        token: getToken() || undefined,
      });
      setLocalBank(null);
      setShowBankForm(false);
      toast("Bank account removed", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove bank account", "error");
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawCampaignId) {
      toast("Select a campaign", "error");
      return;
    }
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      toast("Enter a valid amount", "error");
      return;
    }
    if (selectedCampaign && amount > selectedCampaign.earned) {
      toast(`You can only withdraw up to ₦${selectedCampaign.earned.toLocaleString()}`, "error");
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiRequest<{ message: string }>("/creators/withdrawals", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ campaignId: withdrawCampaignId, amount }),
      });
      toast(data.message || "Withdrawal request submitted", "success");
      setShowWithdraw(false);
      setWithdrawCampaignId("");
      setWithdrawAmount("");
      fetchWithdrawals();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not submit withdrawal", "error");
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium text-stone-500">Bank Account</span>
          {hasBankAccount && (
            <div className="flex items-center gap-3">
              <button onClick={() => setShowBankForm(true)} className="text-[11px] font-medium text-stone-500 underline">
                Change
              </button>
              <button onClick={handleRemoveBank} className="text-[11px] font-medium text-red-500 underline">
                Remove
              </button>
            </div>
          )}
        </div>
        {hasBankAccount ? (
          <div>
            <p className="font-rethink text-sm font-medium text-stone-800">{bankAccountName}</p>
            <p className="font-rethink text-xs text-stone-500">{bankDisplay}</p>
          </div>
        ) : showBankForm ? (
          <div className="space-y-3">
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Account number"
              inputMode="numeric"
              className="w-full bg-white border border-stone-200 rounded-full px-4 py-2.5 text-sm font-rethink text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400"
            />
            <select
              value={bankCode}
              onChange={(e) => setBankCode(e.target.value)}
              className="w-full bg-white border border-stone-200 rounded-full px-4 py-2.5 text-sm font-rethink text-stone-900 outline-none focus:border-stone-400"
            >
              <option value="">Select your bank</option>
              {banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleSaveBank}
                disabled={savingBank}
                className="flex-1 py-2.5 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
              >
                {savingBank ? "Saving…" : "Save Account"}
              </button>
              <button
                onClick={() => setShowBankForm(false)}
                className="px-4 py-2.5 border border-stone-200 text-stone-600 font-semibold text-sm rounded-full font-rethink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowBankForm(true)}
            className="mt-1 w-full py-2.5 border border-stone-300 text-stone-700 font-semibold text-sm rounded-full font-rethink"
          >
            Add Bank Account
          </button>
        )}
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
        onClick={() => setShowWithdraw(true)}
        disabled={!hasBankAccount || eligibleCampaigns.length === 0}
        className="w-full py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
      >
        Withdraw Funds
      </button>
      {!hasBankAccount && (
        <p className="text-[11px] text-stone-500 mt-2 font-medium">
          Add your bank account above to withdraw earnings.
        </p>
      )}
      {hasBankAccount && eligibleCampaigns.length === 0 && (
        <p className="text-[11px] text-stone-500 mt-2 font-medium">
          You need earned views on a campaign before you can withdraw.
        </p>
      )}

      {withdrawals.length > 0 && (
        <div className="mt-6 text-left">
          <span className="text-[10px] font-medium text-stone-500">Withdrawal History</span>
          <div className="mt-2 space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="bg-stone-50 border border-stone-200/50 rounded-xl p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-rethink font-medium text-stone-800 truncate">{w.campaignName}</span>
                  <span className="font-rethink font-medium text-stone-900">₦{w.amount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                      w.status === "released" && "bg-green-50 text-green-700 border border-green-100",
                      w.status === "pending" && "bg-amber-50 text-amber-700 border border-amber-100",
                      w.status === "rejected" && "bg-red-50 text-red-700 border border-red-100"
                    )}
                  >
                    {STATUS_LABEL[w.status] || w.status}
                  </span>
                  <span className="text-[11px] text-stone-400 font-medium">
                    {new Date(w.requestedAt).toLocaleDateString()}
                  </span>
                </div>
                {w.adminNotes && <p className="text-[11px] text-stone-500 mt-1 font-medium">{w.adminNotes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showWithdraw && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-950/40 p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-left">
            <h3 className="font-rethink font-medium text-lg text-stone-900 mb-4">Request Withdrawal</h3>
            <label className="text-[11px] font-medium text-stone-500">Campaign</label>
            <select
              value={withdrawCampaignId}
              onChange={(e) => {
                setWithdrawCampaignId(e.target.value);
                const c = pendingByCampaign.find((x) => x.id === e.target.value);
                setWithdrawAmount(c ? String(c.earned) : "");
              }}
              className="w-full bg-white border border-stone-200 rounded-full px-4 py-2.5 text-sm font-rethink text-stone-900 outline-none focus:border-stone-400 mt-1 mb-3"
            >
              <option value="">Select campaign</option>
              {eligibleCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} — ₦{c.earned.toLocaleString()} ({c.views.toLocaleString()} views)
                </option>
              ))}
            </select>
            {selectedCampaign && (
              <p className="text-[11px] text-stone-500 mb-3 font-medium">
                Earned: ₦{selectedCampaign.earned.toLocaleString()} · {selectedCampaign.views.toLocaleString()} /{" "}
                {selectedCampaign.viewTarget.toLocaleString()} views
              </p>
            )}
            <label className="text-[11px] font-medium text-stone-500">Amount (₦)</label>
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="0"
              className="w-full bg-white border border-stone-200 rounded-full px-4 py-2.5 text-sm font-rethink text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-400 mt-1 mb-3"
            />
            <p className="text-[11px] text-stone-500 mb-4 font-medium">
              Withdrawals take up to 24 hours to process. Funds are sent to your saved bank account.
            </p>
            <button
              onClick={handleWithdraw}
              disabled={submitting}
              className="w-full py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400 mb-2"
            >
              {submitting ? "Submitting…" : "Request Withdrawal"}
            </button>
            <button
              onClick={() => setShowWithdraw(false)}
              className="w-full py-3 border border-stone-200 text-stone-600 font-semibold text-sm rounded-full font-rethink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
