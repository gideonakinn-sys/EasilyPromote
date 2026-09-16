"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Skeleton } from "./ui/skeleton";
import { useReferralConversions } from "../lib/socket";
import {
  CODE_SOURCE_OPTIONS,
  MIN_REFERRAL_BUDGET,
  REFERRAL_EVENT_TYPES,
  conversionNounFor,
  downloadReferralCodesCsv,
  formatNaira,
  referralApi,
  type SettingsChanges,
  type ReferralCodeRow,
  type ReferralCodeSource,
  type ReferralCodesPayload,
  type ReferralEventType,
  type ReferralSettings,
} from "../lib/referral";

const STATUS_CHIPS: Record<ReferralCodeRow["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "bg-[#CBF5E5] text-[#176448]" },
  awaiting_business: { label: "Pending", className: "bg-amber-50 text-amber-800" },
  missing: { label: "No code yet", className: "bg-stone-100 text-stone-500" },
  disabled: { label: "Disabled", className: "bg-red-50 text-red-700" },
};

function settingsEventTypes(settings: Pick<ReferralSettings, "eventType" | "eventTypes"> | null | undefined): ReferralEventType[] {
  if (settings?.eventTypes?.length) return settings.eventTypes;
  return [settings?.eventType || "signup"];
}

const DEFAULT_SETTINGS: ReferralSettings = {
  enabled: false,
  eventType: "signup",
  eventTypes: ["signup"],
  codeSource: "easilypromote",
  conversions: 0,
  rewardPerConversion: 0,
  requestedBudget: 0,
  budget: 0,
  platformFee: 0,
  platformFeePercent: 30,
  pool: 0,
  poolRemaining: 0,
  earned: 0,
  budgetExhausted: false,
};

const FUNDABLE_STATUSES = ["live", "paused", "under_review"];

interface ReferralSettingsFieldsProps {
  eventTypes: ReferralEventType[];
  codeSource: ReferralCodeSource;
  onEventTypesChange: (value: ReferralEventType[]) => void;
  onCodeSourceChange: (value: ReferralCodeSource) => void;
  disabled?: boolean;
  // New campaigns always use Easily Promote codes; the choice stays for campaigns already on their own codes.
  showCodeSource?: boolean;
}

export function ReferralSettingsFields({
  eventTypes,
  codeSource,
  onEventTypesChange,
  onCodeSourceChange,
  disabled,
  showCodeSource = false,
}: ReferralSettingsFieldsProps) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-medium text-stone-500 font-rethink mb-2">What counts as a conversion? Pick all that apply.</legend>
        <div className="flex flex-wrap gap-2">
          {REFERRAL_EVENT_TYPES.map((option) => {
            const selected = eventTypes.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  // At least one type always stays selected.
                  onEventTypesChange(
                    selected
                      ? eventTypes.length > 1
                        ? eventTypes.filter((type) => type !== option.value)
                        : eventTypes
                      : [...eventTypes, option.value]
                  )
                }
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium font-rethink transition-colors disabled:opacity-50",
                  selected ? "bg-stone-900 text-white" : "bg-white text-stone-600 border border-stone-200"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {showCodeSource && (
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-medium text-stone-500 font-rethink mb-2">Who creates the codes?</legend>
        <div className="grid gap-2">
          {CODE_SOURCE_OPTIONS.map((option) => {
            const selected = codeSource === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onCodeSourceChange(option.value)}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-2xl border transition-colors disabled:opacity-50",
                  selected ? "border-stone-900 bg-stone-50" : "border-stone-200 bg-white"
                )}
              >
                <span className="block text-sm font-medium text-stone-900 font-rethink">{option.label}</span>
                <span className="block text-xs font-medium text-stone-500 font-rethink mt-0.5 leading-relaxed">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      )}
    </div>
  );
}

interface CampaignReferralsProps {
  campaignId: string;
  campaignStatus: string;
  initialSettings?: ReferralSettings;
  // Set when the brand returns from paying for referral budget on Paystack.
  topupReference?: string | null;
  onTopupHandled?: () => void;
}

export function CampaignReferrals({
  campaignId,
  campaignStatus,
  initialSettings,
  topupReference,
  onTopupHandled,
}: CampaignReferralsProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ReferralSettings>(initialSettings || DEFAULT_SETTINGS);
  const [draftEventTypes, setDraftEventTypes] = useState<ReferralEventType[]>(settingsEventTypes(initialSettings));
  const [draftCodeSource, setDraftCodeSource] = useState<ReferralCodeSource>(
    initialSettings?.codeSource || "easilypromote"
  );
  const [data, setData] = useState<ReferralCodesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [markingLoaded, setMarkingLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);

  const isCancelled = campaignStatus === "cancelled";

  const fetchCodes = useCallback(async () => {
    setError("");
    try {
      const payload = await referralApi.listCodes(campaignId);
      setData(payload);
      setSettings(payload.referral);
      setDraftEventTypes(settingsEventTypes(payload.referral));
      setDraftCodeSource(payload.referral.codeSource);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load referral codes");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  // The server can deliver the same event more than once, so apply the change in the
  // code's absolute count rather than adding one per event.
  useReferralConversions((update) => {
    if (update.campaignId !== campaignId) return;
    setData((prev) => {
      if (!prev) return prev;
      const row = prev.codes.find((code) => code.codeId === update.referralCodeId);
      const delta = row ? Math.max(0, update.conversions - row.conversions) : 0;
      return {
        ...prev,
        summary: { ...prev.summary, conversions: prev.summary.conversions + delta },
        codes: prev.codes.map((code) =>
          code.codeId === update.referralCodeId ? { ...code, conversions: update.conversions, status: "active" } : code
        ),
      };
    });
  });

  // Confirm a referral budget payment once, when the brand lands back here from Paystack.
  useEffect(() => {
    if (!topupReference) return;
    let active = true;
    referralApi
      .confirmReferralBudget(campaignId, topupReference)
      .then((result) => {
        if (!active) return;
        setSettings(result.referral);
        toast(`${formatNaira(result.amount)} added to your referral budget.`, "success");
        fetchCodes();
      })
      .catch((err: unknown) => {
        if (active) toast(err instanceof Error ? err.message : "Couldn't confirm your referral budget payment", "error");
      })
      .finally(() => onTopupHandled?.());
    return () => {
      active = false;
    };
    // Runs once per returned payment reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupReference]);

  const saveSettings = async (changes: SettingsChanges, successMessage: string) => {
    setSavingSettings(true);
    try {
      const result = await referralApi.updateSettings(campaignId, changes);
      setSettings(result.referral);
      const issued = result.codesCreated > 0
        ? ` ${result.codesCreated} new code${result.codesCreated === 1 ? "" : "s"} issued.`
        : "";
      toast(`${successMessage}${issued}`, "success");
      await fetchCodes();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not save referral settings", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleFund = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Math.round(Number(fundAmount || 0));
    if (!Number.isFinite(amount) || amount < MIN_REFERRAL_BUDGET) {
      toast(`Add at least ${formatNaira(MIN_REFERRAL_BUDGET)}`, "error");
      return;
    }
    setFunding(true);
    try {
      const payment = await referralApi.startReferralBudget(campaignId, amount);
      window.location.href = payment.authorization_url;
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't start the payment", "error");
      setFunding(false);
    }
  };

  const handleTurnOff = () => {
    if (!window.confirm("Turn off referral tracking? Codes stop counting new conversions until you turn it back on.")) return;
    saveSettings({ enabled: false }, "Referral tracking is off.");
  };

  const handleMarkLoaded = async () => {
    setMarkingLoaded(true);
    try {
      const result = await referralApi.markLoaded(campaignId);
      toast(`${result.updated} code${result.updated === 1 ? "" : "s"} marked as active`, "success");
      await fetchCodes();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not update codes", "error");
    } finally {
      setMarkingLoaded(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadReferralCodesCsv(campaignId);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not download codes", "error");
    } finally {
      setDownloading(false);
    }
  };

  const startEditing = (row: ReferralCodeRow) => {
    setEditingSlotId(row.slotId);
    setCodeInput(row.code || "");
  };

  const handleSaveCode = async (slotId: string) => {
    if (!codeInput.trim()) return;
    setSavingCode(true);
    try {
      const saved = await referralApi.setCode(campaignId, slotId, codeInput);
      toast(`Code ${saved.code} saved`, "success");
      setEditingSlotId(null);
      await fetchCodes();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not save code", "error");
    } finally {
      setSavingCode(false);
    }
  };

  const handleImport = async () => {
    if (!importCsv.trim()) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const result = await referralApi.importCodes(campaignId, importCsv);
      setImportErrors(
        result.results
          .filter((row) => row.status === "error")
          .map((row) => `Row ${row.row}${row.creatorUsername ? ` (@${row.creatorUsername})` : ""}: ${row.error}`)
      );
      if (result.saved > 0) {
        toast(`${result.saved} code${result.saved === 1 ? "" : "s"} imported`, "success");
        await fetchCodes();
      }
      if (result.failed === 0) {
        setImportCsv("");
        setImportOpen(false);
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not import codes", "error");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
        <Skeleton className="h-28 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-4 flex flex-col items-center">
        <h3 className="font-rethink font-medium text-lg text-stone-900">Referral codes didn&apos;t load</h3>
        <p className="font-rethink text-xs text-stone-500 font-medium">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            fetchCodes();
          }}
          className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium font-rethink rounded-full"
        >
          Try again
        </button>
      </div>
    );
  }

  const header = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-rethink font-semibold text-base text-stone-900 tracking-tight">Referral tracking</h3>
        {settings.enabled && (
          <button
            onClick={handleTurnOff}
            disabled={savingSettings || isCancelled}
            className="text-xs font-medium text-stone-500 font-rethink disabled:opacity-50"
          >
            Turn off
          </button>
        )}
      </div>
      <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
        Every creator gets a unique code. Your servers tell us when someone converts with it, so you see results per
        creator. Creators keep earning on views either way.
      </p>
    </div>
  );

  if (!settings.enabled) {
    return (
      <div className="space-y-6">
        {header}
        {isCancelled ? (
          <p className="font-rethink text-xs text-stone-500 font-medium">
            Referral tracking can&apos;t be turned on for a cancelled campaign.
          </p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-5">
            <ReferralSettingsFields
              eventTypes={draftEventTypes}
              codeSource={draftCodeSource}
              onEventTypesChange={setDraftEventTypes}
              onCodeSourceChange={setDraftCodeSource}
              disabled={savingSettings}
              showCodeSource={settings.codeSource === "business"}
            />
            <button
              onClick={() =>
                saveSettings(
                  { enabled: true, eventTypes: draftEventTypes, codeSource: draftCodeSource },
                  "Referral tracking is on."
                )
              }
              disabled={savingSettings}
              className="w-full py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink disabled:bg-stone-200 disabled:text-stone-400"
            >
              {savingSettings ? "Turning on…" : "Turn on referral tracking"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const codes = data?.codes || [];
  const activeCount = codes.filter((row) => row.status === "active").length;
  const awaitingCount = codes.filter((row) => row.status === "awaiting_business").length;
  const missingCount = codes.filter((row) => row.status === "missing").length;
  const conversions = data?.summary.conversions ?? settings.conversions;
  const savedEventTypes = settingsEventTypes(settings);
  const settingsChanged =
    draftEventTypes.length !== savedEventTypes.length ||
    draftEventTypes.some((type) => !savedEventTypes.includes(type)) ||
    draftCodeSource !== settings.codeSource;

  return (
    <div className="space-y-8">
      {header}

      <Link
        href="/dashboard/brand/settings/referral"
        className="flex items-center justify-between gap-3 bg-white border border-stone-200 rounded-2xl px-4 py-3 font-rethink"
      >
        <span className="text-sm font-medium text-stone-900">Webhook keys and setup guide</span>
        <span className="text-xs font-medium text-stone-500" aria-hidden="true">→</span>
      </Link>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
          <span className="text-[10px] font-medium text-stone-500 block capitalize">
            {conversionNounFor(settingsEventTypes(settings), 2)}
          </span>
          <span className="font-rethink font-medium text-xl text-stone-900 block tabular-nums">
            {conversions.toLocaleString()}
          </span>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
          <span className="text-[10px] font-medium text-stone-500 block">Active codes</span>
          <span className="font-rethink font-medium text-xl text-stone-900 block tabular-nums">
            {activeCount} <span className="text-sm text-stone-400">/ {codes.length}</span>
          </span>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-rethink font-semibold text-sm text-stone-900">Creator rewards</h4>
          {settings.rewardPerConversion > 0 &&
            (settings.poolRemaining >= settings.rewardPerConversion ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium font-rethink bg-[#CBF5E5] text-[#176448]">
                Paying creators
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium font-rethink bg-amber-50 text-amber-800">
                Budget used up
              </span>
            ))}
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-stone-500 font-rethink block">
            Creators earn per {conversionNounFor(settingsEventTypes(settings), 1)}
          </span>
          {settings.rewardPerConversion > 0 ? (
            <p className="font-rethink text-lg font-medium text-stone-900 tabular-nums">
              {formatNaira(settings.rewardPerConversion)}
            </p>
          ) : (
            <p className="font-rethink text-sm font-medium text-stone-900">Being set by our team</p>
          )}
          <p className="text-[11px] text-stone-500 font-medium font-rethink leading-relaxed">
            {settings.rewardPerConversion > 0
              ? `Set by Easily Promote from your referral budget. Creators can withdraw rewards 7 days after each ${conversionNounFor(settingsEventTypes(settings), 1)}.`
              : `We set this from your referral budget once the campaign is live. ${conversionNounFor(settingsEventTypes(settings), 2).replace(/^./, (c) => c.toUpperCase())} recorded before then are paid once it's set.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-stone-100 pt-4">
          {[
            ["Budget added", formatNaira(settings.budget)],
            ["Earned by creators", formatNaira(settings.earned)],
          ].map(([label, value]) => (
            <div key={label}>
              <span className="text-[10px] font-medium text-stone-500 block">{label}</span>
              <span className="font-rethink text-sm font-medium text-stone-900 tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        {settings.rewardPerConversion > 0 && (
          <p className="text-[11px] text-stone-500 font-medium font-rethink">
            Enough for about {Math.floor(settings.poolRemaining / settings.rewardPerConversion).toLocaleString()} more{" "}
            {conversionNounFor(settingsEventTypes(settings), 2)}. When it runs out, conversions are still recorded but not paid.
          </p>
        )}

        {FUNDABLE_STATUSES.includes(campaignStatus) ? (
          <form onSubmit={handleFund} className="space-y-2 border-t border-stone-100 pt-4">
            <label htmlFor="referral-fund" className="text-xs font-medium text-stone-500 font-rethink block">
              Add referral budget
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-stone-400 font-rethink" aria-hidden="true">
                  ₦
                </span>
                <input
                  id="referral-fund"
                  inputMode="numeric"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value.replace(/\D/g, ""))}
                  placeholder="50000"
                  className="w-full pl-8 pr-4 py-2.5 bg-white border border-stone-200 rounded-full text-sm font-rethink text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400"
                />
              </div>
              <button
                type="submit"
                disabled={funding || Number(fundAmount || 0) < MIN_REFERRAL_BUDGET}
                className="px-4 py-2.5 bg-[#FEB604] text-[#1C1917] rounded-full text-xs font-semibold font-rethink border border-stone-100 disabled:bg-stone-200 disabled:text-stone-400"
              >
                {funding ? "Redirecting…" : "Pay"}
              </button>
            </div>
            <p className="text-[11px] text-stone-500 font-medium font-rethink">
              Minimum {formatNaira(MIN_REFERRAL_BUDGET)}. Kept separate from your views budget.
            </p>
          </form>
        ) : (
          !isCancelled && (
            <p className="text-[11px] text-stone-500 font-medium font-rethink border-t border-stone-100 pt-4">
              You can add a referral budget once the campaign is live.
            </p>
          )
        )}
      </div>

      {(awaitingCount > 0 || missingCount > 0) && (
        <div className="border border-dashed border-amber-300 bg-amber-50 rounded-2xl p-4 space-y-3">
          <p className="font-rethink text-xs font-medium text-amber-900 leading-relaxed">
            {awaitingCount > 0 &&
              `${awaitingCount} older code${awaitingCount === 1 ? " is" : "s are"} pending. ${awaitingCount === 1 ? "It activates" : "They activate"} the first time your app checks or reports ${awaitingCount === 1 ? "it" : "them"}, or you can mark ${awaitingCount === 1 ? "it" : "them"} active now. `}
            {missingCount > 0 &&
              `${missingCount} creator${missingCount === 1 ? " doesn't" : "s don't"} have a code yet.`}
          </p>
          {awaitingCount > 0 && (
            <button
              onClick={handleMarkLoaded}
              disabled={markingLoaded}
              className="px-4 py-2 bg-stone-900 text-white rounded-full text-xs font-semibold font-rethink disabled:opacity-50"
            >
              {markingLoaded ? "Updating…" : "Mark all active"}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleDownload}
          disabled={downloading || codes.length === 0}
          className="px-4 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900 font-rethink disabled:opacity-50"
        >
          {downloading ? "Preparing…" : "Download codes (CSV)"}
        </button>
        <button
          onClick={() => setImportOpen((open) => !open)}
          disabled={codes.length === 0}
          aria-expanded={importOpen}
          className="px-4 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900 font-rethink disabled:opacity-50"
        >
          Import your own codes
        </button>
      </div>

      {importOpen && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <label htmlFor="referral-import-csv" className="text-xs font-medium text-stone-500 font-rethink block">
            Paste CSV with a creator_username and code column
          </label>
          <textarea
            id="referral-import-csv"
            value={importCsv}
            onChange={(e) => setImportCsv(e.target.value)}
            placeholder={"creator_username,code\ntunde,ACME50"}
            spellCheck={false}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400 resize-y min-h-[120px]"
          />
          {importErrors.length > 0 && (
            <ul className="space-y-1 text-xs font-medium text-red-700 font-rethink">
              {importErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || !importCsv.trim()}
              className="px-4 py-2 bg-stone-900 text-white rounded-full text-xs font-semibold font-rethink disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import codes"}
            </button>
            <button
              onClick={() => {
                setImportOpen(false);
                setImportErrors([]);
              }}
              className="px-3 py-2 text-xs font-medium text-stone-500 font-rethink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="font-rethink font-semibold text-sm text-stone-900">Creators</h4>
        {codes.length === 0 ? (
          <p className="font-rethink text-xs text-stone-500 font-medium leading-relaxed">
            No creators have joined yet. Codes appear here as creators claim placements.
          </p>
        ) : (
          codes.map((row) => {
            const chip = STATUS_CHIPS[row.status];
            const canEdit = settings.codeSource === "business" || row.status === "missing" || row.source === "business";
            const isEditing = editingSlotId === row.slotId;
            const inputId = `referral-code-${row.slotId}`;
            return (
              <div key={row.slotId} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-rethink font-medium text-sm text-stone-900 truncate">
                      {row.creatorName || row.creatorUsername || "Creator"}
                    </p>
                    {row.creatorUsername && (
                      <p className="font-rethink text-xs font-medium text-stone-500 truncate">@{row.creatorUsername}</p>
                    )}
                  </div>
                  <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium font-rethink", chip.className)}>
                    {chip.label}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  {row.code ? (
                    <code className="min-w-0 font-mono text-sm text-stone-900 bg-stone-100 px-2 py-1 rounded-lg break-all">
                      {row.code}
                    </code>
                  ) : (
                    <span className="font-rethink text-xs font-medium text-stone-400">No code assigned</span>
                  )}
                  <span className="shrink-0 font-rethink text-sm font-medium text-stone-900 tabular-nums">
                    {row.conversions.toLocaleString()}{" "}
                    <span className="text-stone-500">{conversionNounFor(settingsEventTypes(settings), row.conversions)}</span>
                  </span>
                </div>

                {row.earned > 0 && (
                  <p className="font-rethink text-xs font-medium text-stone-500">
                    {formatNaira(row.earned)} earned from referrals
                  </p>
                )}

                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveCode(row.slotId);
                    }}
                    className="flex flex-wrap gap-2"
                  >
                    <label htmlFor={inputId} className="sr-only">
                      Referral code for {row.creatorUsername || row.creatorName || "this creator"}
                    </label>
                    <input
                      id={inputId}
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="e.g. ACME50"
                      className="flex-1 min-w-[140px] px-4 py-2 bg-white border border-stone-200 rounded-full text-sm font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400"
                    />
                    <button
                      type="submit"
                      disabled={savingCode || !codeInput.trim()}
                      className="px-4 py-2 bg-stone-900 text-white rounded-full text-xs font-semibold font-rethink disabled:opacity-50"
                    >
                      {savingCode ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSlotId(null)}
                      className="px-3 py-2 text-xs font-medium text-stone-500 font-rethink"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  canEdit && (
                    <button
                      onClick={() => startEditing(row)}
                      className="text-xs font-semibold text-stone-900 font-rethink underline underline-offset-2"
                    >
                      {row.code ? "Change code" : "Set code"}
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      {!isCancelled && (
        <div className="space-y-4 border-t border-stone-200 pt-6">
          <h4 className="font-rethink font-semibold text-sm text-stone-900">Settings</h4>
          <ReferralSettingsFields
            eventTypes={draftEventTypes}
            codeSource={draftCodeSource}
            onEventTypesChange={setDraftEventTypes}
            onCodeSourceChange={setDraftCodeSource}
            disabled={savingSettings}
            showCodeSource={settings.codeSource === "business"}
          />
          {settingsChanged && (
            <button
              onClick={() =>
                saveSettings({ eventTypes: draftEventTypes, codeSource: draftCodeSource }, "Referral settings saved.")
              }
              disabled={savingSettings}
              className="w-full py-3 bg-stone-900 text-white font-semibold text-sm rounded-full font-rethink disabled:opacity-50"
            >
              {savingSettings ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
