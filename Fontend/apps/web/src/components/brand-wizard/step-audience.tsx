"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { ChipGroup, Field, ListInput, StepHeading, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import {
  AGE_RANGE_OPTIONS,
  BADGE_OPTIONS,
  CREATOR_CATEGORIES,
  GENDER_OPTIONS,
  PLATFORM_OPTIONS,
  RANK_OPTIONS,
  type WizardData,
} from "./wizard-state";

interface StepAudienceProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export function StepAudience({ data, update }: StepAudienceProps) {
  // "Everyone" and a specific gender don't go together.
  const toggleGender = (value: string) => {
    if (value === "all") return update({ genders: ["all"] });
    const next = toggleValue(data.genders.filter((gender) => gender !== "all"), value);
    update({ genders: next.length ? next : ["all"] });
  };

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <StepHeading
          title="Who do you want to reach?"
          body="Audience Targeting describes the people watching. Location and platform must match; age, gender and interests help us rank creators."
        />

        <Field label="Platforms" hint="Creators need an account on at least one of these.">
          <ChipGroup
            label="Platforms"
            options={PLATFORM_OPTIONS}
            selected={data.platforms}
            onToggle={(value) => update({ platforms: toggleValue(data.platforms, value) })}
          />
        </Field>

        <Field label="Audience Locations" htmlFor="audience-locations" hint="Where a creator's followers are, not where the creator lives.">
          <ListInput
            id="audience-locations"
            items={data.locations}
            onChange={(locations) => update({ locations })}
            placeholder="Lagos"
            maxItems={10}
            maxLength={60}
          />
        </Field>

        {data.locations.length > 0 && (
          <Field
            label="Minimum Audience Share"
            htmlFor="location-share"
            hint="For example, 40 means at least 40% of a creator's followers are in the places above."
          >
            <div className="relative">
              <input
                id="location-share"
                inputMode="numeric"
                placeholder="40"
                value={data.minLocationShare}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minLocationShare: digitsOnly(e.target.value).slice(0, 3) })}
                className={cn(TEXT_INPUT_CLASS, "pr-10")}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-stone-400 font-rethink" aria-hidden="true">%</span>
            </div>
          </Field>
        )}

        <Field label="Age">
          <ChipGroup
            label="Age"
            options={AGE_RANGE_OPTIONS.map((range) => ({ value: range, label: range }))}
            selected={data.ageRanges}
            onToggle={(value) => update({ ageRanges: toggleValue(data.ageRanges, value) })}
          />
        </Field>

        <Field label="Gender">
          <ChipGroup label="Gender" options={GENDER_OPTIONS} selected={data.genders} onToggle={toggleGender} />
        </Field>

        <Field label="Interests" htmlFor="audience-interests">
          <ListInput
            id="audience-interests"
            items={data.interests}
            onChange={(interests) => update({ interests })}
            placeholder="Skincare"
            maxItems={20}
            maxLength={40}
          />
        </Field>
      </div>

      <div className="space-y-6">
        <StepHeading title="Which creators can take part?" body="Creator Eligibility sets the requirements a creator must meet to join or apply. Leave anything blank to allow everyone." />

        <Field label="Minimum Followers" htmlFor="min-followers">
          <input
            id="min-followers"
            inputMode="numeric"
            placeholder="5000"
            value={data.minFollowers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minFollowers: digitsOnly(e.target.value) })}
            className={TEXT_INPUT_CLASS}
          />
        </Field>

        <Field label="Minimum Engagement Rate" htmlFor="min-engagement">
          <div className="relative">
            <input
              id="min-engagement"
              inputMode="decimal"
              placeholder="3"
              value={data.minEngagementRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minEngagementRate: e.target.value.replace(/[^\d.]/g, "") })}
              className={cn(TEXT_INPUT_CLASS, "pr-10")}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-stone-400 font-rethink" aria-hidden="true">%</span>
          </div>
        </Field>

        <Field label="Creator Categories">
          <ChipGroup
            label="Creator Categories"
            options={CREATOR_CATEGORIES.map((category) => ({ value: category, label: category }))}
            selected={data.categories}
            onToggle={(value) => update({ categories: toggleValue(data.categories, value) })}
          />
        </Field>

        <Field label="Minimum Rank">
          <ChipGroup
            label="Minimum Rank"
            options={RANK_OPTIONS}
            selected={[data.minRank]}
            onToggle={(value) => update({ minRank: value })}
          />
        </Field>

        <Field label="Required Badges">
          <ChipGroup
            label="Required Badges"
            options={BADGE_OPTIONS}
            selected={data.requiredBadges}
            onToggle={(value) => update({ requiredBadges: toggleValue(data.requiredBadges, value) })}
          />
        </Field>

        <label className="flex items-start gap-3 bg-white border border-stone-200 rounded-2xl p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={data.verifiedOnly}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ verifiedOnly: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-stone-900"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-stone-900 font-rethink">Verified Creators Only</span>
            <span className="block text-xs text-stone-500 font-medium font-rethink leading-relaxed">
              Only creators with a connected social account whose identity our team has checked.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
