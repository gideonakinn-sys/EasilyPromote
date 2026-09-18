"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import { apiRequest, getToken, getUser } from "../lib/api";

export interface OpsAlert {
  id: string;
  kind: string;
  title: string;
  message: string;
  link: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
  resolvedAt: string | null;
  reopenedAt: string | null;
}

interface AlertsResponse {
  alerts: OpsAlert[];
  open: number;
}

interface NeedsAttentionProps {
  // Bumped by the page's refresh button to reload alerts with the rest of the overview.
  refreshKey?: number;
}

const RESOLVER_ROLES = ["admin", "super_admin", "finance_admin"];

const LINK_LABELS: Record<string, string> = {
  "/withdrawals": "Open Withdrawals",
  "/payout-run": "Open Payout Run",
  "/referrals": "Open Referrals",
  "/payouts": "Open Payouts",
};

function linkLabel(link: string) {
  if (link.startsWith("/campaigns?open=") || link.startsWith("/verifications/campaign/")) return "Open Campaign";
  return LINK_LABELS[link] || "Open";
}

function timeSince(value: string) {
  const minutes = Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 60000), 0);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function NeedsAttention({ refreshKey = 0 }: NeedsAttentionProps) {
  const [alerts, setAlerts] = React.useState<OpsAlert[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [confirming, setConfirming] = React.useState<OpsAlert | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [resolveError, setResolveError] = React.useState("");
  const [canResolve, setCanResolve] = React.useState(false);
  // Every open alert, even past the ones listed.
  const [openCount, setOpenCount] = React.useState(0);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest<AlertsResponse>("/admin/alerts", { token: getToken() || undefined });
      setAlerts(data.alerts);
      setOpenCount(data.open);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setCanResolve(RESOLVER_ROLES.includes(getUser()?.role || ""));
  }, []);

  React.useEffect(() => {
    load();
  }, [load, refreshKey]);

  React.useEffect(() => {
    if (!confirming) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resolving) setConfirming(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, resolving]);

  const resolve = async () => {
    if (!confirming) return;
    try {
      setResolving(true);
      setResolveError("");
      await apiRequest<OpsAlert>(`/admin/alerts/${confirming.id}/resolve`, { method: "PATCH", token: getToken() || undefined });
      setAlerts((current) => current.filter((a) => a.id !== confirming.id));
      setOpenCount((count) => Math.max(count - 1, 0));
      setConfirming(null);
    } catch (err: unknown) {
      setResolveError(err instanceof Error ? err.message : "Couldn't resolve this alert");
    } finally {
      setResolving(false);
    }
  };

  const openConfirm = (alert: OpsAlert) => {
    setResolveError("");
    setConfirming(alert);
  };

  return (
    <section className="bg-white border border-neutral-200/90 rounded-2xl p-6 mb-8 font-rethink">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h3 className="text-base font-medium text-neutral-900">Needs Attention</h3>
          <p className="text-xs text-neutral-500 font-medium mt-0.5">Payouts, refunds, webhooks, deadlines and books checked every 15 minutes</p>
        </div>
        {!loading && !error && (
          <span
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-full",
              openCount > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
            )}
          >
            {openCount > 0 ? `${openCount} Open` : "All Clear"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-neutral-100 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-red-600 font-medium">{error}</p>
      ) : alerts.length === 0 ? (
        <p className="text-xs text-neutral-500 font-medium">Nothing needs attention right now.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 rounded-xl border border-red-100 bg-red-50/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-neutral-900">{alert.title}</span>
                  <span className="text-[11px] text-neutral-500 font-medium">First seen {timeSince(alert.firstSeenAt)}</span>
                  {alert.reopenedAt && <span className="text-[11px] text-red-700 font-medium">Reopened {timeSince(alert.reopenedAt)}</span>}
                  {!alert.active && <span className="text-[11px] text-green-700 font-medium">Condition cleared</span>}
                </div>
                <p className="text-xs text-neutral-600 font-medium mt-1 break-words">{alert.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {alert.link && (
                  <Link
                    href={alert.link}
                    className="px-3.5 py-1.5 rounded-full border border-neutral-200 bg-white text-xs font-semibold text-neutral-700"
                  >
                    {linkLabel(alert.link)}
                  </Link>
                )}
                {canResolve && (
                  <button
                    type="button"
                    onClick={() => openConfirm(alert)}
                    className="px-3.5 py-1.5 rounded-full bg-neutral-900 text-xs font-semibold text-white"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm px-4"
          onClick={() => !resolving && setConfirming(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-alert-heading"
            className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-sm w-full space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h3 id="resolve-alert-heading" className="font-medium text-lg text-neutral-900">
                Resolve this alert?
              </h3>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">{confirming.message}</p>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                If the problem is still there, the alert reopens when it changes or 24 hours from now. If it clears and comes back, you&apos;ll get a new alert.
              </p>
              {resolveError && <p className="text-xs text-red-600 font-medium">{resolveError}</p>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={resolving}
                className="flex-1 py-2.5 bg-neutral-50 border border-neutral-200 text-neutral-600 rounded-full font-semibold text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resolve}
                disabled={resolving}
                className="flex-1 py-2.5 rounded-full font-semibold text-xs text-white bg-neutral-900 disabled:opacity-50"
              >
                {resolving ? "Resolving…" : "Resolve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
