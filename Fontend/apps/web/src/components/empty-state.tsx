import * as React from "react";
import Image from "next/image";
import { TYPOGRAPHY } from "@ep/ui/lib/constants";
import emptyHomeImg from "@ep/ui/assets/empty_home.png";
import footerImg from "@ep/ui/assets/Footer Compressedd.webp";
import { useReveal } from "../hooks/use-reveal";

interface EmptyStateProps {
  onCreateCampaign: () => void;
  userName?: string;
}

export function EmptyState({ onCreateCampaign, userName = "User" }: EmptyStateProps) {
  useReveal();

  return (
    <main className="h-full flex flex-col justify-between items-center w-full px-6 md:px-[100px] pt-0 pb-0 relative overflow-hidden">
      {/* Center Content */}
      <div className="flex-1 flex flex-col items-center justify-center pb-16 text-center max-w-lg mx-auto z-10">
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
      </div>

      {/* Bottom Polaroid Collage Image */}
      <div data-reveal className="w-full mt-auto pb-0 flex justify-center -mx-6 md:-mx-[100px] hidden md:flex">
        <Image
          src={footerImg}
          alt="Creator Showcase"
          className="w-[70%] object-contain opacity-95"
          priority
        />
      </div>
    </main>
  );
}
