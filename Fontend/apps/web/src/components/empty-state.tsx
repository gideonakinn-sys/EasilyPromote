import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { TYPOGRAPHY } from "@ep/ui/lib/constants";
import emptyHomeImg from "@ep/ui/assets/empty_home.png";
import { useReveal } from "../hooks/use-reveal";

interface EmptyStateProps {
  onCreateCampaign: () => void;
  userName?: string;
  /** Render inside the SaaS shell — no outer page padding. */
  compact?: boolean;
}

export function EmptyState({ onCreateCampaign, userName = "User", compact = false }: EmptyStateProps) {
  useReveal();

  const content = (
    <>
      {/* Polaroid Illustration */}
      <div data-reveal className="mb-6">
        <Image
          src={emptyHomeImg}
          alt="Campaign Illustration"
          width={184}
          height={175}
          priority
        />
      </div>

      {/* Welcome Script Header */}
      <h2 data-reveal className={`${TYPOGRAPHY.welcomeHeader} mb-0`}>
        Welcome, {userName.split(" ")[0]}
      </h2>

      {/* Subtitle */}
      <p data-reveal className={`${TYPOGRAPHY.welcomeSubtitle} mb-4`}>
        Let's create a campaign that gets real results.
      </p>

      {/* Yellow Create Campaign Button */}
      <button
        data-reveal
        onClick={onCreateCampaign}
        className="w-full max-w-[300px] py-3 bg-[#FEB604] text-stone-900 font-rethink font-semibold text-sm rounded-full border border-stone-100"
      >
        Create Campaign
      </button>

      {/* Referral keys and code checks don't depend on having a campaign yet. */}
      <Link
        data-reveal
        href="/dashboard/brand/settings/referral"
        className="mt-4 text-sm font-semibold text-stone-900 font-rethink underline underline-offset-2"
      >
        Set up referral tracking
      </Link>
    </>
  );

  if (compact) {
    return (
      <main className="flex w-full flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 text-center">
        <div className="flex max-w-lg flex-col items-center py-10">{content}</div>
      </main>
    );
  }

  return (
    <main className="h-full flex flex-col justify-between items-center w-full px-6 md:px-[100px] pt-0 pb-0 relative overflow-hidden">
      {/* Center Content */}
      <div className="flex-1 flex flex-col items-center justify-center pb-16 text-center max-w-lg mx-auto z-10">
        {content}
      </div>
    </main>
  );
}
