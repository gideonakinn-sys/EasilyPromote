"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Skeleton } from "./ui/skeleton";
import { useReferralConversions } from "../lib/socket";
import {
  CODE_SOURCE_OPTIONS,
  REFERRAL_EVENT_TYPES,
  conversionNoun,
  downloadReferralCodesCsv,
  referralApi,
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

const DEFAULT_SETTINGS: ReferralSettings = {
  enabled: false,
  eventType: "signup",
  codeSource: "easilypromote",
  conversions: 0,
};

interface ReferralSettingsFieldsProps {
  eventType: ReferralEventType;
  codeSource: ReferralCodeSource;
  onEventTypeChange: (value: ReferralEventType) => void;
  onCodeSourceChange: (value: ReferralCodeSource) => void;
  disabled?: boolean;
}

export function ReferralSettingsFields({
  eventType,
  codeSource,
  onEventTypeChange,
  onCodeSourceChange,
  disabled,
}: ReferralSettingsFieldsProps) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-xs font-medium text-stone-500 font-rethink mb-2">What counts as a conversion?</legend>
        <div className="flex flex-wrap gap-2">
          {REFERRAL_EVENT_TYPES.map((option) => {
            const selected = eventType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onEventTypeChange(option.value)}
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
    </div>
  );
}

interface CampaignReferralsProps {
  campaignId: string;
  campaignStatus: string;
  initialSettings?: ReferralSettings;
}

export function CampaignReferrals({ campaignId, campaignStatus, initialSettings }: CampaignReferralsProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<ReferralSettings>(initialSettings || DEFAULT_SETTINGS);
  const [draftEventType, setDraftEventType] = useState<ReferralEventType>(initialSettings?.eventType || "signup");
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

  const isCancelled = campaignStatus === "cancelled";

  const fetchCodes = useCallback(async () => {
    setError("");
    try {
      const payload = await referralApi.listCodes(campaignId);
      setData(payload);
      setSettings(payload.referral);
      setDraftEventType(payload.referral.eventType);
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

  const saveSettings = async (
    changes: Partial<Pick<ReferralSettings, "enabled" | "eventType" | "codeSource">>,
    successMessage: string
  ) => {
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
              eventType={draftEventType}
              codeSource={draftCodeSource}
              onEventTypeChange={setDraftEventType}
              onCodeSourceChange={setDraftCodeSource}
              disabled={savingSettings}
            />
            <button
              onClick={() =>
                saveSettings(
                  { enabled: true, eventType: draftEventType, codeSource: draftCodeSource },
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
  const settingsChanged = draftEventType !== settings.eventType || draftCodeSource !== settings.codeSource;

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
            {conversionNoun(settings.eventType, 2)}
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
                    <span className="text-stone-500">{conversionNoun(settings.eventType, row.conversions)}</span>
                  </span>
                </div>

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
            eventType={draftEventType}
            codeSource={draftCodeSource}
            onEventTypeChange={setDraftEventType}
            onCodeSourceChange={setDraftCodeSource}
            disabled={savingSettings}
          />
          {settingsChanged && (
            <button
              onClick={() =>
                saveSettings({ eventType: draftEventType, codeSource: draftCodeSource }, "Referral settings saved.")
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
