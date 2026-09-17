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

type WithdrawCampaign = NonNullable<WalletData["withdrawCampaigns"]>[number];

// Payout appeals (D23): a rejected withdrawal or voided pay can be appealed within 7 days.
interface AppealableItem {
  subjectType: "withdrawal" | "fixed_void";
  subjectId: string;
  campaignId: string;
  campaignName: string;
  amount: number;
  decisionReason: string | null;
  decidedAt: string;
  appealableUntil: string;
}

interface PayoutAppealItem {
  id: string;
  subjectType: "withdrawal" | "fixed_void";
  campaignName: string;
  amount: number;
  reason: string;
  status: "open" | "granted" | "denied";
  resolutionNote: string | null;
  createdAt: string;
}

const APPEAL_SUBJECT: Record<AppealableItem["subjectType"], string> = {
  withdrawal: "Rejected withdrawal",
  fixed_void: "Pay removed: content not delivered",
};

const APPEAL_STATUS: Record<PayoutAppealItem["status"], string> = {
  open: "Under Review",
  granted: "Granted",
  denied: "Decision Stands",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  rejected: "Rejected",
  released: "Released",
};

function formatPayoutDay(iso?: string | null) {
  if (!iso) return "Friday";
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Lagos",
  });
}

const POT_LABEL: Record<"fixed" | "referral" | "bonus", string> = {
  fixed: "Fixed Pay On Hold",
  referral: "Referral Pay On Hold",
  bonus: "Bonus On Hold",
};

// A hybrid campaign's fixed pay is its base pay (ticket 10).
const isHybrid = (c: { payShape?: string | null }) => c.payShape === "hybrid";

const roundKobo = (value: number) => Math.round(value * 100) / 100;

// "₦15,000 unlocks 12 November, ₦7,500 later": the next unlock with its own amount.
function unlockText(unlocks: Array<{ date: string; amount: number }>) {
  if (unlocks.length === 0) return null;
  const [next, ...rest] = unlocks;
  const later = roundKobo(rest.reduce((sum, u) => sum + u.amount, 0));
  return `₦${next.amount.toLocaleString()} unlocks ${formatHoldDate(next.date)}${later > 0 ? `, ₦${later.toLocaleString()} later` : ""}`;
}

function formatHoldDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });
}

// What a campaign has ready to withdraw, pot by pot: fixed pay, performance (views) pay, referral pay.
function availableParts(c: WithdrawCampaign) {
  const parts: string[] = [];
  if ((c.earnings?.fixed ?? 0) > 0 || (c.fixedAvailable ?? 0) > 0) parts.push(`${isHybrid(c) ? "Base" : "Fixed"} ₦${(c.fixedAvailable ?? 0).toLocaleString()}`);
  if (isHybrid(c) || (c.bonusAvailable ?? 0) > 0) parts.push(`Bonus ₦${(c.bonusAvailable ?? 0).toLocaleString()}`);
  parts.push(`Performance ₦${c.viewsAvailable.toLocaleString()}`);
  parts.push(`Referrals ₦${c.referralAvailable.toLocaleString()}`);
  return parts.join(" · ");
}

// "paid on Friday 18 September", or, once that Friday has come, that it's in the payout run.
function payoutTiming(iso?: string | null) {
  if (iso && new Date(iso).getTime() <= Date.now()) return "in this week's payout run";
  return `paid on ${formatPayoutDay(iso)}`;
}

export function WalletView({ profile, walletData }: WalletViewProps) {
  useReveal();
  const { toast } = useToast();

  const withdrawCampaigns = walletData?.withdrawCampaigns ?? [];
  // Withdrawals carry fixed, views and referral pay together, so the headline does too.
  const withdrawable = walletData?.withdrawCampaigns
    ? Math.round(withdrawCampaigns.reduce((sum, c) => sum + c.total, 0) * 100) / 100
    : (walletData?.withdrawableBalance ?? walletData?.balance ?? 0);
  const pending = walletData?.pendingBalance ?? 0;
  const viewsByCampaign = walletData?.viewsByCampaign ?? [];
  const lifetimeEarnings = walletData?.lifetimeEarnings ?? profile.lifetimeEarnings;
  const completionRate = walletData?.completionRate ?? profile.completionRate;
  const totalReleased = walletData?.totalReleased ?? 0;
  const minimum = walletData?.payoutSchedule?.minimumPerCampaign ?? 2000;
  const nextPayoutDay = formatPayoutDay(walletData?.payoutSchedule?.nextPayoutDate);
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

  const [confirmCampaign, setConfirmCampaign] = React.useState<WithdrawCampaign | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [withdrawals, setWithdrawals] = React.useState<WithdrawalItem[]>([]);
  // Shows a request on its campaign right away, before the wallet reloads.
  const [justRequested, setJustRequested] = React.useState<Record<string, { amount: number; payoutDate: string }>>({});

  // Referral earnings: held 7 days per conversion, then withdrawable with the campaign's views earnings.
  const referral = walletData?.referral;
  const referralCampaigns = referral?.byCampaign ?? [];

  // Fixed pay: credited per deliverable, withdrawable once delivery is confirmed and 7 days have passed.
  const fixed = walletData?.fixed;
  const fixedCampaigns = fixed?.byCampaign ?? [];

  // Hybrid bonus: credited as views or conversions are verified, withdrawable after its 7-day hold.
  const bonus = walletData?.bonus;
  const bonusCampaigns = bonus?.byCampaign ?? [];
  const hybridIds = new Set(withdrawCampaigns.filter(isHybrid).map((c) => String(c.id)));

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

  const [appealable, setAppealable] = React.useState<AppealableItem[]>([]);
  const [appeals, setAppeals] = React.useState<PayoutAppealItem[]>([]);
  const [appealing, setAppealing] = React.useState<AppealableItem | null>(null);
  const [appealReason, setAppealReason] = React.useState("");
  const [appealError, setAppealError] = React.useState("");
  const [sendingAppeal, setSendingAppeal] = React.useState(false);

  const fetchAppeals = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ appeals: PayoutAppealItem[]; appealable: AppealableItem[] }>("/creators/payout-appeals", {
        token: getToken() || undefined,
      });
      setAppeals(data.appeals || []);
      setAppealable(data.appealable || []);
    } catch {
      // best-effort
    }
  }, []);

  const handleAppeal = async () => {
    if (!appealing) return;
    if (appealReason.trim().length < 10) {
      setAppealError("Say why the decision should be reviewed (at least 10 characters).");
      return;
    }
    setSendingAppeal(true);
    setAppealError("");
    try {
      const data = await apiRequest<{ message: string }>("/creators/payout-appeals", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ subjectType: appealing.subjectType, subjectId: appealing.subjectId, reason: appealReason.trim() }),
      });
      toast(data.message || "Appeal sent", "success");
      setAppealing(null);
      setAppealReason("");
      fetchAppeals();
    } catch (err) {
      setAppealError(err instanceof Error ? err.message : "Could not send the appeal");
    } finally {
      setSendingAppeal(false);
    }
  };

  React.useEffect(() => {
    fetchWithdrawals();
    fetchBanks();
    fetchAppeals();
  }, [fetchWithdrawals, fetchBanks, fetchAppeals]);

  React.useEffect(() => {
    if (!confirmCampaign) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) setConfirmCampaign(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmCampaign, submitting]);

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
    if (!confirmCampaign) return;
    setSubmitting(true);
    try {
      const data = await apiRequest<{ message: string; amount: number; payoutDate: string }>("/creators/withdrawals", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ campaignId: confirmCampaign.id }),
      });
      toast(data.message || "Withdrawal requested", "success");
      setJustRequested((prev) => ({ ...prev, [confirmCampaign.id]: { amount: data.amount, payoutDate: data.payoutDate } }));
      setConfirmCampaign(null);
      fetchWithdrawals();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not request the withdrawal", "error");
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

      {/* Weekly per-campaign withdrawals */}
      <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
        <div className="space-y-0.5">
          <span className="text-[10px] font-medium text-stone-500 block">Withdraw by campaign</span>
          <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
            Once a week per campaign, fixed, performance and referral pay together. Requests are paid on {nextPayoutDay}. Minimum ₦
            {minimum.toLocaleString()} per campaign.
          </p>
        </div>
        {!hasBankAccount && (
          <p className="font-rethink text-[11px] text-stone-500 font-medium">Add your bank account above to withdraw.</p>
        )}
        {withdrawCampaigns.length === 0 ? (
          <p className="font-rethink text-xs text-stone-500 font-medium">
            Earnings from views, and fixed and referral pay past their 7-day hold, show up here.
          </p>
        ) : (
          <div className="space-y-2.5">
            {withdrawCampaigns.map((c) => {
              const requested =
                justRequested[c.id] || (c.state === "requested" && c.requested ? c.requested : null);
              const state = justRequested[c.id] ? "requested" : c.state;
              return (
                <div key={c.id} className="bg-white border border-stone-200/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-rethink text-sm font-medium text-stone-800 truncate">{c.title}</p>
                      <p className="font-rethink text-xs text-stone-500">{availableParts(c)}</p>
                    </div>
                    <span className="font-rethink text-sm font-medium text-stone-900 shrink-0">₦{c.total.toLocaleString()}</span>
                  </div>
                  {(c.onHold ?? []).length > 0 && (
                    <ul className="space-y-0.5">
                      {(c.onHold ?? []).map((hold) => (
                        <li
                          key={`${hold.pot}-${hold.until ?? hold.reason}`}
                          className="font-rethink text-[11px] font-medium text-stone-500 flex justify-between gap-3"
                        >
                          <span>
                            {hold.pot === "fixed" && isHybrid(c) ? "Base Pay On Hold" : POT_LABEL[hold.pot]} · {hold.until ? `Unlocks ${formatHoldDate(hold.until)}` : hold.reason}
                          </span>
                          <span className="tabular-nums shrink-0">₦{hold.amount.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.payoutDate && ["available", "below_minimum", "nothing_yet"].includes(state) && (
                    <p className="font-rethink text-[11px] font-medium text-stone-400">
                      Payout Day: {formatPayoutDay(c.payoutDate)}
                    </p>
                  )}
                  {state === "available" && (
                    <button
                      onClick={() => setConfirmCampaign(c)}
                      disabled={!hasBankAccount}
                      className="w-full py-2 bg-[#FEB604] text-stone-950 font-semibold text-xs rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
                    >
                      Withdraw ₦{c.total.toLocaleString()}
                    </button>
                  )}
                  {state === "requested" && requested && (
                    <p className="font-rethink text-[11px] font-medium text-blue-700">
                      ₦{requested.amount.toLocaleString()} requested · {payoutTiming(requested.payoutDate)}
                    </p>
                  )}
                  {state === "withdrawn_this_week" && (
                    <p className="font-rethink text-[11px] font-medium text-stone-500">
                      Withdrawn this week. You can withdraw again from {nextPayoutDay}.
                    </p>
                  )}
                  {state === "below_minimum" && (
                    <p className="font-rethink text-[11px] font-medium text-stone-500">
                      Reach ₦{minimum.toLocaleString()} to withdraw. Your ₦{c.total.toLocaleString()} carries over.
                    </p>
                  )}
                  {state === "nothing_yet" && c.referralOnHold > 0 && !c.onHold && (
                    <p className="font-rethink text-[11px] font-medium text-stone-500">
                      ₦{c.referralOnHold.toLocaleString()} of referral earnings is in its 7-day hold.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {viewsByCampaign.length > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-stone-500">View earnings by campaign</span>
            {pending > 0 && (
              <span className="text-[10px] font-medium text-stone-500">
                ₦{pending.toLocaleString()} waiting on campaign review
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {viewsByCampaign.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-rethink font-medium text-stone-800 truncate">{c.title}</p>
                  <p className="font-rethink text-xs text-stone-500">
                    {(c.views || 0).toLocaleString()} / {(c.viewTarget || 0).toLocaleString()} views · ₦{c.earned.toLocaleString()} earned
                    {c.withdrawn > 0 && ` · ₦${c.withdrawn.toLocaleString()} withdrawn`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-rethink font-medium text-stone-900 block">₦{c.availableToWithdraw.toLocaleString()}</span>
                  <span className="font-rethink text-[10px] text-stone-500">{c.withdrawable ? "available" : "not yet withdrawable"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fixedCampaigns.length > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-stone-500">{bonusCampaigns.length > 0 ? "Fixed and Base Pay" : "Fixed Pay"}</span>
            <span className="font-rethink text-sm font-medium text-stone-900">₦{(fixed?.earned ?? 0).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">On Hold</span>
              <span className="font-rethink text-sm font-medium text-stone-900">
                ₦{roundKobo((fixed?.awaitingDelivery ?? 0) + (fixed?.onHold ?? 0)).toLocaleString()}
              </span>
            </div>
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">Withdrawable</span>
              <span className="font-rethink text-sm font-medium text-green-700">₦{(fixed?.availableToWithdraw ?? 0).toLocaleString()}</span>
            </div>
          </div>
          <div className="space-y-2.5">
            {fixedCampaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-rethink font-medium text-stone-800 truncate">{c.title}</p>
                  <p className="font-rethink text-xs text-stone-500">
                    {hybridIds.has(String(c.id)) && "Base pay · "}
                    {c.deliverables} deliverable{c.deliverables === 1 ? "" : "s"}
                    {c.awaitingDelivery > 0 && ` · ₦${c.awaitingDelivery.toLocaleString()} waiting for the brand to confirm delivery`}
                    {c.onHold > 0 && (c.unlocks ?? []).length > 0 && ` · ${unlockText(c.unlocks ?? [])}`}
                    {c.withdrawn > 0 && ` · ₦${c.withdrawn.toLocaleString()} withdrawn`}
                  </p>
                </div>
                <span className="font-rethink font-medium text-stone-900 shrink-0">₦{c.earned.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {bonusCampaigns.length > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-stone-500">Bonus</span>
            <span className="font-rethink text-sm font-medium text-stone-900">₦{(bonus?.earned ?? 0).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">On Hold ({bonus?.holdDays ?? 7} Days)</span>
              <span className="font-rethink text-sm font-medium text-stone-900">₦{(bonus?.onHold ?? 0).toLocaleString()}</span>
            </div>
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">Withdrawable</span>
              <span className="font-rethink text-sm font-medium text-green-700">₦{(bonus?.availableToWithdraw ?? 0).toLocaleString()}</span>
            </div>
          </div>
          <div className="space-y-2.5">
            {bonusCampaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-rethink font-medium text-stone-800 truncate">{c.title}</p>
                  <p className="font-rethink text-xs text-stone-500">
                    Performance bonus
                    {c.onHold > 0 && (c.unlocks ?? []).length > 0 && ` · ${unlockText(c.unlocks ?? [])}`}
                    {c.withdrawn > 0 && ` · ₦${c.withdrawn.toLocaleString()} withdrawn`}
                  </p>
                </div>
                <span className="font-rethink font-medium text-stone-900 shrink-0">₦{c.earned.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {referralCampaigns.length > 0 && (
        <div className="bg-stone-50 border border-stone-200/50 rounded-2xl p-4 mb-6 text-left space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-stone-500">Referral earnings</span>
            <span className="font-rethink text-sm font-medium text-stone-900">₦{(referral?.earned ?? 0).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">On Hold ({referral?.holdDays ?? 7} Days)</span>
              <span className="font-rethink text-sm font-medium text-stone-900">₦{(referral?.pending ?? 0).toLocaleString()}</span>
            </div>
            <div className="bg-white border border-stone-200/60 rounded-xl px-3 py-2">
              <span className="text-[10px] font-medium text-stone-500 block">Withdrawable</span>
              <span className="font-rethink text-sm font-medium text-green-700">₦{(referral?.availableToWithdraw ?? 0).toLocaleString()}</span>
            </div>
          </div>
          <div className="space-y-2.5">
            {referralCampaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-rethink font-medium text-stone-800 truncate">{c.title}</p>
                  <p className="font-rethink text-xs text-stone-500">
                    {c.rewardPerConversion > 0
                      ? `${c.paidConversions.toLocaleString()} paid × ₦${c.rewardPerConversion.toLocaleString()}`
                      : "Reward being set by Easily Promote"}
                    {c.pending > 0 && ` · ₦${c.pending.toLocaleString()} on hold`}
                  </p>
                </div>
                <span className="font-rethink font-medium text-stone-900 shrink-0">₦{c.earned.toLocaleString()}</span>
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

      {withdrawals.length > 0 && (
        <div className="mt-6 text-left">
          <span className="text-[10px] font-medium text-stone-500">Withdrawal History</span>
          <div className="mt-2 space-y-2">
            {withdrawals.map((w) => (
              <div key={w.id} className="bg-stone-50 border border-stone-200/50 rounded-xl p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-rethink font-medium text-stone-800 truncate">
                    {w.campaignName}
                    {w.kind === "referral" && (
                      <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#EBF3FF] text-blue-800 align-middle">
                        Referral
                      </span>
                    )}
                  </span>
                  <span className="font-rethink font-medium text-stone-900">₦{w.amount.toLocaleString()}</span>
                </div>
                {w.kind === "campaign" && (
                  <p className="font-rethink text-[11px] text-stone-500 font-medium mt-0.5">
                    {(w.fixedAmount ?? 0) > 0 && `Fixed ₦${(w.fixedAmount ?? 0).toLocaleString()} · `}
                    {(w.bonusAmount ?? 0) > 0 && `Bonus ₦${(w.bonusAmount ?? 0).toLocaleString()} · `}
                    Views ₦{(w.viewsAmount ?? 0).toLocaleString()} · Referrals ₦{(w.referralAmount ?? 0).toLocaleString()}
                  </p>
                )}
                <div className="flex items-center justify-between mt-0.5">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                      w.status === "released" && "bg-green-50 text-green-700 border border-green-100",
                      w.status === "pending" && "bg-amber-50 text-amber-700 border border-amber-100",
                      w.status === "processing" && "bg-blue-50 text-blue-700 border border-blue-100",
                      w.status === "rejected" && "bg-red-50 text-red-700 border border-red-100"
                    )}
                  >
                    {STATUS_LABEL[w.status] || w.status}
                  </span>
                  <span className="text-[11px] text-stone-400 font-medium">
                    {w.payoutDate
                      ? payoutTiming(w.payoutDate).replace(/^./, (c) => c.toUpperCase())
                      : new Date(w.requestedAt).toLocaleDateString()}
                  </span>
                </div>
                {w.adminNotes && <p className="text-[11px] text-stone-500 mt-1 font-medium">{w.adminNotes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(appealable.length > 0 || appeals.length > 0) && (
        <div className="mt-6 text-left">
          <span className="text-[10px] font-medium text-stone-500">Payout Appeals</span>
          <p className="font-rethink text-[11px] text-stone-400 font-medium mt-0.5">
            If a withdrawal was rejected or pay was removed and you think that&apos;s wrong, you have 7 days to appeal.
          </p>
          <div className="mt-2 space-y-2">
            {appealable.map((item) => (
              <div key={`${item.subjectType}-${item.subjectId}`} className="bg-stone-50 border border-stone-200/50 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-rethink font-medium text-stone-800 truncate">{item.campaignName}</span>
                  {item.amount > 0 && <span className="font-rethink font-medium text-stone-900">₦{item.amount.toLocaleString()}</span>}
                </div>
                <p className="font-rethink text-[11px] text-stone-500 font-medium">
                  {APPEAL_SUBJECT[item.subjectType]}
                  {item.decisionReason && `: ${item.decisionReason}`}
                </p>
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-stone-400 font-medium">Appeal by {formatHoldDate(item.appealableUntil)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppealReason("");
                      setAppealError("");
                      setAppealing(item);
                    }}
                    className="px-4 py-1.5 bg-white border border-stone-200 rounded-full font-rethink font-semibold text-xs text-stone-900"
                  >
                    Appeal
                  </button>
                </div>
              </div>
            ))}
            {appeals.map((appeal) => (
              <div key={appeal.id} className="bg-stone-50 border border-stone-200/50 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-rethink font-medium text-stone-800 truncate">{appeal.campaignName}</span>
                  <span
                    className={cn(
                      "text-[10px] font-medium px-2 py-0.5 rounded-full border",
                      appeal.status === "open" && "bg-amber-50 text-amber-700 border-amber-100",
                      appeal.status === "granted" && "bg-green-50 text-green-700 border-green-100",
                      appeal.status === "denied" && "bg-stone-100 text-stone-600 border-stone-200"
                    )}
                  >
                    {APPEAL_STATUS[appeal.status]}
                  </span>
                </div>
                <p className="font-rethink text-[11px] text-stone-500 font-medium">
                  {APPEAL_SUBJECT[appeal.subjectType]}
                  {appeal.amount > 0 && ` · ₦${appeal.amount.toLocaleString()}`} · appealed {new Date(appeal.createdAt).toLocaleDateString()}
                </p>
                {appeal.resolutionNote && <p className="font-rethink text-[11px] text-stone-600 font-medium">{appeal.resolutionNote}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {appealing && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-950/40 p-4"
          onClick={() => !sendingAppeal && setAppealing(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appeal-heading"
            className="bg-white rounded-3xl p-6 w-full max-w-sm text-left space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="appeal-heading" className="font-rethink font-medium text-lg text-stone-900">
                Appeal this decision?
              </h3>
              <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
                {APPEAL_SUBJECT[appealing.subjectType]} on {appealing.campaignName}. Our team reviews it and tells you the outcome. You can appeal
                each decision once.
              </p>
            </div>
            <label className="block space-y-1">
              <span className="font-rethink text-[11px] font-medium text-stone-500">Why should it be reviewed?</span>
              <textarea
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                rows={4}
                maxLength={2000}
                className="w-full rounded-xl border border-stone-200 px-3 py-2 font-rethink text-sm font-medium text-stone-900 outline-none focus:border-stone-400"
              />
            </label>
            {appealError && <p className="font-rethink text-xs text-red-600 font-medium">{appealError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setAppealing(null)}
                disabled={sendingAppeal}
                className="flex-1 py-3 border border-stone-200 text-stone-600 font-semibold text-sm rounded-full font-rethink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAppeal}
                disabled={sendingAppeal}
                className="flex-1 py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
              >
                {sendingAppeal ? "Sending…" : "Send appeal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmCampaign && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-950/40 p-4"
          onClick={() => !submitting && setConfirmCampaign(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-heading"
            className="bg-white rounded-3xl p-6 w-full max-w-sm text-left space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="withdraw-heading" className="font-rethink font-medium text-lg text-stone-900">
                Withdraw from {confirmCampaign.title}?
              </h3>
              <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
                Paid on {nextPayoutDay} to {bankDisplay}. You can withdraw from this campaign again next week.
              </p>
            </div>
            <dl className="bg-stone-50 rounded-2xl p-4 space-y-2 text-sm font-rethink">
              {(confirmCampaign.fixedAvailable ?? 0) > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500 font-medium">{isHybrid(confirmCampaign) ? "Base Pay" : "Fixed Pay"}</dt>
                  <dd className="text-stone-900 font-medium tabular-nums">₦{(confirmCampaign.fixedAvailable ?? 0).toLocaleString()}</dd>
                </div>
              )}
              {(confirmCampaign.bonusAvailable ?? 0) > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-500 font-medium">Bonus</dt>
                  <dd className="text-stone-900 font-medium tabular-nums">₦{(confirmCampaign.bonusAvailable ?? 0).toLocaleString()}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500 font-medium">Views earnings</dt>
                <dd className="text-stone-900 font-medium tabular-nums">₦{confirmCampaign.viewsAvailable.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500 font-medium">Referral earnings</dt>
                <dd className="text-stone-900 font-medium tabular-nums">₦{confirmCampaign.referralAvailable.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-stone-200 pt-2">
                <dt className="text-stone-900 font-semibold">Total</dt>
                <dd className="text-stone-900 font-semibold tabular-nums">₦{confirmCampaign.total.toLocaleString()}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmCampaign(null)}
                disabled={submitting}
                className="flex-1 py-3 border border-stone-200 text-stone-600 font-semibold text-sm rounded-full font-rethink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                disabled={submitting}
                className="flex-1 py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink disabled:bg-stone-200 disabled:text-stone-400"
              >
                {submitting ? "Requesting…" : "Request withdrawal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
