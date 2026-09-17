"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import type { MyApplication } from "./types";
import { ApplicationStatusBadge } from "./application-status-badge";
import { applicationStatusLine } from "../lib/applications";
import { formatPay } from "../lib/campaign-pay";

// Campaign engine: applications (ticket 06)
// "My applications" on the creator's Home: every application with where it stands.
interface MyApplicationsProps {
  applications: MyApplication[];
  onWithdraw: (campaignId: string) => Promise<boolean>;
}

interface WithdrawModalProps {
  application: MyApplication | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function WithdrawModal({ application, busy, onCancel, onConfirm }: WithdrawModalProps) {
  if (!application) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-application-title"
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs space-y-4">
        <h3 id="withdraw-application-title" className="font-rethink font-medium text-base text-stone-900 text-center">
          Withdraw Your Application?
        </h3>
        <p className="font-rethink text-xs text-stone-500 font-medium text-center">
          The brand won&apos;t see it for {application.campaignName}. You can apply again while places are left.
        </p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 bg-stone-100 text-stone-900 font-semibold text-sm rounded-full font-rethink"
          >
            Keep It
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 bg-red-50 text-red-600 font-semibold text-sm rounded-full border border-red-200 font-rethink disabled:opacity-50"
          >
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyApplications({ applications, onWithdraw }: MyApplicationsProps) {
  const [confirming, setConfirming] = React.useState<MyApplication | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (applications.length === 0) return null;

  const confirmWithdraw = async () => {
    if (!confirming) return;
    setBusy(true);
    await onWithdraw(confirming.campaignId);
    setBusy(false);
    setConfirming(null);
  };

  return (
    <section className="mb-10 space-y-4 font-rethink">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-lg text-stone-900">My Applications</h2>
        <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 text-[10px] font-medium">{applications.length}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {applications.map((application) => (
          <div key={application.id} className="bg-white rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {application.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={application.coverImageUrl} alt="" className="w-10 h-10 rounded-xl object-cover border border-stone-200 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-purple-100 border border-purple-200 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900 truncate">{application.campaignName}</p>
                  {application.brandName && <p className="text-[11px] font-medium text-stone-500 truncate">{application.brandName}</p>}
                </div>
              </div>
              <ApplicationStatusBadge status={application.status} />
            </div>

            {application.pay && <p className="text-sm font-medium text-stone-900">{formatPay(application.pay)}</p>}

            <p className={cn("text-[11px] font-medium leading-relaxed", application.status === "approved" ? "text-[#176448]" : "text-stone-500")}>
              {applicationStatusLine(application)}
            </p>

            {application.status === "rejected" && application.rejectionReason && (
              <div className="bg-[#FAF5FF] border border-[#F3E8FF] rounded-2xl p-3">
                <p className="text-[11px] leading-relaxed text-stone-600 font-medium">&quot;{application.rejectionReason}&quot;</p>
              </div>
            )}

            {application.status === "pending" && (
              <button
                type="button"
                onClick={() => setConfirming(application)}
                className="self-start px-4 py-2 rounded-full font-semibold text-xs bg-stone-100 text-stone-700"
              >
                Withdraw
              </button>
            )}
          </div>
        ))}
      </div>

      <WithdrawModal application={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={confirmWithdraw} />
    </section>
  );
}
