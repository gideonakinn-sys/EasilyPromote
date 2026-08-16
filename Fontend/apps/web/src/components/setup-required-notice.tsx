"use client";

import type { CreatorProfile } from "./types";

interface SetupRequiredNoticeProps {
  profile: CreatorProfile;
  onConnectSocial: () => void;
  onChooseNiches: () => void;
  onCompleteProfile: () => void;
}

export function SetupRequiredNotice({
  profile,
  onConnectSocial,
  onChooseNiches,
  onCompleteProfile,
}: SetupRequiredNoticeProps) {
  const steps = [
    {
      label: "Connect a social account",
      completed: profile.socialAccounts.length > 0,
      actionLabel: "Connect",
      onAction: onConnectSocial,
    },
    {
      label: "Choose your niches",
      completed: profile.niches.length > 0,
      actionLabel: "Select niches",
      onAction: onChooseNiches,
    },
    {
      label: "Add a profile photo",
      completed: !!profile.avatar,
      actionLabel: "Upload photo",
      onAction: onCompleteProfile,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  if (completedCount === steps.length) return null;

  const nextStep = steps.find((s) => !s.completed);

  return (
    <div className="w-full bg-stone-50 border border-stone-200 border-dashed rounded-[32px] px-5 py-5 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="font-rethink font-medium text-sm text-stone-900 leading-none">
            Finish setting up to claim campaigns
          </h3>
          <p className="text-xs text-stone-500 font-medium leading-normal mt-1.5">
            {completedCount} of {steps.length} complete — you can look around, but claiming stays locked until
            these are done.
          </p>
        </div>

        {nextStep && (
          <button
            onClick={nextStep.onAction}
            className="shrink-0 px-5 py-2 bg-stone-950 text-white font-semibold text-xs rounded-full font-rethink"
          >
            {nextStep.actionLabel}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {steps.map((step) => (
          <button
            key={step.label}
            onClick={step.completed ? undefined : step.onAction}
            disabled={step.completed}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold font-rethink border ${
              step.completed
                ? "bg-white text-stone-400 border-stone-200"
                : "bg-white text-stone-900 border-stone-300"
            }`}
          >
            {step.completed ? (
              <span className="w-4 h-4 rounded-full bg-stone-950 flex items-center justify-center">
                <svg
                  className="w-2.5 h-2.5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            ) : (
              <span className="w-4 h-4 rounded-full border-2 border-stone-300" />
            )}
            <span className={step.completed ? "line-through" : ""}>{step.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
