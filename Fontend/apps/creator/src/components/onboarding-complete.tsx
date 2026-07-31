"use client";

import Image from "next/image";
import type { CreatorProfile } from "./types";
import { useReveal } from "../hooks/use-reveal";
import emptyHomeImg from "@ep/ui/assets/empty_home.png";

interface OnboardingCompleteProps {
  profile: CreatorProfile;
  onBrowseCampaigns: () => void;
}

export function OnboardingComplete({ profile, onBrowseCampaigns }: OnboardingCompleteProps) {
  useReveal();

  return (
    <div className="w-full flex flex-col items-center max-w-xl text-center">
      <Image src={emptyHomeImg} alt="" width={184} height={175} className="mb-6" unoptimized />

      <h2 data-reveal className="font-rethink font-medium text-[22px] tracking-tighter text-stone-900 mb-2">
        You&apos;re all set — no campaigns yet.
      </h2>
      <p data-reveal className="font-rethink text-sm text-stone-500 mb-8 font-medium tracking-[-0.01em]">
        We&apos;ve matched campaigns to your niches: {profile.niches.join(", ") || "Music, Lifestyle"}
      </p>

      <button
        data-reveal
        onClick={onBrowseCampaigns}
        className="w-full max-w-[300px] py-3 bg-[#FEB604] text-stone-900 font-semibold text-sm rounded-full font-rethink border border-stone-100"
      >
        Browse campaigns
      </button>
    </div>
  );
}
