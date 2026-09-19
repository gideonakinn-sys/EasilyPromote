"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { ConnectAppChecklist, useReferralConnection } from "../connect-app-checklist";
import { DEVELOPER_DOCS_URL, REFERRAL_HOW_IT_WORKS, buildDeveloperMessage, codeFormatText, formatWhen } from "../../lib/referral";
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
    <div className="space-y-8">
      <div className="bg-white border border-neutral-200 rounded-[18px] p-4 space-y-2">
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
          {connection.verified
            ? `Connected ${formatWhen(status?.verification?.verifiedAt).toLowerCase()}. ${codeFormatText(status?.codePrefix)}`
            : "When someone signs up with a creator's code, your server tells us — that's how conversions are counted and creators are paid."}
        </p>
        {!connection.verified && status?.codePrefix && (
          <p className="bg-neutral-50 rounded-xl px-3 py-2 text-xs text-neutral-600 font-medium font-rethink leading-relaxed">
            {codeFormatText(status.codePrefix)}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <StepHeading
          title="What it's about"
          body="Your app sends one signed request whenever someone converts with a creator's code. Set it up once and it works for every campaign."
        />
        <ol className="space-y-3">
          {REFERRAL_HOW_IT_WORKS.map((item, index) => (
            <li key={item.title} className="flex gap-3">
              <span
                className="shrink-0 w-6 h-6 rounded-full bg-[#FEB604] text-[#171717] text-xs font-semibold flex items-center justify-center"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-neutral-900 font-rethink">{item.title}</p>
                <p className="text-xs text-neutral-500 font-medium font-rethink leading-relaxed">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <StepHeading
          title="Connect your app"
          body="A developer adds two small requests to your app. The checklist ticks itself as each one arrives."
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
            Conversions are POSTed here, signed with your key. When a user enters a code, your app checks it against your validate
            URL.
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

        <div className="flex flex-wrap gap-2">
          <a
            href="/dashboard/brand/settings/referral"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#FEB604] text-[#171717] rounded-full text-xs font-semibold font-rethink border border-neutral-100"
          >
            Open setup guide
          </a>
          <a
            href={DEVELOPER_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 font-rethink"
          >
            Developer docs
          </a>
        </div>
      </div>
    </div>
  );
}