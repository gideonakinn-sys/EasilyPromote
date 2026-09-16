"use client";

import * as React from "react";
import { OptionCard, StepHeading } from "./wizard-fields";
import { ACCESS_OPTIONS, DESTINATION_OPTIONS, USAGE_RIGHTS_TEXT, type WizardData } from "./wizard-state";

interface StepDestinationProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

export function StepDestination({ data, update }: StepDestinationProps) {
  const grantsUsageRights = data.contentDestination === "brand_page" || data.contentDestination === "both";

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <StepHeading title="Where should the content go?" body="Choose where approved content ends up." />
        <div className="space-y-3" role="radiogroup" aria-label="Content destination">
          {DESTINATION_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              title={option.title}
              body={option.body}
              selected={data.contentDestination === option.value}
              onSelect={() => update({ contentDestination: option.value })}
            />
          ))}
        </div>
        {grantsUsageRights && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-1">
            <p className="text-sm font-medium text-stone-900 font-rethink">Usage rights</p>
            <p className="text-xs text-stone-500 font-medium font-rethink leading-relaxed">{USAGE_RIGHTS_TEXT}</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <StepHeading title="How do creators get in?" body="This is your Creator Access. You can use either with any objective." />
        <div className="space-y-3" role="radiogroup" aria-label="Creator access">
          {ACCESS_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              title={option.title}
              body={option.body}
              selected={data.creatorAccess === option.value}
              onSelect={() => update({ creatorAccess: option.value })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
