"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import type { ApplicantLocation, ApplicantSection, ApplicationDetail } from "./types";
import { ApplicationStatusBadge } from "./application-status-badge";
import { BADGE_OPTIONS } from "./brand-wizard/wizard-state";
import { RatingSummary } from "./creator-rating-summary";
import { applicationsApi } from "../lib/api";
import { platformLabel } from "../lib/campaign-pay";
import { useApplicationUpdates } from "../lib/socket";

// Campaign engine: applications (ticket 06)
// The applicant snapshot a brand reviews: sections render in the order the API returns them,
// which puts what matters for this campaign first.

const SECTION_TITLES: Record<ApplicantSection["key"], string> = {
  platforms: "Platforms",
  categories: "Categories",
  audience: "Audience",
  performance: "Performance",
  portfolio: "Portfolio",
  badges: "Badges And Reliability",
};

export function compactNumber(value: number | null | undefined): string {
  const n = value || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

export function locationLabel(location: ApplicantLocation | null | undefined): string {
  if (!location) return "";
  return [location.city, location.state, location.country].filter(Boolean).join(", ");
}

const badgeName = (value: string) => BADGE_OPTIONS.find((b) => b.value === value)?.label || value;

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="bg-neutral-50 rounded-xl p-3 space-y-0.5">
      <p className="text-[10px] font-medium text-neutral-500">{label}</p>
      <p className="text-sm font-medium text-neutral-900">{value}</p>
    </div>
  );
}

interface SnapshotSectionProps {
  section: ApplicantSection;
}

function SnapshotSection({ section }: SnapshotSectionProps) {
  let body: React.ReactNode = null;

  switch (section.key) {
    case "platforms":
      body = section.data.accounts.length ? (
        <div className="space-y-2">
          {section.data.accounts.map((a) => (
            <div key={a.platform + (a.handle || "")} className="flex justify-between text-xs font-medium">
              <span className="text-neutral-700">
                {platformLabel(a.platform)}
                {a.handle ? <span className="text-neutral-400"> · {a.handle}</span> : null}
              </span>
              <span className="text-neutral-900">{a.followers === null ? "Not added" : `${compactNumber(a.followers)} followers`}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs font-medium text-neutral-400">No platforms added</p>
      );
      break;
    case "categories":
      body = section.data.categories.length ? (
        <div className="flex flex-wrap gap-1.5">
          {section.data.categories.map((c) => (
            <span
              key={c}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-medium",
                section.data.matching.includes(c) ? "bg-[#DBEAFE] text-[#1E40AF]" : "bg-neutral-100 text-neutral-600"
              )}
            >
              {c}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs font-medium text-neutral-400">No categories added</p>
      );
      break;
    case "audience": {
      const d = section.data;
      const hasData = Boolean(d.topLocation || d.topAge || d.genders);
      body = hasData || d.targetedLocations.length ? (
        <div className="space-y-3">
          {d.targetedLocations.length > 0 && (
            <div className="bg-[#DBEAFE] rounded-xl p-3">
              <p className="text-[10px] font-medium text-[#1E40AF]">Audience in {d.targetedLocations.join(", ")}</p>
              <p className="text-lg font-medium text-[#1E40AF]">{d.targetedShare}%</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Top Location" value={d.topLocation ? `${d.topLocation.name} ${d.topLocation.percentage}%` : "—"} />
            <Stat label="Top Age" value={d.topAge ? `${d.topAge.range} ${d.topAge.percentage}%` : "—"} />
            <Stat
              label="Gender"
              value={d.genders ? `${d.genders.female}% F · ${d.genders.male}% M · ${d.genders.other}% Other` : "—"}
            />
          </div>
          {d.source === "self_reported" && <p className="text-[10px] font-medium text-neutral-400">Self-reported</p>}
        </div>
      ) : (
        <p className="text-xs font-medium text-neutral-400">No audience data added</p>
      );
      break;
    }
    case "performance": {
      const d = section.data;
      body = (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Avg Views" value={compactNumber(d.avgViews)} />
          <Stat label="Engagement" value={d.engagementRate === null ? "—" : `${d.engagementRate}%`} />
          <Stat label="Past Campaigns" value={d.pastCampaigns.toLocaleString()} />
          <Stat label="Total Campaign Views" value={compactNumber(d.totalCampaignViews)} />
        </div>
      );
      break;
    }
    case "portfolio":
      body = section.data.items.length ? (
        <div className="grid grid-cols-3 gap-2">
          {section.data.items.map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "block rounded-xl overflow-hidden border aspect-[3/4] bg-neutral-100 relative",
                item.matchesCampaign ? "border-[#2563EB]" : "border-neutral-200"
              )}
            >
              {item.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center p-2 text-[10px] font-medium text-neutral-500 text-center">
                  {item.title || platformLabel(item.platform)}
                </span>
              )}
              {item.category && (
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-white/90 text-[9px] font-medium text-neutral-700">
                  {item.category}
                </span>
              )}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-xs font-medium text-neutral-400">No portfolio items yet</p>
      );
      break;
    case "badges":
      body = (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {section.data.badges.length ? (
              section.data.badges.map((b) => (
                <span key={b} className="px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] text-[10px] font-medium">
                  {badgeName(b)}
                </span>
              ))
            ) : (
              <span className="text-xs font-medium text-neutral-400">No badges yet</span>
            )}
          </div>
          <RatingSummary rating={section.data.rating} showEmpty />
          <Stat label="Completion Rate" value={`${section.data.completionRate}%`} />
        </div>
      );
      break;
  }

  return (
    <div className={cn("rounded-2xl border p-4 space-y-3", section.emphasis ? "border-[#BFDBFE]" : "border-neutral-200")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-neutral-900">{SECTION_TITLES[section.key]}</h4>
        {section.emphasis && (
          <span className="px-2 py-0.5 rounded-full bg-[#DBEAFE] text-[#1E40AF] text-[10px] font-medium">Key For This Campaign</span>
        )}
      </div>
      {body}
    </div>
  );
}

interface RejectApplicationModalProps {
  open: boolean;
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function RejectApplicationModal({ open, name, busy, onCancel, onConfirm }: RejectApplicationModalProps) {
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-6 font-rethink"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-application-title"
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 id="reject-application-title" className="font-medium text-base text-neutral-900 text-center">
          Reject {name}?
        </h3>
        <div className="space-y-2">
          <label htmlFor="reject-reason" className="text-xs font-medium text-neutral-500 block">
            Reason For The Creator (Optional)
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="e.g. We're looking for more fashion content"
            className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-medium placeholder-neutral-300 focus:outline-none focus:border-neutral-400 resize-none"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 py-2.5 bg-neutral-100 text-neutral-900 font-semibold text-sm rounded-full">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="flex-1 py-2.5 bg-red-50 text-red-600 font-semibold text-sm rounded-full border border-red-200 disabled:opacity-50"
          >
            {busy ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ApplicantSnapshotPanelProps {
  campaignId: string;
  applicationId: string | null;
  onClose: () => void;
  // Called after an approve or reject so the list can refresh.
  onDecided: () => void;
}

export function ApplicantSnapshotPanel({ campaignId, applicationId, onClose, onDecided }: ApplicantSnapshotPanelProps) {
  const [detail, setDetail] = React.useState<ApplicationDetail | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [showReject, setShowReject] = React.useState(false);

  React.useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    setDetail(null);
    setLoadError("");
    setActionError("");
    applicationsApi
      .get(campaignId, applicationId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load this applicant");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, applicationId]);

  // Withdrawn or decided elsewhere while open: refresh so Approve / Reject disappear.
  useApplicationUpdates((update) => {
    if (!applicationId || String(update.campaignId) !== campaignId) return;
    applicationsApi
      .get(campaignId, applicationId)
      .then((data) => setDetail((current) => (current && current.id === data.id ? data : current)))
      .catch(() => {});
  });

  if (!applicationId) return null;

  const approve = async () => {
    if (!detail) return;
    setApproving(true);
    setActionError("");
    try {
      const result = await applicationsApi.approve(campaignId, detail.id);
      setDetail({ ...detail, status: result.status, reviewedAt: result.reviewedAt });
      onDecided();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not approve this applicant");
    } finally {
      setApproving(false);
    }
  };

  const reject = async (reason: string) => {
    if (!detail) return;
    setRejecting(true);
    setActionError("");
    try {
      const result = await applicationsApi.reject(campaignId, detail.id, reason);
      setDetail({ ...detail, status: result.status, rejectionReason: result.rejectionReason, reviewedAt: result.reviewedAt });
      setShowReject(false);
      onDecided();
    } catch (err: unknown) {
      setShowReject(false);
      setActionError(err instanceof Error ? err.message : "Could not reject this applicant");
    } finally {
      setRejecting(false);
    }
  };

  const applicant = detail?.applicant;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-neutral-900/40" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-y-0 right-0 z-[80] w-full md:w-[460px] bg-white md:border-l md:border-neutral-200 md:rounded-l-[24px] flex flex-col font-rethink"
        role="dialog"
        aria-modal="true"
        aria-label="Applicant"
      >
        <div className="flex items-center justify-between px-5 md:px-8 h-16 border-b border-neutral-100 flex-shrink-0">
          <h3 className="text-base font-medium text-neutral-900">Applicant</h3>
          <button onClick={onClose} aria-label="Close applicant" className="flex items-center justify-center w-8 h-8 rounded-full bg-neutral-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 md:px-8 py-6 space-y-5" data-lenis-prevent>
          {loadError && <p className="text-xs font-medium text-red-600">{loadError}</p>}
          {!detail && !loadError && <p className="text-xs font-medium text-neutral-400">Loading applicant…</p>}

          {detail && applicant && (
            <>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center text-lg font-medium text-neutral-600 shrink-0">
                  {applicant.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={applicant.photo} alt={applicant.name} className="w-full h-full object-cover" />
                  ) : (
                    applicant.name.charAt(0)
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-medium text-neutral-900 truncate">{applicant.name}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {applicant.verified && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#176448]">
                        <HugeiconsIcon icon={CheckmarkBadge01Icon} size={12} className="text-[#176448]" /> Verified
                      </span>
                    )}
                    <ApplicationStatusBadge status={detail.status} audience="brand" />
                    <span className="text-[11px] font-medium text-neutral-500">{detail.matchScore}% match</span>
                  </div>
                  {locationLabel(applicant.location) && (
                    <p className="text-xs font-medium text-neutral-500 truncate">{locationLabel(applicant.location)}</p>
                  )}
                </div>
              </div>

              {detail.pitch && (
                <div className="bg-neutral-50 rounded-2xl p-4 space-y-1">
                  <p className="text-[10px] font-medium text-neutral-500">Pitch</p>
                  <p className="text-xs font-medium text-neutral-800 leading-relaxed">{detail.pitch}</p>
                </div>
              )}

              {detail.sections.map((section) => (
                <SnapshotSection key={section.key} section={section} />
              ))}

              {detail.status === "rejected" && detail.rejectionReason && (
                <p className="text-xs font-medium text-neutral-500">Reason given: &quot;{detail.rejectionReason}&quot;</p>
              )}
            </>
          )}
        </div>

        {detail && detail.status === "pending" && (
          <div className="border-t border-neutral-100 px-5 md:px-8 py-4 space-y-3 flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {actionError && <p className="text-xs font-medium text-red-600">{actionError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowReject(true)}
                disabled={approving || rejecting}
                className="flex-1 py-3 rounded-full font-semibold text-sm bg-neutral-100 text-neutral-900 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={approving || rejecting}
                className="flex-1 py-3 rounded-full font-semibold text-sm bg-[#FEB604] text-[#171717] border border-neutral-100 disabled:opacity-50"
              >
                {approving ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        )}
      </div>

      <RejectApplicationModal
        open={showReject}
        name={applicant?.name || "this applicant"}
        busy={rejecting}
        onCancel={() => setShowReject(false)}
        onConfirm={reject}
      />
    </>
  );
}
