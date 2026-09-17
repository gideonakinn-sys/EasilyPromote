"use client";

import * as React from "react";
import Image from "next/image";
import { StepHeading } from "./wizard-fields";
import { QuoteSummary } from "./step-pay";
import { CampaignSetupSummary, setupFromWizard } from "./campaign-setup-summary";
import { usesReferralBudget, type WizardData } from "./wizard-state";
import type { CampaignQuote } from "../types";
import { ConnectAppChecklist, useReferralConnection } from "../connect-app-checklist";

import launchCampaign from "@ep/ui/assets/Lauch campaign.png";

interface StepLaunchProps {
  data: WizardData;
  quote: CampaignQuote | null;
  quoteLoading: boolean;
  quoteError: string;
  connection: ReturnType<typeof useReferralConnection>;
}

export function StepLaunch({ data, quote, quoteLoading, quoteError, connection }: StepLaunchProps) {
  const referral = usesReferralBudget(data.objective);
  const isContent = data.objective === "content";

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {data.coverImageUrl && (
          <div className="w-[90px] h-[90px] rounded-2xl overflow-hidden border border-stone-200">
            <img src={data.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
          </div>
        )}
        <StepHeading title={data.name || "Your campaign"} body="Check everything, then pay to put your campaign live." />
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-stone-200 text-stone-600 text-[11px] font-medium font-rethink">
          {data.category}
        </span>
      </div>

      <QuoteSummary quote={quote} loading={quoteLoading} error={quoteError} />

      <CampaignSetupSummary setup={setupFromWizard(data)} />

      {referral &&
        (connection.verified ? (
          <p className="bg-[#CBF5E5] text-[#176448] rounded-[18px] px-4 py-3 text-xs font-medium font-rethink leading-relaxed">
            Your app is connected. Paying puts the campaign live and starts tracking {data.objective === "downloads" ? "downloads" : "sign-ups"}.
          </p>
        ) : (
          <div className="bg-white border border-amber-200 rounded-[18px] p-4 space-y-4">
            <div className="space-y-1">
              <h5 className="text-sm font-medium text-stone-900 font-rethink">Connect your app to launch</h5>
              <p className="text-xs text-stone-500 font-medium font-rethink leading-relaxed">
                You can&apos;t pay for this campaign until your app is connected, so your budget never waits on setup. Save this draft and
                finish setup; this checklist updates by itself.
              </p>
            </div>
            {connection.loading ? (
              <p className="text-xs text-stone-500 font-medium font-rethink">Checking your app connection…</p>
            ) : (
              <ConnectAppChecklist status={connection.status} hasKey={connection.hasKey} />
            )}
            <a
              href="/dashboard/brand/settings/referral"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-stone-900 text-white rounded-full text-xs font-semibold font-rethink"
            >
              Open setup guide
            </a>
          </div>
        ))}

      <div className="flex items-center gap-3 bg-[#EBF3FF] border border-dashed border-blue-200 rounded-[20px] py-2 pr-2">
        <div className="flex-shrink-0">
          <Image src={launchCampaign} alt="" width={56} height={56} className="object-contain" />
        </div>
        <p className="font-rethink text-xs text-stone-600 leading-normal">
          {isContent
            ? "Creators are paid your rate for each deliverable you approve. Unused budget is refunded when the campaign ends, minus payment fees."
            : "You pay up front. Creators are paid from your budget as their results are verified, and unused budget is refunded when the campaign ends, minus payment fees."}
        </p>
      </div>
    </div>
  );
}
