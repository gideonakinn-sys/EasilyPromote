"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { apiRequest, getToken } from "../lib/api";

// Badges & Ratings (M8): why a creator has or lacks each badge, admin overrides (grant, revoke or
// back to automatic, with a note, logged), and every brand rating with hide / unhide (logged).

interface Check {
  label: string;
  metric?: string;
  value?: number | null;
  need?: number;
  pass: boolean;
  skipped?: string;
  anyOf?: Check[];
}

interface Evaluation {
  held: boolean;
  stage: "gain" | "keep";
  minimumsMet: boolean;
  minimums: Check[];
  checks: Check[];
}

interface BadgeItem {
  badge: string;
  label: string;
  description: string;
  held: boolean;
  earnedByRules: boolean;
  override: { mode: "grant" | "revoke"; source: "admin" | "migration"; note: string; setAt: string | null; setBy: string | null } | null;
  evaluation: Evaluation | null;
}

interface BadgeReport {
  creatorId: string;
  name: string;
  badges: string[];
  evaluatedAt: string | null;
  rating: { average: number | null; count: number };
  needsReview: boolean;
  items: BadgeItem[];
}

interface RatingRow {
  id: string;
  score: number;
  comment: string;
  tags: string[];
  createdAt: string;
  campaign: { id: string; name: string };
  brand: { id: string; name: string };
  hidden: boolean;
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
}

type Mode = "auto" | "grant" | "revoke";

const TAG_LABELS: Record<string, string> = {
  on_brief: "On brief",
  on_time: "On time",
  communication: "Good communication",
  content_quality: "Great content",
  would_work_again: "Would work with again",
};

interface CreatorBadgesDialogProps {
  creatorId: string;
  creatorName: string;
  onClose: () => void;
  onChanged: () => void;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

function formatValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "none";
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function CheckLine({ check }: { check: Check }) {
  if (check.anyOf) {
    return (
      <li className="space-y-1">
        <span className={cn("text-[11px] font-medium", check.pass ? "text-green-700" : "text-red-700")}>{check.pass ? "✓" : "✗"} One of:</span>
        <ul className="pl-4 space-y-1">
          {check.anyOf.map((part) => (
            <CheckLine key={part.label} check={part} />
          ))}
        </ul>
      </li>
    );
  }
  return (
    <li className="flex items-baseline justify-between gap-3 text-[11px] font-medium">
      <span className={cn(check.skipped ? "text-stone-400" : check.pass ? "text-green-700" : "text-red-700")}>
        {check.skipped ? "–" : check.pass ? "✓" : "✗"} {check.label}
      </span>
      <span className="text-stone-500 text-right">
        {check.skipped ? check.skipped : `${formatValue(check.value)} (needs ${formatValue(check.need)})`}
      </span>
    </li>
  );
}

function sourceText(item: BadgeItem) {
  if (item.override?.source === "migration") return "Kept from before automatic badges. Review it.";
  if (item.override?.mode === "grant") return `Granted by ${item.override.setBy || "an admin"}`;
  if (item.override?.mode === "revoke") return `Revoked by ${item.override.setBy || "an admin"}`;
  return item.held ? "Earned automatically" : "Not earned yet";
}

export function CreatorBadgesDialog({ creatorId, creatorName, onClose, onChanged }: CreatorBadgesDialogProps) {
  const [tab, setTab] = React.useState<"badges" | "ratings">("badges");
  const [report, setReport] = React.useState<BadgeReport | null>(null);
  const [ratings, setRatings] = React.useState<RatingRow[] | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<{ item: BadgeItem; mode: Mode } | null>(null);
  const [visibility, setVisibility] = React.useState<RatingRow | null>(null);

  const loadReport = React.useCallback(async () => {
    try {
      setReport(await apiRequest<BadgeReport>(`/admin/creators/${creatorId}/badges`, { token: getToken() || undefined }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load badges");
    }
  }, [creatorId]);

  const loadRatings = React.useCallback(async () => {
    try {
      const data = await apiRequest<{ ratings: RatingRow[] }>(`/admin/ratings?creatorId=${creatorId}&limit=100`, { token: getToken() || undefined });
      setRatings(data.ratings);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load ratings");
    }
  }, [creatorId]);

  React.useEffect(() => {
    loadReport();
    loadRatings();
  }, [loadReport, loadRatings]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !editing && !visibility) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy, editing, visibility]);

  const recalculate = async () => {
    try {
      setBusy(true);
      setError("");
      setReport(await apiRequest<BadgeReport>(`/admin/creators/${creatorId}/badges/recalculate`, { method: "POST", token: getToken() || undefined }));
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't recalculate");
    } finally {
      setBusy(false);
    }
  };

  const saveOverride = async (note: string) => {
    if (!editing) return;
    try {
      setBusy(true);
      setError("");
      setReport(
        await apiRequest<BadgeReport>(`/admin/creators/${creatorId}/badges/${editing.item.badge}`, {
          method: "PUT",
          token: getToken() || undefined,
          body: JSON.stringify({ mode: editing.mode, note }),
        })
      );
      setEditing(null);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't change the badge");
    } finally {
      setBusy(false);
    }
  };

  const saveVisibility = async (reason: string) => {
    if (!visibility) return;
    try {
      setBusy(true);
      setError("");
      await apiRequest(`/admin/ratings/${visibility.id}/visibility`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ hidden: !visibility.hidden, reason }),
      });
      setVisibility(null);
      await Promise.all([loadRatings(), loadReport()]);
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't change the rating");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/40 backdrop-blur-sm px-4 font-rethink" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-badges-heading"
        className="bg-white border border-stone-200 rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 id="creator-badges-heading" className="font-medium text-lg text-stone-900">
              {creatorName}: Badges &amp; Ratings
            </h3>
            <p className="text-xs font-medium text-stone-500">
              {report
                ? `${report.rating.count} visible brand rating${report.rating.count === 1 ? "" : "s"}${report.rating.average !== null ? `, average ${report.rating.average.toFixed(2)}` : ""} · badges checked ${formatDate(report.evaluatedAt)}`
                : "Loading…"}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-full text-xs font-semibold">
            Close
          </button>
        </div>

        <div className="flex gap-2">
          {(["badges", "ratings"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn("px-4 py-2 rounded-full text-xs font-semibold", tab === value ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-600")}
            >
              {value === "badges" ? "Badges" : `Ratings${ratings ? ` (${ratings.length})` : ""}`}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        {tab === "badges" && (
          <div className="space-y-3">
            {report?.needsReview && (
              <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                Some badges were set before automatic badges and are kept until you review them. Keep one with Grant, or hand it back to the rules with Automatic.
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={recalculate} disabled={busy} className="px-3 py-1.5 bg-white border border-stone-200 text-stone-800 rounded-full text-xs font-semibold disabled:opacity-50">
                Recalculate Now
              </button>
            </div>
            {(report?.items || []).map((item) => (
              <div key={item.badge} className="border border-stone-200 rounded-2xl p-4 space-y-3" data-badge={item.badge}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-stone-900">{item.label}</p>
                      <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", item.held ? "bg-green-100 text-green-800" : "bg-stone-100 text-stone-600")}>
                        {item.held ? "Held" : "Not Held"}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-stone-500 mt-0.5">{item.description}</p>
                    <p className={cn("text-[11px] font-medium mt-1", item.override?.source === "migration" ? "text-amber-700" : "text-stone-700")}>
                      {sourceText(item)}
                      {item.override && !item.earnedByRules && item.override.mode === "grant" ? " (the rules don't give it)" : ""}
                      {item.override && item.earnedByRules && item.override.mode === "revoke" ? " (the rules give it)" : ""}
                    </p>
                    {item.override?.note && <p className="text-[11px] font-medium text-stone-500 mt-0.5">Note: {item.override.note}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {(["auto", "grant", "revoke"] as const).map((mode) => {
                      const current = item.override ? (item.override.source === "migration" ? null : item.override.mode) : "auto";
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={busy || current === mode}
                          onClick={() => setEditing({ item, mode })}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[11px] font-semibold border disabled:opacity-60",
                            current === mode ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-700 border-stone-200"
                          )}
                        >
                          {mode === "auto" ? "Automatic" : mode === "grant" ? "Grant" : "Revoke"}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {item.evaluation ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium text-stone-500">Minimum Sample {item.evaluation.minimumsMet ? "(met)" : "(not met)"}</p>
                      <ul className="space-y-1">
                        {item.evaluation.minimums.map((check) => (
                          <CheckLine key={check.label} check={check} />
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-medium text-stone-500">{item.evaluation.stage === "keep" ? "To Keep It (lower bar)" : "To Earn It"}</p>
                      <ul className="space-y-1">
                        {item.evaluation.checks.map((check) => (
                          <CheckLine key={check.label} check={check} />
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] font-medium text-stone-400">Not checked yet. Press Recalculate Now.</p>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "ratings" && (
          <div className="space-y-3">
            {ratings === null ? (
              <p className="text-xs font-medium text-stone-400">Loading ratings…</p>
            ) : ratings.length === 0 ? (
              <p className="text-xs font-medium text-stone-500">No brand has rated this creator yet.</p>
            ) : (
              ratings.map((r) => (
                <div key={r.id} className={cn("border rounded-2xl p-4 space-y-2", r.hidden ? "border-red-200 bg-red-50/40" : "border-stone-200")} data-rating={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {"★".repeat(r.score)}
                        <span className="text-stone-300">{"★".repeat(5 - r.score)}</span> <span className="text-xs text-stone-500">{r.score}/5</span>
                      </p>
                      <p className="text-[11px] font-medium text-stone-500">
                        {r.brand.name} · {r.campaign.name} · {formatDate(r.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVisibility(r)}
                      disabled={busy}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-semibold border shrink-0",
                        r.hidden ? "bg-white text-stone-800 border-stone-200" : "bg-red-50 text-red-700 border-red-200"
                      )}
                    >
                      {r.hidden ? "Unhide" : "Hide"}
                    </button>
                  </div>
                  {r.comment && <p className="text-xs font-medium text-stone-700 leading-relaxed">&ldquo;{r.comment}&rdquo;</p>}
                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 rounded-full bg-stone-100 text-[10px] font-medium text-stone-600">
                          {TAG_LABELS[tag] || tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.hidden && (
                    <p className="text-[11px] font-medium text-red-700">
                      Hidden by {r.hiddenBy || "an admin"} on {formatDate(r.hiddenAt)}: {r.hiddenReason}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {editing && (
        <NoteModal
          title={
            editing.mode === "auto"
              ? `Hand ${editing.item.label} Back To The Rules?`
              : editing.mode === "grant"
                ? `Grant ${editing.item.label}?`
                : `Revoke ${editing.item.label}?`
          }
          description={
            editing.mode === "auto"
              ? `The creator ${editing.item.earnedByRules ? "keeps" : "loses"} the badge as the rules say today, and it follows them from now on.`
              : editing.mode === "grant"
                ? "The creator holds the badge whatever the rules say until an admin changes it. They're notified if it's new to them."
                : "The creator loses the badge whatever the rules say until an admin changes it. Campaigns needing it won't let them join."
          }
          noteLabel="Note (required, logged)"
          confirmLabel={editing.mode === "auto" ? "Use Automatic" : editing.mode === "grant" ? "Grant Badge" : "Revoke Badge"}
          danger={editing.mode === "revoke"}
          requireNote
          busy={busy}
          onCancel={() => setEditing(null)}
          onConfirm={saveOverride}
        />
      )}

      {visibility && (
        <NoteModal
          title={visibility.hidden ? "Unhide This Rating?" : "Hide This Rating?"}
          description={
            visibility.hidden
              ? "It counts towards the creator's average again. The change is logged."
              : "It stops counting towards the creator's average and the brand can no longer change it. Nothing is deleted; the change is logged."
          }
          noteLabel={visibility.hidden ? "Note (optional)" : "Reason (required, logged)"}
          confirmLabel={visibility.hidden ? "Unhide Rating" : "Hide Rating"}
          danger={!visibility.hidden}
          requireNote={!visibility.hidden}
          busy={busy}
          onCancel={() => setVisibility(null)}
          onConfirm={saveVisibility}
        />
      )}
    </div>
  );
}

interface NoteModalProps {
  title: string;
  description: string;
  noteLabel: string;
  confirmLabel: string;
  danger?: boolean;
  requireNote: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

function NoteModal({ title, description, noteLabel, confirmLabel, danger, requireNote, busy, onCancel, onConfirm }: NoteModalProps) {
  const [note, setNote] = React.useState("");
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/40 px-4" onClick={(e) => { e.stopPropagation(); if (!busy) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="note-modal-heading" className="bg-white border border-stone-200 rounded-3xl p-8 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <h4 id="note-modal-heading" className="font-medium text-lg text-stone-900">
          {title}
        </h4>
        <p className="text-xs text-stone-500 font-medium leading-relaxed">{description}</p>
        <div className="space-y-1.5">
          <label htmlFor="note-modal-note" className="text-[11px] font-medium text-stone-500">
            {noteLabel}
          </label>
          <textarea
            id="note-modal-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-medium text-stone-900 focus:outline-none focus:border-stone-400 resize-none min-h-[88px]"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 py-2.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-full font-semibold text-xs disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note.trim())}
            disabled={busy || (requireNote && !note.trim())}
            className={cn("flex-1 py-2.5 rounded-full font-semibold text-xs text-white disabled:opacity-50", danger ? "bg-red-600" : "bg-stone-900")}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
