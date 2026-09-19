"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { ConnectAppChecklist, useReferralConnection } from "../connect-app-checklist";
import { buildDeveloperMessage } from "../../lib/referral";
import { StepHeading } from "./wizard-fields";

interface StepReferralProps {
  connection: ReturnType<typeof useReferralConnection>;
}

// The webhook setup for campaigns that count conversions (Sign-ups, Hybrid): what it's about,
// the URL a brand's developer needs, the connection checklist and the docs links.
export function StepReferral({ connection }: StepReferralProps) {
  const { toast } = useToast();
  const status = connection.status;
  const keys = connection.keys;
  const sampleKey = keys.find((key) => key.status === "active");
  const webhookUrl = status?.webhookUrl || "";

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`, "success");
    } catch {
      toast("Couldn't copy. Select the text and copy it manually.", "error");
    }
  };

  return (
    <div className="space-y-10">
      <div className="bg-white border border-neutral-200 rounded-[18px] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-neutral-900 font-rethink">Referral tracking</p>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium",
              connection.verified ? "bg-[#CBF5E5] text-[#176448]" : "bg-neutral-100 text-neutral-600"
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", connection.verified ? "bg-[#176448]" : "bg-neutral-400")} />
            {connection.verified ? "Connected" : "Not connected yet"}
          </span>
        </div>
        <p className="text-xs text-neutral-500 font-medium font-rethink leading-relaxed">
          When someone signs up using a creator&apos;s code, your server tells us — that&apos;s how conversions are counted and
          creators are paid. Each creator gets a unique code, e.g. {status?.codePrefix || "BRAND"}-TUNDE.
        </p>
        <a
          href="/dashboard/brand/settings/referral"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 font-rethink"
        >
          Read setup guide
        </a>
      </div>

      <div className="space-y-5">
        <StepHeading
          title="Connect your app"
          body="Generate a signing key, then send the rest to your developer — two quick checks."
        />
        {connection.loading ? (
          <p className="text-xs text-neutral-500 font-medium font-rethink">Checking your connection…</p>
        ) : (
          <ConnectAppChecklist status={status} hasKey={connection.hasKey} />
        )}

        <div className="bg-white border border-neutral-200 rounded-[18px] p-4 space-y-2">
          <p className="text-xs font-medium text-neutral-500 font-rethink">Webhook URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 font-mono text-xs text-neutral-900 bg-neutral-100 px-3 py-2 rounded-lg break-all">
              {webhookUrl || "…"}
            </code>
            <button
              type="button"
              onClick={() => copy(webhookUrl, "Webhook URL")}
              disabled={!webhookUrl}
              className="shrink-0 px-3 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 disabled:opacity-50"
            >
              Copy
            </button>
          </div>
          <p className="text-[11px] text-neutral-500 font-medium font-rethink leading-relaxed">
            Your app posts conversions here, signed with your key.
          </p>
        </div>

        {!connection.verified && (
          <button
            type="button"
            onClick={() => copy(buildDeveloperMessage(status, sampleKey?.keyId || "key_…", sampleKey?.name), "Setup message")}
            className="px-4 py-2 bg-neutral-900 text-white rounded-full text-xs font-semibold font-rethink"
          >
            Send to your developer
          </button>
        )}
      </div>
    </div>
  );
}