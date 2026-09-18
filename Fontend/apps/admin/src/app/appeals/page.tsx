"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { apiRequest, getUser, isAuthenticated } from "../../lib/api";
import { MONEY_ROLES } from "../../lib/roles";

// One inbox for every appeal (D23): content appeals (a brand rejected content) and payout appeals (a
// rejected withdrawal, or pay voided because content was never delivered).
type Kind = "all" | "content" | "payout";
type Status = "open" | "resolved" | "all";

interface AppealRow {
  key: string;
  kind: "content" | "payout";
  id: string;
  subjectType: "content" | "withdrawal" | "fixed_void";
  status: "open" | "granted" | "denied";
  campaignId: string;
  campaignName: string;
  campaignStatus: string | null;
  creatorName: string;
  creatorHandle: string | null;
  amount: number | null;
  reason: string | null;
  decisionReason: string | null;
  videoUrl: string | null;
  caption: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolving: boolean;
  moneyMoving: boolean;
}

interface InboxPayload {
  appeals: AppealRow[];
  counts: { content: number; payout: number };
}

type Decision = { appeal: AppealRow; decision: "grant" | "deny" };

const SUBJECT_LABEL: Record<AppealRow["subjectType"], string> = {
  content: "Rejected Content",
  withdrawal: "Rejected Withdrawal",
  fixed_void: "Voided Pay",
};

const STATUS_STYLE: Record<AppealRow["status"], string> = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  granted: "bg-green-50 text-green-700 border-green-200",
  denied: "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const naira = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(value);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// What granting or denying does, in words, for the confirmation.
function effectOf({ appeal, decision }: Decision) {
  if (decision === "deny") {
    return appeal.kind === "content"
      ? "The rejection stands and can't be appealed again. The creator is told, with your note."
      : "The decision stands and can't be appealed again. The creator is told, with your note.";
  }
  if (appeal.subjectType === "content") {
    return "The content counts as approved and moves on to delivery. If the creator's place was taken or the budget is used up, it's refused.";
  }
  if (appeal.subjectType === "withdrawal") {
    return "The withdrawal goes back in the payout queue for the next Friday run, if the creator's earnings still cover it and nothing else is queued for that campaign.";
  }
  return "The content goes back to awaiting delivery and its pay is credited again, if the creator's place and the campaign budget are still there.";
}

function AppealsInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignFilter = searchParams.get("campaign");
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<Status>("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<InboxPayload>({ appeals: [], counts: { content: 0, payout: 0 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AppealRow | null>(null);
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [message, setMessage] = useState("");
  const [canMoveMoney, setCanMoveMoney] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ kind, status });
      if (query) params.set("q", query);
      if (campaignFilter) params.set("campaignId", campaignFilter);
      const payload = await apiRequest<InboxPayload>(`/admin/appeals?${params.toString()}`);
      setData(payload);
      setSelected((current) => (current ? payload.appeals.find((a) => a.key === current.key) || null : null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load appeals");
    } finally {
      setLoading(false);
    }
  }, [kind, status, query, campaignFilter]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    setCanMoveMoney(MONEY_ROLES.includes(getUser()?.role || ""));
    load();
  }, [router, load]);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openDecision = (decision: Decision) => {
    setNote("");
    setDecisionError("");
    setPending(decision);
  };

  const decide = async () => {
    if (!pending) return;
    const { appeal, decision } = pending;
    if (decision === "deny" && !note.trim()) {
      setDecisionError("Add a note saying why the decision stands.");
      return;
    }
    setWorking(true);
    setDecisionError("");
    try {
      if (appeal.kind === "content") {
        await apiRequest(`/admin/submissions/${appeal.id}/appeal`, {
          method: "PATCH",
          body: JSON.stringify({ decision: decision === "grant" ? "approve" : "reject", notes: note.trim() || undefined }),
        });
      } else {
        await apiRequest(`/admin/payout-appeals/${appeal.id}/resolve`, {
          method: "POST",
          body: JSON.stringify({ decision, note: note.trim() || undefined }),
        });
      }
      setMessage(`${decision === "grant" ? "Granted" : "Denied"}: ${appeal.creatorName}'s appeal on "${appeal.campaignName}". The creator has been told.`);
      setPending(null);
      setSelected(null);
      load();
    } catch (err: unknown) {
      setDecisionError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setWorking(false);
    }
  };

  const grantBlocked = (appeal: AppealRow) => appeal.moneyMoving && !canMoveMoney;

  return (
    <div className="min-h-screen bg-[#fafafa] flex font-rethink">
      <Sidebar />

      <main className="flex-1 p-8 overflow-y-auto">
        <header className="pb-6 border-b border-neutral-200 mb-6 space-y-1">
          <h1 className="text-2xl font-medium text-neutral-900 tracking-tight">Appeals Inbox</h1>
          <p className="text-sm text-neutral-500 font-medium">
            Content appeals and payout appeals in one place. {data.counts.content} content and {data.counts.payout} payout appeal
            {data.counts.payout === 1 ? "" : "s"} open.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {(["all", "content", "payout"] as Kind[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`px-4 py-2 rounded-full text-xs font-semibold border ${kind === value ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"}`}
            >
              {value === "all" ? "All Appeals" : value === "content" ? "Content" : "Payouts"}
            </button>
          ))}
          <span className="w-px h-6 bg-neutral-200 mx-1" />
          {(["open", "resolved", "all"] as Status[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`px-4 py-2 rounded-full text-xs font-semibold border ${status === value ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200"}`}
            >
              {value === "open" ? "Open" : value === "resolved" ? "Resolved" : "Any Status"}
            </button>
          ))}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creator, campaign or reason"
            className="ml-auto w-72 px-4 py-2 rounded-full border border-neutral-200 bg-white text-xs font-medium text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400"
          />
        </div>

        {campaignFilter && (
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-neutral-600">
            <span>Showing one campaign&apos;s appeals.</span>
            <Link href="/appeals" className="underline underline-offset-2 text-neutral-900">
              Show All Campaigns
            </Link>
          </div>
        )}
        {message && <p className="mb-4 text-xs font-medium text-green-700">{message}</p>}
        {error && <p className="mb-4 text-xs font-medium text-red-600">{error}</p>}

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs text-neutral-700">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-[11px] text-neutral-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Appeal</th>
                  <th className="px-5 py-3 font-medium">Creator</th>
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Appealed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-5 py-4">
                          <div className="h-4 bg-neutral-200 rounded w-24" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.appeals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-neutral-400 font-medium">
                      {status === "open" ? "No open appeals." : "No appeals match."}
                    </td>
                  </tr>
                ) : (
                  data.appeals.map((appeal) => (
                    <tr
                      key={appeal.key}
                      onClick={() => setSelected(appeal)}
                      className={`cursor-pointer ${selected?.key === appeal.key ? "bg-neutral-50" : ""}`}
                    >
                      <td className="px-5 py-4 font-medium text-neutral-900">{SUBJECT_LABEL[appeal.subjectType]}</td>
                      <td className="px-5 py-4 font-medium">
                        {appeal.creatorName}
                        {appeal.creatorHandle && <span className="block text-[11px] text-neutral-400">@{appeal.creatorHandle}</span>}
                      </td>
                      <td className="px-5 py-4 font-medium">{appeal.campaignName}</td>
                      <td className="px-5 py-4 font-medium tabular-nums">{appeal.amount === null ? "—" : naira(appeal.amount)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full border text-[11px] font-medium capitalize ${STATUS_STYLE[appeal.status]}`}>
                          {appeal.resolving ? "Being Granted" : appeal.status === "open" ? "Open" : appeal.status === "granted" ? "Granted" : "Denied"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-neutral-500 font-medium">{shortDate(appeal.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <aside className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4">
            {!selected ? (
              <p className="text-xs font-medium text-neutral-400">Choose an appeal to read it and decide.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-400">{SUBJECT_LABEL[selected.subjectType]}</span>
                  <h2 className="text-lg font-medium text-neutral-900 tracking-tight">{selected.campaignName}</h2>
                  <p className="text-xs font-medium text-neutral-500">
                    {selected.creatorName}
                    {selected.amount !== null && ` · ${naira(selected.amount)}`} · appealed {shortDate(selected.createdAt)}
                  </p>
                  <Link href={`/campaigns?open=${selected.campaignId}`} className="text-[11px] font-medium text-neutral-900 underline underline-offset-2">
                    Open Campaign
                  </Link>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-400 block">{selected.kind === "content" ? "Brand's Rejection" : "Decision Appealed"}</span>
                  <p className="text-xs font-medium text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-xl p-3">{selected.decisionReason || "No reason given"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-400 block">Creator&apos;s Appeal</span>
                  <p className="text-xs font-medium text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-xl p-3">{selected.reason || "No reason given"}</p>
                </div>
                {selected.videoUrl && (
                  <a href={selected.videoUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-neutral-900 underline underline-offset-2">
                    Watch The Content
                  </a>
                )}
                {selected.status !== "open" ? (
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-neutral-400 block">Resolution</span>
                    <p className="text-xs font-medium text-neutral-700">
                      {selected.status === "granted" ? "Granted" : "Denied"}
                      {selected.resolvedByName && ` by ${selected.resolvedByName}`}
                      {selected.resolvedAt && ` on ${shortDate(selected.resolvedAt)}`}
                    </p>
                    {selected.resolutionNote && <p className="text-xs font-medium text-neutral-500">{selected.resolutionNote}</p>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selected.resolving && (
                      <p className="text-[11px] font-medium text-amber-700">
                        A grant of this appeal was started and didn&apos;t finish. Granting again finishes it without paying twice.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openDecision({ appeal: selected, decision: "deny" })}
                        disabled={selected.resolving}
                        className="flex-1 py-2.5 border border-neutral-300 text-neutral-700 rounded-full font-semibold text-xs disabled:opacity-40"
                      >
                        {selected.kind === "content" ? "Uphold Rejection" : "Deny Appeal"}
                      </button>
                      <button
                        type="button"
                        onClick={() => openDecision({ appeal: selected, decision: "grant" })}
                        disabled={grantBlocked(selected)}
                        className="flex-1 py-2.5 bg-neutral-900 text-white rounded-full font-semibold text-xs disabled:opacity-40"
                      >
                        {selected.kind === "content" ? "Approve Appeal" : "Grant Appeal"}
                      </button>
                    </div>
                    {grantBlocked(selected) && (
                      <p className="text-[11px] font-medium text-neutral-400">Granting a payout appeal moves money: finance admins and super admins only.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      </main>

      {pending && (
        <div className="fixed inset-0 z-[60] bg-neutral-950/60 flex items-center justify-center p-4" onClick={() => !working && setPending(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appeal-decision-heading"
            className="bg-white rounded-2xl max-w-md w-full p-6 border border-neutral-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 id="appeal-decision-heading" className="text-lg font-medium text-neutral-900 tracking-tight">
                {pending.decision === "grant" ? "Grant" : "Deny"} {pending.appeal.creatorName}&apos;s Appeal?
              </h3>
              <p className="text-xs font-medium text-neutral-500 leading-relaxed">{effectOf(pending)}</p>
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-neutral-500">{pending.decision === "deny" ? "Note For The Creator (Required)" : "Note For The Creator"}</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-900 outline-none focus:border-neutral-400"
              />
            </label>
            {decisionError && <p className="text-xs font-medium text-red-600">{decisionError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={working}
                className="flex-1 py-2.5 border border-neutral-200 text-neutral-600 rounded-full font-semibold text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={decide}
                disabled={working}
                className="flex-1 py-2.5 bg-neutral-900 text-white rounded-full font-semibold text-xs disabled:opacity-50"
              >
                {working ? "Saving…" : pending.decision === "grant" ? "Grant Appeal" : "Deny Appeal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppealsPage() {
  return (
    <Suspense fallback={null}>
      <AppealsInbox />
    </Suspense>
  );
}
