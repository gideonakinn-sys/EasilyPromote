"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiDownload, apiRequest, getUser, isAuthenticated } from "../../lib/api";
import { MONEY_ROLES, REWARD_ROLES } from "../../lib/roles";

type Tab = "overview" | "brands" | "campaigns" | "conversions";
type Tone = "green" | "amber" | "red" | "blue" | "stone";

interface BrandRef {
  id: string | null;
  name: string | null;
  email: string | null;
}

interface Stats {
  brandsConnected: number;
  activeKeys: number;
  campaignsTracking: number;
  campaignsNeedingReward: number;
  codes: { total: number; active: number };
  conversions: { today: number; last7Days: number; allTime: number };
  requests: { last24h: number; rejectedLast24h: number };
  referralBudget: { funded: number; platformFee: number; earnedByCreators: number; remaining: number };
  flagCounts: { campaignsWithoutConversions: number; brandsWithHighRejections: number; staleKeys: number };
}

interface Flags {
  campaignsWithoutConversions: {
    campaignId: string;
    name: string;
    status: string;
    viewsDelivered: number;
    brand: BrandRef;
  }[];
  brandsWithHighRejections: { brand: BrandRef; requests: number; rejected: number; rejectionRate: number }[];
  staleKeys: { id: string; keyId: string; name?: string; last4: string; createdAt: string; lastUsedAt: string | null; brand: BrandRef }[];
}

interface BrandRow {
  id: string;
  name: string;
  email: string;
  companyName: string | null;
  connectedAt: string | null;
  activeKeys: number;
  lastRequestAt: string | null;
  campaignsTracking: number;
  codes: number;
  conversions: { allTime: number; last7Days: number };
  requests7d: number;
  rejected7d: number;
  rejectionRate7d: number | null;
}

interface KeyRow {
  id: string;
  keyId: string;
  name?: string;
  last4: string;
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  createdAt: string;
  source: string;
  statusCode: number;
  result: string;
  error: string | null;
  code: string | null;
  eventType: string | null;
  eventId: string | null;
}

interface BrandDetail {
  brand: { id: string; name: string; email: string; companyName: string | null; connectedAt: string | null; isActive: boolean };
  keys: KeyRow[];
  campaigns: { id: string; name: string; status: string; eventType: string; eventTypes?: string[]; conversions: number; viewsDelivered: number }[];
  recentRequests: DeliveryRow[];
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  brand: BrandRef;
  eventType: string;
  eventTypes?: string[];
  codeSource: string;
  conversions: number;
  viewsDelivered: number;
  targetViews: number;
  codes: number;
  activeCodes: number;
  rewardPerConversion: number;
  // Live campaign with a referral budget but no creator reward yet.
  needsReward: boolean;
  unpaidConversions: number;
  pool: number;
  platformFee: number;
  referralBudget: number;
  earnedByCreators: number;
  poolRemaining: number;
}

interface CodeRow {
  id: string;
  code: string;
  status: string;
  source: string;
  conversions: number;
  creator: { id: string; username: string | null; name: string | null };
  lastConversionAt: string | null;
  earned: number;
}

interface ConversionRow {
  id: string;
  occurredAt: string;
  receivedAt: string;
  eventId: string;
  eventType: string;
  counted: boolean;
  rewardAmount: number;
  unpaidReason: string | null;
  availableAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
  payoutStatus: "pending" | "available" | "voided" | "unpaid";
  code: string | null;
  brand: { id: string; name: string | null };
  campaign: { id: string; name: string | null };
  creator: { id: string; username: string | null; name: string | null };
}

interface PageMeta {
  total: number;
  page: number;
  pages: number;
}

interface PendingAction {
  kind: "disable_code" | "enable_code" | "revoke_key" | "void_conversion";
  id: string;
  label: string;
  onDone: () => void;
}

const ACTION_ROLES = ["admin", "super_admin"];
const EVENT_TYPES = ["install", "signup", "lead", "purchase", "deposit", "custom"];
const CAMPAIGN_STATUSES = ["all", "live", "paused", "completed", "cancelled"];

const STATUS_TONE: Record<string, Tone> = {
  active: "green",
  available: "green",
  pending: "amber",
  voided: "red",
  unpaid: "stone",
  live: "green",
  recorded: "green",
  valid: "green",
  test_ok: "blue",
  completed: "blue",
  expiring: "amber",
  awaiting_business: "amber",
  paused: "amber",
  invalid: "amber",
  ignored: "stone",
  expired: "stone",
  draft: "stone",
  disabled: "red",
  revoked: "red",
  rejected: "red",
  cancelled: "red",
};

const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  stone: "bg-stone-100 text-stone-600",
};

const numberFormat = new Intl.NumberFormat("en-NG");

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function percent(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] || "stone";
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase font-mono whitespace-nowrap ${TONE_CLASSES[tone]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: "warn" }) {
  return (
    <div className="bg-white border border-stone-200/90 rounded-2xl p-5">
      <span className="text-xs font-semibold text-stone-500 block mb-1">{label}</span>
      <span className={`text-2xl font-bold ${tone === "warn" ? "text-amber-600" : "text-stone-900"}`}>{value}</span>
      {hint && <span className="text-[11px] text-stone-400 block mt-1">{hint}</span>}
    </div>
  );
}

function Pager({ meta, onChange }: { meta: PageMeta; onChange: (page: number) => void }) {
  if (meta.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-stone-200 text-xs text-stone-500">
      <span>
        Page {meta.page} of {meta.pages} · {numberFormat.format(meta.total)} total
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(meta.page - 1)}
          disabled={meta.page <= 1}
          className="px-3 py-1.5 rounded-full border border-stone-200 bg-white font-semibold disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={() => onChange(meta.page + 1)}
          disabled={meta.page >= meta.pages}
          className="px-3 py-1.5 rounded-full border border-stone-200 bg-white font-semibold disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-white border border-stone-200/90 rounded-2xl overflow-hidden">
      <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between gap-3">
        <h3 className="font-bold text-sm text-stone-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function TableHead({ columns }: { columns: string[] }) {
  return (
    <thead className="bg-stone-50 border-b border-stone-200 font-bold uppercase tracking-wider text-[10px] text-stone-500">
      <tr>
        {columns.map((column) => (
          <th key={column} className="px-6 py-4 whitespace-nowrap">
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function EmptyRow({ colSpan, loading, message }: { colSpan: number; loading: boolean; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-12 text-center text-stone-400">
        {loading ? "Loading…" : message}
      </td>
    </tr>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/40 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-[#FAFAF9] border border-stone-200 rounded-3xl w-full max-w-5xl my-8">
        <div className="flex items-start justify-between gap-4 p-6 border-b border-stone-200">
          <div>
            <h2 className="text-lg font-bold text-stone-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-stone-500 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-stone-600">
            ✕
          </button>
        </div>
        <div className="p-6 space-y-6">{children}</div>
      </div>
    </div>
  );
}

function ActionDialog({ action, onClose }: { action: PendingAction; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const copy = {
    disable_code: { title: `Disable ${action.label}?`, body: "Code checks and conversions with this code will be rejected until it is re-enabled.", button: "Disable code" },
    enable_code: { title: `Re-enable ${action.label}?`, body: "The code will be accepted again for code checks and conversions.", button: "Re-enable code" },
    revoke_key: { title: `Revoke ${action.label}?`, body: "Requests signed with this key are rejected immediately. The brand must generate a new key. This can't be undone.", button: "Revoke key" },
    void_conversion: { title: `Void ${action.label}?`, body: "The conversion stops counting and its reward goes back to the campaign's referral budget. The creator is notified. This can't be undone.", button: "Void conversion" },
  }[action.kind];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      setError("Add a note explaining why.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (action.kind === "revoke_key") {
        await apiRequest(`/admin/referrals/keys/${action.id}/revoke`, { method: "POST", body: JSON.stringify({ note }) });
      } else if (action.kind === "void_conversion") {
        await apiRequest(`/admin/referrals/conversions/${action.id}/void`, { method: "POST", body: JSON.stringify({ note }) });
      } else {
        await apiRequest(`/admin/referrals/codes/${action.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: action.kind === "disable_code" ? "disabled" : "active", note }),
        });
      }
      action.onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/40 backdrop-blur-sm px-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white border border-stone-200 rounded-3xl p-8 max-w-sm w-full space-y-5">
        <div className="space-y-1.5">
          <h3 className="font-medium text-lg text-stone-900">{copy.title}</h3>
          <p className="text-xs text-stone-500 font-medium leading-relaxed">{copy.body} The brand is notified and your note is saved in the activity log.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="admin-action-note" className="text-xs font-medium text-stone-500">
            Note (required)
          </label>
          <textarea
            id="admin-action-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:border-stone-400 resize-none"
            placeholder="e.g. Code shared on a coupon site"
          />
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-full font-medium text-xs">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`flex-1 py-2.5 rounded-full font-semibold text-xs text-white disabled:opacity-50 ${action.kind === "enable_code" ? "bg-stone-950" : "bg-red-600"}`}
          >
            {submitting ? "Working…" : copy.button}
          </button>
        </div>
      </form>
    </div>
  );
}

const CONVERSION_NOUNS: Record<string, [string, string]> = {
  signup: ["sign-up", "sign-ups"],
  install: ["download", "downloads"],
  lead: ["lead", "leads"],
  purchase: ["purchase", "purchases"],
  deposit: ["deposit", "deposits"],
  custom: ["conversion", "conversions"],
};

function RewardDialog({ campaign, onClose, onDone }: { campaign: CampaignRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(campaign.rewardPerConversion > 0 ? String(campaign.rewardPerConversion) : "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ paidEarlierConversions: number; stillUnpaid: number } | null>(null);
  const types = campaign.eventTypes?.length ? campaign.eventTypes : [campaign.eventType];
  const [singular, plural] = (types.length === 1 && CONVERSION_NOUNS[types[0]]) || CONVERSION_NOUNS.custom;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const reward = Number(amount);
  const covered = reward > 0 ? Math.floor(campaign.poolRemaining / reward) : 0;
  const firstReward = !(campaign.rewardPerConversion > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(reward >= 1)) {
      setError("Enter a reward of at least ₦1.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await apiRequest<{ paidEarlierConversions: number; stillUnpaid: number }>(
        `/admin/referrals/campaigns/${campaign.id}/reward`,
        { method: "PATCH", body: JSON.stringify({ rewardPerConversion: reward, note: note.trim() || undefined }) }
      );
      setDone(result);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the reward");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/40 backdrop-blur-sm px-4" onClick={() => !submitting && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-heading"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-stone-200 rounded-3xl p-8 max-w-md w-full space-y-5"
      >
        <div className="space-y-1.5">
          <h3 id="reward-heading" className="font-medium text-lg text-stone-900">
            {firstReward ? "Set" : "Change"} the reward for {campaign.name}
          </h3>
          <p className="text-xs text-stone-500 font-medium leading-relaxed">
            What each creator earns per {singular}, paid from the brand&apos;s referral budget. Creators and the brand are notified.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            ["Budget", campaign.referralBudget],
            ["Creator pool", campaign.pool],
            ["Left", campaign.poolRemaining],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-stone-50 rounded-xl px-3 py-2">
              <span className="text-[10px] font-semibold text-stone-500 block">{label}</span>
              <span className="font-mono text-stone-900">₦{numberFormat.format(value as number)}</span>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reward-amount" className="text-xs font-medium text-stone-500">
            Reward per {singular} (₦)
          </label>
          <input
            id="reward-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="500"
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 font-mono focus:outline-none focus:border-stone-400"
          />
          <p className="text-[11px] text-stone-500">
            {reward > 0
              ? `The ₦${numberFormat.format(campaign.poolRemaining)} left covers about ${numberFormat.format(covered)} ${covered === 1 ? singular : plural}.`
              : "Enter an amount to see how many the budget covers."}
            {firstReward && campaign.unpaidConversions > 0 &&
              ` ${numberFormat.format(campaign.unpaidConversions)} ${campaign.unpaidConversions === 1 ? singular : plural} recorded without a reward will be paid now, oldest first.`}
            {!firstReward && " Applies to new ones only; earlier ones keep what they earned."}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reward-note" className="text-xs font-medium text-stone-500">
            Note (optional)
          </label>
          <textarea
            id="reward-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm text-stone-900 focus:outline-none focus:border-stone-400 resize-none"
            placeholder="Saved in the activity log"
          />
        </div>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        {done && (
          <p role="status" className="text-xs font-medium text-green-700">
            Saved.{done.paidEarlierConversions > 0 && ` ${done.paidEarlierConversions} earlier ${done.paidEarlierConversions === 1 ? singular : plural} paid.`}
            {done.stillUnpaid > 0 && ` ${done.stillUnpaid} couldn't be paid: the budget ran out.`}
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="flex-1 py-2.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-full font-medium text-xs disabled:opacity-50">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-full font-semibold text-xs text-white bg-stone-950 disabled:opacity-50">
              {submitting ? "Saving…" : firstReward ? "Set reward" : "Change reward"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function CodesPanel({
  campaign,
  canAct,
  onAction,
  onClose,
}: {
  campaign: { id: string; name: string };
  canAct: boolean;
  onAction: (action: PendingAction) => void;
  onClose: () => void;
}) {
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [eventType, setEventType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{ campaign: { eventType: string | null; eventTypes?: string[] }; codes: CodeRow[] }>(`/admin/referrals/campaigns/${campaign.id}/codes`);
      setCodes(data.codes);
      setEventType(data.campaign.eventTypes?.length ? data.campaign.eventTypes.join(", ") : data.campaign.eventType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load codes");
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Modal title={campaign.name} subtitle={`Referral codes${eventType ? ` · counts ${eventType} events` : ""}`} onClose={onClose}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Panel title={`Codes (${codes.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <TableHead columns={["Code", "Creator", "Status", "Conversions", "Earned", "Last conversion", "Actions"]} />
            <tbody className="divide-y divide-stone-100">
              {loading || codes.length === 0 ? (
                <EmptyRow colSpan={7} loading={loading} message="No creators have codes on this campaign yet." />
              ) : (
                codes.map((code) => (
                  <tr key={code.id} className="align-top">
                    <td className="px-6 py-4 font-mono font-semibold text-stone-900">{code.code}</td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-stone-800">{code.creator.name || "—"}</p>
                      {code.creator.username && <p className="text-[11px] text-stone-400">@{code.creator.username}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={code.status} />
                    </td>
                    <td className="px-6 py-4 font-mono">{numberFormat.format(code.conversions)}</td>
                    <td className="px-6 py-4 font-mono">₦{numberFormat.format(code.earned)}</td>
                    <td className="px-6 py-4 text-stone-500">{formatDateTime(code.lastConversionAt)}</td>
                    <td className="px-6 py-4">
                      {canAct ? (
                        code.status === "disabled" ? (
                          <button
                            onClick={() => onAction({ kind: "enable_code", id: code.id, label: code.code, onDone: load })}
                            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-stone-900 text-white"
                          >
                            Re-enable
                          </button>
                        ) : (
                          <button
                            onClick={() => onAction({ kind: "disable_code", id: code.id, label: code.code, onDone: load })}
                            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200"
                          >
                            Disable
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-stone-400">View only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </Modal>
  );
}

function BrandPanel({
  brandId,
  canAct,
  onAction,
  onOpenCampaign,
  onClose,
}: {
  brandId: string;
  canAct: boolean;
  onAction: (action: PendingAction) => void;
  onOpenCampaign: (campaign: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setDetail(await apiRequest<BrandDetail>(`/admin/referrals/brands/${brandId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brand");
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  const brand = detail?.brand;
  return (
    <Modal
      title={brand ? brand.companyName || brand.name : "Brand"}
      subtitle={brand ? `${brand.email} · ${brand.connectedAt ? `connected ${formatDateTime(brand.connectedAt)}` : "not connected"}` : undefined}
      onClose={onClose}
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!detail ? (
        <p className="text-sm text-stone-400">Loading…</p>
      ) : (
        <>
          <Panel title={`Signing keys (${detail.keys.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-stone-700">
                <TableHead columns={["Key", "Status", "Created", "Last used", "Actions"]} />
                <tbody className="divide-y divide-stone-100">
                  {detail.keys.length === 0 ? (
                    <EmptyRow colSpan={5} loading={false} message="This brand hasn't generated a key." />
                  ) : (
                    detail.keys.map((key) => (
                      <tr key={key.id}>
                        <td className="px-6 py-4">
                          {key.name && <p className="font-semibold text-stone-900">{key.name}</p>}
                          <p className={key.name ? "font-mono text-stone-600" : "font-mono font-semibold text-stone-900"}>{key.keyId}</p>
                          <p className="text-[11px] text-stone-400">Secret ending …{key.last4}</p>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={key.status} />
                        </td>
                        <td className="px-6 py-4 text-stone-500">{formatDateTime(key.createdAt)}</td>
                        <td className="px-6 py-4 text-stone-500">{formatDateTime(key.lastUsedAt)}</td>
                        <td className="px-6 py-4">
                          {canAct && (key.status === "active" || key.status === "expiring") ? (
                            <button
                              onClick={() => onAction({ kind: "revoke_key", id: key.id, label: key.name ? `${key.name} (${key.keyId})` : key.keyId, onDone: load })}
                              className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200"
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-[11px] text-stone-400">{canAct ? "—" : "View only"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={`Campaigns tracking referrals (${detail.campaigns.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-stone-700">
                <TableHead columns={["Campaign", "Status", "Event", "Conversions", "Views", ""]} />
                <tbody className="divide-y divide-stone-100">
                  {detail.campaigns.length === 0 ? (
                    <EmptyRow colSpan={6} loading={false} message="No campaigns have referral tracking on." />
                  ) : (
                    detail.campaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <td className="px-6 py-4 font-semibold text-stone-800">{campaign.name}</td>
                        <td className="px-6 py-4">
                          <StatusBadge status={campaign.status} />
                        </td>
                        <td className="px-6 py-4">{(campaign.eventTypes?.length ? campaign.eventTypes : [campaign.eventType]).join(", ")}</td>
                        <td className="px-6 py-4 font-mono">{numberFormat.format(campaign.conversions)}</td>
                        <td className="px-6 py-4 font-mono">{numberFormat.format(campaign.viewsDelivered)}</td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => onOpenCampaign({ id: campaign.id, name: campaign.name })}
                            className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-stone-200 text-stone-900"
                          >
                            View codes
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Recent requests (last 50)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-stone-700">
                <TableHead columns={["When", "Source", "Result", "Code", "Event", "Reason"]} />
                <tbody className="divide-y divide-stone-100">
                  {detail.recentRequests.length === 0 ? (
                    <EmptyRow colSpan={6} loading={false} message="No requests in the last 30 days." />
                  ) : (
                    detail.recentRequests.map((request) => (
                      <tr key={request.id} className="align-top">
                        <td className="px-6 py-4 text-stone-500 whitespace-nowrap">{formatDateTime(request.createdAt)}</td>
                        <td className="px-6 py-4">{request.source.replace(/_/g, " ")}</td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-stone-500 mr-2">{request.statusCode}</span>
                          <StatusBadge status={request.result} />
                        </td>
                        <td className="px-6 py-4 font-mono">{request.code || "—"}</td>
                        <td className="px-6 py-4">{request.eventType || "—"}</td>
                        <td className="px-6 py-4 text-stone-500 max-w-xs break-words">{request.error || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </Modal>
  );
}

function OverviewTab({
  onOpenBrand,
  onOpenCampaign,
  onShowNeedsReward,
}: {
  onOpenBrand: (id: string) => void;
  onOpenCampaign: (campaign: { id: string; name: string }) => void;
  onShowNeedsReward: () => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([apiRequest<Stats>("/admin/referrals/stats"), apiRequest<Flags>("/admin/referrals/flags")])
      .then(([nextStats, nextFlags]) => {
        setStats(nextStats);
        setFlags(nextFlags);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load referral stats"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!stats || !flags) return <p className="text-sm text-stone-400">Loading…</p>;

  const rejectionShare = stats.requests.last24h ? stats.requests.rejectedLast24h / stats.requests.last24h : null;

  return (
    <div className="space-y-6">
      {stats.campaignsNeedingReward > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">
              {numberFormat.format(stats.campaignsNeedingReward)} live campaign{stats.campaignsNeedingReward === 1 ? "" : "s"}
            </span>{" "}
            {stats.campaignsNeedingReward === 1 ? "has" : "have"} a referral budget but no creator reward yet. Their sign-ups are recorded and paid once you set one.
          </p>
          <button onClick={onShowNeedsReward} className="px-4 py-2 rounded-full text-xs font-semibold bg-stone-900 text-white">
            Set rewards
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Conversions today" value={numberFormat.format(stats.conversions.today)} hint={`${numberFormat.format(stats.conversions.last7Days)} in 7 days · ${numberFormat.format(stats.conversions.allTime)} all time`} />
        <StatCard label="Brands connected" value={numberFormat.format(stats.brandsConnected)} hint={`${numberFormat.format(stats.activeKeys)} active signing keys`} />
        <StatCard label="Campaigns tracking" value={numberFormat.format(stats.campaignsTracking)} hint={`${numberFormat.format(stats.codes.active)} of ${numberFormat.format(stats.codes.total)} codes active`} />
        <StatCard
          label="Rejected requests (24h)"
          value={numberFormat.format(stats.requests.rejectedLast24h)}
          hint={`${numberFormat.format(stats.requests.last24h)} requests · ${percent(rejectionShare)} rejected`}
          tone={stats.requests.rejectedLast24h > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Referral budget funded" value={`₦${numberFormat.format(stats.referralBudget.funded)}`} hint="Paid in by brands, all campaigns" />
        <StatCard label="Platform fee" value={`₦${numberFormat.format(stats.referralBudget.platformFee)}`} hint="Kept from referral budgets" />
        <StatCard label="Earned by creators" value={`₦${numberFormat.format(stats.referralBudget.earnedByCreators)}`} hint="Reserved rewards, excluding voided" />
        <StatCard label="Left for rewards" value={`₦${numberFormat.format(stats.referralBudget.remaining)}`} hint="Unreserved across campaigns" />
      </div>

      <Panel title={`Campaigns with views but no conversions (${flags.campaignsWithoutConversions.length})`}>
        <p className="px-6 pt-4 text-[11px] text-stone-500">
          Tracking on for 3+ days and creators are delivering views, but the brand hasn&apos;t reported a single conversion. Check whether the brand is under-reporting or their integration is broken.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <TableHead columns={["Campaign", "Brand", "Status", "Views delivered", ""]} />
            <tbody className="divide-y divide-stone-100">
              {flags.campaignsWithoutConversions.length === 0 ? (
                <EmptyRow colSpan={5} loading={false} message="Nothing flagged." />
              ) : (
                flags.campaignsWithoutConversions.map((item) => (
                  <tr key={item.campaignId}>
                    <td className="px-6 py-4 font-semibold text-stone-800">{item.name}</td>
                    <td className="px-6 py-4">
                      {item.brand.id ? (
                        <button onClick={() => onOpenBrand(item.brand.id as string)} className="font-semibold text-stone-900 underline underline-offset-2">
                          {item.brand.name || item.brand.email}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-6 py-4 font-mono">{numberFormat.format(item.viewsDelivered)}</td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => onOpenCampaign({ id: item.campaignId, name: item.name })}
                        className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-stone-200 text-stone-900"
                      >
                        View codes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title={`Brands with mostly rejected requests (${flags.brandsWithHighRejections.length})`}>
          <p className="px-6 pt-4 text-[11px] text-stone-500">At least 10 requests in 7 days and half or more rejected — usually a broken signature or unknown codes.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <TableHead columns={["Brand", "Requests (7d)", "Rejected"]} />
              <tbody className="divide-y divide-stone-100">
                {flags.brandsWithHighRejections.length === 0 ? (
                  <EmptyRow colSpan={3} loading={false} message="Nothing flagged." />
                ) : (
                  flags.brandsWithHighRejections.map((item) => (
                    <tr key={String(item.brand.id)}>
                      <td className="px-6 py-4">
                        <button onClick={() => item.brand.id && onOpenBrand(item.brand.id)} className="font-semibold text-stone-900 underline underline-offset-2">
                          {item.brand.name || item.brand.email || "Unknown brand"}
                        </button>
                      </td>
                      <td className="px-6 py-4 font-mono">{numberFormat.format(item.requests)}</td>
                      <td className="px-6 py-4 font-mono text-red-700">
                        {numberFormat.format(item.rejected)} ({percent(item.rejectionRate)})
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={`Unused keys (30+ days) (${flags.staleKeys.length})`}>
          <p className="px-6 pt-4 text-[11px] text-stone-500">Active keys that haven&apos;t signed a request in 30 days. Worth revoking if the brand has moved on.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <TableHead columns={["Key", "Brand", "Last used"]} />
              <tbody className="divide-y divide-stone-100">
                {flags.staleKeys.length === 0 ? (
                  <EmptyRow colSpan={3} loading={false} message="Nothing flagged." />
                ) : (
                  flags.staleKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="px-6 py-4">
                        {key.name && <p className="font-semibold text-stone-900">{key.name}</p>}
                        <p className="font-mono">{key.keyId}</p>
                      </td>
                      <td className="px-6 py-4">
                        <button onClick={() => key.brand.id && onOpenBrand(key.brand.id)} className="font-semibold text-stone-900 underline underline-offset-2">
                          {key.brand.name || key.brand.email || "Unknown brand"}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-stone-500">{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : `Never (created ${formatDateTime(key.createdAt)})`}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SearchForm({ placeholder, onSearch, children }: { placeholder: string; onSearch: (q: string) => void; children?: ReactNode }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value.trim());
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label htmlFor={`search-${placeholder}`} className="sr-only">
        {placeholder}
      </label>
      <input
        id={`search-${placeholder}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-72 max-w-full border border-stone-200 rounded-full px-4 py-2 text-xs text-stone-700 outline-none focus:border-stone-400 bg-white"
      />
      <button type="submit" className="px-4 py-2 rounded-full text-xs font-semibold bg-stone-900 text-white">
        Search
      </button>
      {children}
    </form>
  );
}

function BrandsTab({ onOpenBrand }: { onOpenBrand: (id: string) => void }) {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, pages: 1 });
  const [query, setQuery] = useState({ q: "", page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(query.page), limit: "20" });
    if (query.q) params.set("q", query.q);
    apiRequest<{ brands: BrandRow[] } & PageMeta>(`/admin/referrals/brands?${params}`)
      .then((data) => {
        setRows(data.brands);
        setMeta({ total: data.total, page: data.page, pages: data.pages });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load brands"))
      .finally(() => setLoading(false));
  }, [query]);

  return (
    <div className="space-y-4">
      <SearchForm placeholder="Search brand, company or email" onSearch={(q) => setQuery({ q, page: 1 })} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Panel title="Brands using referral tracking">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <TableHead columns={["Brand", "Connection", "Keys", "Last request", "Campaigns", "Codes", "Conversions (7d / all)", "Rejected (7d)"]} />
            <tbody className="divide-y divide-stone-100">
              {loading || rows.length === 0 ? (
                <EmptyRow colSpan={8} loading={loading} message="No brands have set up referral tracking yet." />
              ) : (
                rows.map((brand) => (
                  <tr key={brand.id} onClick={() => onOpenBrand(brand.id)} className="hover:bg-stone-50/80 cursor-pointer align-top">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-stone-800">{brand.companyName || brand.name}</p>
                      <p className="text-[11px] text-stone-400">{brand.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      {brand.connectedAt ? <StatusBadge status="active" /> : <span className="text-stone-400">Not connected</span>}
                    </td>
                    <td className="px-6 py-4 font-mono">{brand.activeKeys}</td>
                    <td className="px-6 py-4 text-stone-500 whitespace-nowrap">{formatDateTime(brand.lastRequestAt)}</td>
                    <td className="px-6 py-4 font-mono">{brand.campaignsTracking}</td>
                    <td className="px-6 py-4 font-mono">{numberFormat.format(brand.codes)}</td>
                    <td className="px-6 py-4 font-mono">
                      {numberFormat.format(brand.conversions.last7Days)} / {numberFormat.format(brand.conversions.allTime)}
                    </td>
                    <td className={`px-6 py-4 font-mono ${brand.rejectionRate7d !== null && brand.rejectionRate7d >= 0.5 ? "text-red-700" : ""}`}>
                      {brand.rejected7d} of {brand.requests7d} ({percent(brand.rejectionRate7d)})
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager meta={meta} onChange={(page) => setQuery((prev) => ({ ...prev, page }))} />
      </Panel>
    </div>
  );
}

function CampaignsTab({
  onOpenCampaign,
  canAct,
  onSetReward,
  refreshKey,
  initialNeedsReward,
}: {
  onOpenCampaign: (campaign: { id: string; name: string }) => void;
  canAct: boolean;
  onSetReward: (campaign: CampaignRow) => void;
  refreshKey: number;
  initialNeedsReward: boolean;
}) {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, pages: 1 });
  const [query, setQuery] = useState({ q: "", status: "all", page: 1, needsReward: initialNeedsReward });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(query.page), limit: "20", status: query.status });
    if (query.q) params.set("q", query.q);
    if (query.needsReward) params.set("needsReward", "1");
    apiRequest<{ campaigns: CampaignRow[] } & PageMeta>(`/admin/referrals/campaigns?${params}`)
      .then((data) => {
        setRows(data.campaigns);
        setMeta({ total: data.total, page: data.page, pages: data.pages });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, [query, refreshKey]);

  return (
    <div className="space-y-4">
      <SearchForm placeholder="Search campaign name" onSearch={(q) => setQuery((prev) => ({ ...prev, q, page: 1 }))}>
        <div className="flex gap-2 ml-2">
          {CAMPAIGN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setQuery((prev) => ({ ...prev, status, page: 1 }))}
              className={`px-4 py-2 rounded-full text-xs font-semibold capitalize ${
                query.status === status ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-600"
              }`}
            >
              {status}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={query.needsReward}
            onClick={() => setQuery((prev) => ({ ...prev, needsReward: !prev.needsReward, page: 1 }))}
            className={`px-4 py-2 rounded-full text-xs font-semibold ${
              query.needsReward ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-800"
            }`}
          >
            Needs a reward
          </button>
        </div>
      </SearchForm>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Panel title="Campaigns with referral tracking">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <TableHead columns={["Campaign", "Brand", "Status", "Counts", "Codes", "Conversions", "Reward · budget", "Views", ""]} />
            <tbody className="divide-y divide-stone-100">
              {loading || rows.length === 0 ? (
                <EmptyRow colSpan={9} loading={loading} message="No campaigns match." />
              ) : (
                rows.map((campaign) => (
                  <tr key={campaign.id} className="align-top">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-stone-800">{campaign.name}</p>
                      <p className="text-[11px] text-stone-400">{campaign.codeSource === "business" ? "Brand's own codes" : "Easily Promote codes"}</p>
                    </td>
                    <td className="px-6 py-4 text-stone-600">{campaign.brand.name || campaign.brand.email || "—"}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={campaign.status} />
                    </td>
                    <td className="px-6 py-4">{(campaign.eventTypes?.length ? campaign.eventTypes : [campaign.eventType]).join(", ")}</td>
                    <td className="px-6 py-4 font-mono">
                      {campaign.activeCodes} / {campaign.codes} active
                    </td>
                    <td className={`px-6 py-4 font-mono ${campaign.conversions === 0 && campaign.viewsDelivered > 0 ? "text-amber-700" : ""}`}>
                      {numberFormat.format(campaign.conversions)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {campaign.needsReward ? (
                        <p className="font-semibold text-amber-700">
                          Needs a reward
                          {campaign.unpaidConversions > 0 && ` · ${numberFormat.format(campaign.unpaidConversions)} unpaid`}
                        </p>
                      ) : (
                        <p className="font-mono text-stone-800">
                          {campaign.rewardPerConversion > 0 ? `₦${numberFormat.format(campaign.rewardPerConversion)} each` : "No reward"}
                        </p>
                      )}
                      <p className="text-[11px] text-stone-400">
                        ₦{numberFormat.format(campaign.earnedByCreators)} earned · ₦{numberFormat.format(campaign.poolRemaining)} left of ₦{numberFormat.format(campaign.referralBudget)}
                      </p>
                    </td>
                    <td className="px-6 py-4 font-mono">{numberFormat.format(campaign.viewsDelivered)}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-2">
                        {canAct && campaign.status !== "cancelled" && (
                          <button
                            onClick={() => onSetReward(campaign)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${
                              campaign.needsReward ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-900"
                            }`}
                          >
                            {campaign.rewardPerConversion > 0 ? "Change reward" : "Set reward"}
                          </button>
                        )}
                        <button
                          onClick={() => onOpenCampaign({ id: campaign.id, name: campaign.name })}
                          className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-stone-200 text-stone-900 whitespace-nowrap"
                        >
                          View codes
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager meta={meta} onChange={(page) => setQuery((prev) => ({ ...prev, page }))} />
      </Panel>
    </div>
  );
}

function ConversionsTab({ canAct, onAction }: { canAct: boolean; onAction: (action: PendingAction) => void }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [rows, setRows] = useState<ConversionRow[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, pages: 1 });
  const [draft, setDraft] = useState({ code: "", eventType: "", from: "", to: "" });
  const [applied, setApplied] = useState({ code: "", eventType: "", from: "", to: "", page: 1 });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const filterParams = (filters: { code: string; eventType: string; from: string; to: string }) => {
    const params = new URLSearchParams();
    if (filters.code) params.set("code", filters.code);
    if (filters.eventType) params.set("eventType", filters.eventType);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params;
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = filterParams(applied);
    params.set("page", String(applied.page));
    params.set("limit", "50");
    apiRequest<{ conversions: ConversionRow[] } & PageMeta>(`/admin/referrals/conversions?${params}`)
      .then((data) => {
        setRows(data.conversions);
        setMeta({ total: data.total, page: data.page, pages: data.pages });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load conversions"))
      .finally(() => setLoading(false));
  }, [applied, refreshKey]);

  const exportCsv = async () => {
    setDownloading(true);
    try {
      await apiDownload(`/admin/referrals/conversions.csv?${filterParams(applied)}`, `referral-conversions-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  const inputClass = "border border-stone-200 rounded-full px-4 py-2 text-xs text-stone-700 outline-none focus:border-stone-400 bg-white";

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ ...draft, code: draft.code.trim(), page: 1 });
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="conv-code" className="text-[11px] font-semibold text-stone-500">Code</label>
          <input id="conv-code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} placeholder="e.g. KUDA-TUNDE" className={`${inputClass} font-mono w-44`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conv-event" className="text-[11px] font-semibold text-stone-500">Event</label>
          <select id="conv-event" value={draft.eventType} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })} className={inputClass}>
            <option value="">All events</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conv-from" className="text-[11px] font-semibold text-stone-500">From</label>
          <input id="conv-from" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="conv-to" className="text-[11px] font-semibold text-stone-500">To</label>
          <input id="conv-to" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClass} />
        </div>
        <button type="submit" className="px-4 py-2 rounded-full text-xs font-semibold bg-stone-900 text-white">
          Apply filters
        </button>
        <button type="button" onClick={exportCsv} disabled={downloading} className="px-4 py-2 rounded-full text-xs font-semibold bg-white border border-stone-200 text-stone-900 disabled:opacity-50 ml-auto">
          {downloading ? "Exporting…" : "Export CSV"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Panel title={`Conversions (${numberFormat.format(meta.total)})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <TableHead columns={["Occurred", "Brand", "Campaign", "Creator", "Code", "Event", "Counted", "Event ID", "Reward", "Payout", ""]} />
            <tbody className="divide-y divide-stone-100">
              {loading || rows.length === 0 ? (
                <EmptyRow colSpan={11} loading={loading} message="No conversions match these filters." />
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-6 py-4 text-stone-500 whitespace-nowrap">{formatDateTime(row.occurredAt)}</td>
                    <td className="px-6 py-4 text-stone-700">{row.brand.name || "—"}</td>
                    <td className="px-6 py-4 font-semibold text-stone-800">{row.campaign.name || "—"}</td>
                    <td className="px-6 py-4">{row.creator.username ? `@${row.creator.username}` : row.creator.name || "—"}</td>
                    <td className="px-6 py-4 font-mono">{row.code || "—"}</td>
                    <td className="px-6 py-4">{row.eventType}</td>
                    <td className="px-6 py-4">{row.counted ? <StatusBadge status="active" /> : <span className="text-stone-400">No</span>}</td>
                    <td className="px-6 py-4 font-mono text-stone-500 max-w-[180px] truncate" title={row.eventId}>
                      {row.eventId}
                    </td>
                    <td className="px-6 py-4 font-mono whitespace-nowrap">
                      {row.rewardAmount > 0 ? `₦${numberFormat.format(row.rewardAmount)}` : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={row.payoutStatus} />
                      <p className="text-[10px] text-stone-400 mt-1 whitespace-nowrap">
                        {row.payoutStatus === "pending" && row.availableAt
                          ? `until ${formatDateTime(row.availableAt)}`
                          : row.payoutStatus === "unpaid" && row.unpaidReason
                            ? row.unpaidReason.replace(/_/g, " ")
                            : row.payoutStatus === "voided" && row.voidedReason
                              ? row.voidedReason
                              : ""}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      {canAct && (row.payoutStatus === "pending" || row.payoutStatus === "unpaid") ? (
                        <button
                          onClick={() =>
                            onAction({
                              kind: "void_conversion",
                              id: row.id,
                              label: `${row.code || "conversion"} (${row.eventId})`,
                              onDone: () => setRefreshKey((key) => key + 1),
                            })
                          }
                          className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 whitespace-nowrap"
                        >
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager meta={meta} onChange={(page) => setApplied((prev) => ({ ...prev, page }))} />
      </Panel>
    </div>
  );
}

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview & flags" },
  { value: "brands", label: "Brands" },
  { value: "campaigns", label: "Campaigns" },
  { value: "conversions", label: "Conversions" },
];

export default function AdminReferralsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [canAct, setCanAct] = useState(false);
  // Finance admins can set rewards and void conversions but not disable codes or revoke keys.
  const [canSetReward, setCanSetReward] = useState(false);
  // Voiding a conversion gives its reward back to the pool: finance and super admins only.
  const [canVoidConversions, setCanVoidConversions] = useState(false);
  const [openBrandId, setOpenBrandId] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<{ id: string; name: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rewardCampaign, setRewardCampaign] = useState<CampaignRow | null>(null);
  const [campaignsRefreshKey, setCampaignsRefreshKey] = useState(0);
  const [showNeedsReward, setShowNeedsReward] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    setCanAct(ACTION_ROLES.includes(getUser()?.role || ""));
    setCanSetReward(REWARD_ROLES.includes(getUser()?.role || ""));
    setCanVoidConversions(MONEY_ROLES.includes(getUser()?.role || ""));
  }, [router]);

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto min-w-0">
        <header className="pb-6 border-b border-stone-200 mb-6">
          <h1 className="text-2xl font-bold text-stone-900 tracking-tight">Referrals</h1>
          <p className="text-sm text-stone-500 mt-1">
            Referral codes, conversions and brand integrations across the platform.
            {!canAct && canSetReward && " You can set rewards; admins and super admins can disable codes or revoke keys."}
            {!canAct && !canSetReward && " You have view-only access; admins, super admins and finance admins can set rewards."}
            {!canVoidConversions && " Only finance admins and super admins can void conversions."}
          </p>
        </header>

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Referral views">
          {TABS.map((item) => (
            <button
              key={item.value}
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                tab === item.value ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <OverviewTab
            onOpenBrand={setOpenBrandId}
            onOpenCampaign={setOpenCampaign}
            onShowNeedsReward={() => {
              setShowNeedsReward(true);
              setTab("campaigns");
            }}
          />
        )}
        {tab === "brands" && <BrandsTab onOpenBrand={setOpenBrandId} />}
        {tab === "campaigns" && (
          <CampaignsTab
            onOpenCampaign={setOpenCampaign}
            canAct={canSetReward}
            onSetReward={setRewardCampaign}
            refreshKey={campaignsRefreshKey}
            initialNeedsReward={showNeedsReward}
          />
        )}
        {tab === "conversions" && <ConversionsTab canAct={canVoidConversions} onAction={setPendingAction} />}
      </main>

      {openBrandId && (
        <BrandPanel
          brandId={openBrandId}
          canAct={canAct}
          onAction={setPendingAction}
          onOpenCampaign={(campaign) => setOpenCampaign(campaign)}
          onClose={() => setOpenBrandId(null)}
        />
      )}
      {openCampaign && (
        <CodesPanel campaign={openCampaign} canAct={canAct} onAction={setPendingAction} onClose={() => setOpenCampaign(null)} />
      )}
      {pendingAction && <ActionDialog action={pendingAction} onClose={() => setPendingAction(null)} />}
      {rewardCampaign && (
        <RewardDialog
          campaign={rewardCampaign}
          onClose={() => setRewardCampaign(null)}
          onDone={() => setCampaignsRefreshKey((key) => key + 1)}
        />
      )}
    </div>
  );
}
