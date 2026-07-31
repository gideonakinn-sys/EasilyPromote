"use client";

import Image from "next/image";
import slotLimitImg from "@ep/ui/assets/Slot-limit+new-user-empty.png";
import type { CreatorProfile } from "./types";
import { useReveal } from "../hooks/use-reveal";

interface OnboardingViewProps {
  profile: CreatorProfile;
  onConnectSocial: () => void;
  onChooseNiches: () => void;
  onCompleteProfile: () => void;
}

export function OnboardingView({
  profile,
  onConnectSocial,
  onChooseNiches,
  onCompleteProfile,
}: OnboardingViewProps) {
  useReveal();

  const isSocialConnected = profile.socialAccounts.length > 0;
  const isNichesChosen = profile.niches.length > 0;
  const isProfileCompleted = profile.bio !== "" && profile.country !== "";

  return (
    <div className="w-full flex flex-col items-center max-w-xl text-center">
      <div className="mb-2 h-[180px] w-auto flex items-center justify-center">
        <Image src={slotLimitImg} alt="" width={180} height={180} unoptimized />
      </div>

      <h2 data-reveal className="font-motterdam font-normal text-[33px] leading-[42.67px] text-stone-900 mb-0.5">
        Welcome, {profile.displayName.split(" ")[0]}
      </h2>

      <p data-reveal className="text-sm font-medium text-stone-500 mb-6 max-w-sm">
        You&apos;re almost ready to start earning. Complete these to unlock your first campaign.
      </p>

      <div data-reveal className="w-[350px] bg-stone-50 border border-stone-200 border-dashed rounded-[32px] px-4 py-6 space-y-8 text-left">
        <ChecklistStep
          completed={isSocialConnected}
          title="Connect a social account"
          description="TikTok, Instagram, or YouTube — this is how we verify your views"
          actionLabel="Connect"
          onAction={onConnectSocial}
        />

        <ChecklistStep
          completed={isNichesChosen}
          title="Choose your niches"
          description="We'll match you with campaigns that fit what you actually create."
          actionLabel="Select niches"
          onAction={onChooseNiches}
        />

        <ChecklistStep
          completed={isProfileCompleted}
          title="Complete your profile"
          description="Add a display name and photo so brands know who's delivering."
          actionLabel="Finish profile"
          onAction={onCompleteProfile}
        />
      </div>
    </div>
  );
}

function ChecklistStep({
  completed,
  title,
  description,
  actionLabel,
  onAction,
}: {
  completed: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className="mt-1">
          {completed ? (
            <div className="w-5 h-5 rounded-full bg-stone-950 flex items-center justify-center">
              <svg
                className="w-3.5 h-3.5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-stone-300"></div>
          )}
        </div>
        <div className="flex-1">
          <h4 className="font-rethink font-medium text-sm text-stone-900 leading-none">{title}</h4>
          <p className="text-xs text-stone-500 font-medium leading-normal max-w-sm mt-1.5">{description}</p>
        </div>
      </div>
      {!completed && (
        <button
          onClick={onAction}
          className="w-full py-2 bg-white text-stone-900 font-semibold text-xs border border-stone-200 rounded-full font-rethink"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
