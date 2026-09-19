"use client";

import * as React from "react";
import Image from "next/image";
import { cn } from "@ep/ui/lib/utils";
import { QuoteSummary, payVariant } from "./step-pay";
import { CampaignSetupSummary, setupFromWizard } from "./campaign-setup-summary";
import { actionNoun, isHybrid, tracksConversions, type WizardData } from "./wizard-state";
import type { CampaignQuote } from "../types";
import { useReferralConnection } from "../connect-app-checklist";

import launchCampaign from "@ep/ui/assets/Lauch campaign.png";

interface StepLaunchProps {
  data: WizardData;
  quote: CampaignQuote | null;
  quoteLoading: boolean;
  quoteError: string;
  connection: ReturnType<typeof useReferralConnection>;
  onOpenReferralStep?: () => void;
}

export function StepLaunch({ data, quote, quoteLoading, quoteError, connection, onOpenReferralStep }: StepLaunchProps) {
  const referral = tracksConversions(data);
  const isContent = data.objective === "content";
  const hybrid = isHybrid(data);
  const trackedNoun = actionNoun(hybrid ? data.bonusMetric : data.objective, true);

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        {data.coverImageUrl && (
          <div className="w-[90px] h-[90px] rounded-2xl overflow-hidden border border-neutral-200">
            <img src={data.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
          </div>
        )}
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-neutral-200 text-neutral-600 text-[11px] font-medium font-rethink">
          {data.category}
        </span>
      </div>

      <QuoteSummary variant={payVariant(data)} quote={quote} loading={quoteLoading} error={quoteError} />

      <CampaignSetupSummary setup={setupFromWizard(data)} />

      {referral && (
        <div className="bg-white border border-neutral-200 rounded-[18px] p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-neutral-900 font-rethink">Referral tracking</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium",
                connection.verified ? "bg-[#CBF5E5] text-[#176448]" : "bg-neutral-100 text-neutral-600"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", connection.verified ? "bg-[#176448]" : "bg-neutral-400")} />
              {connection.verified ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="text-xs text-neutral-500 font-medium font-rethink leading-relaxed">
            {connection.verified
              ? `Connected · codes start with ${connection.status?.codePrefix || "BRAND"}. Paying puts the campaign live and starts tracking ${trackedNoun}.`
              : "Referral tracking isn't connected yet — set it up before you pay so creators are tracked and paid."}
          </p>
          {!connection.verified && (
            <button
              type="button"
              onClick={onOpenReferralStep}
              className="block text-xs font-semibold text-neutral-900 underline underline-offset-2"
            >
              Set up referral tracking
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 bg-[#EBF3FF] border border-dashed border-blue-200 rounded-[20px] py-2 pr-2">
        <div className="flex-shrink-0">
          <Image src={launchCampaign} alt="" width={56} height={56} className="object-contain" />
        </div>
        <p className="font-rethink text-xs text-neutral-600 leading-normal">
          {referral && !connection.verified
            ? "Your webhook isn't connected yet, so you can't publish this campaign. Connect it on the Referral tracking step to pay and launch."
            : data.creatorAccess === "application_required"
            ? "When your campaign is live, creators apply and you approve them from your dashboard before they create content. Creators are paid from your budget as their results are verified."
            : hybrid
            ? "Creators are paid your base for each deliverable you approve, and a bonus from your pool as their results are verified. Unused base and bonus are refunded when the campaign ends."
            : isContent
            ? "Creators are paid your rate for each deliverable you approve. Unused budget is refunded when the campaign ends, minus payment fees."
            : "You pay up front. Creators are paid from your budget as their results are verified, and unused budget is refunded when the campaign ends, minus payment fees."}
        </p>
      </div>
    </div>
  );
}
