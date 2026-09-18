"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { ChipGroup, Field, OptionCard, StepHeading, TEXT_INPUT_CLASS, TEXTAREA_CLASS, toggleValue } from "./wizard-fields";
import {
  ACCESS_OPTIONS,
  BADGE_OPTIONS,
  CREATOR_CATEGORIES,
  DESTINATION_OPTIONS,
  MAX_ADDITIONAL_TERMS,
  RANK_OPTIONS,
  USAGE_DURATION_OPTIONS,
  USAGE_EXCLUSIVITY_OPTIONS,
  USAGE_RIGHTS_TEXT,
  USAGE_RIGHTS_TYPE_OPTIONS,
  grantsUsageRights,
  type WizardData,
} from "./wizard-state";
import type { UsageRightsDuration } from "../types";

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const TERRITORY_OPTIONS = [
  { value: "worldwide", label: "Worldwide" },
  { value: "countries", label: "Specific countries" },
];

interface StepCreatorsProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// SPEC D30: the brand's own terms, which creators accept before joining or applying.
function CustomTermsForm({ data, update }: StepCreatorsProps) {
  const termsLength = data.usageAdditionalTerms.length;
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-5">
      <Field label="How long you can use the content">
        <ChipGroup
          label="Usage duration"
          options={USAGE_DURATION_OPTIONS}
          selected={[data.usageDuration]}
          onToggle={(value) => update({ usageDuration: value as UsageRightsDuration })}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-500 font-rethink">Exclusivity</p>
        <div className="space-y-3" role="radiogroup" aria-label="Exclusivity">
          {USAGE_EXCLUSIVITY_OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              title={option.title}
              body={option.body}
              selected={data.usageExclusivity === option.value}
              onSelect={() => update({ usageExclusivity: option.value })}
            />
          ))}
        </div>
      </div>

      {data.usageExclusivity === "category" && (
        <Field label="Exclusivity period" htmlFor="usage-exclusivity-period" hint="For example: while the campaign runs and 3 months after.">
          <input
            id="usage-exclusivity-period"
            type="text"
            maxLength={100}
            value={data.usageExclusivityPeriod}
            placeholder="How long creators can't work with a competitor"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ usageExclusivityPeriod: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </Field>
      )}

      <Field label="Can you use the content in paid ads?">
        <ChipGroup
          label="Paid ads allowed"
          options={YES_NO_OPTIONS}
          selected={[data.usagePaidAds ? "yes" : "no"]}
          onToggle={(value) => update({ usagePaidAds: value === "yes" })}
        />
      </Field>

      <Field label="Where you can use the content">
        <ChipGroup
          label="Territories"
          options={TERRITORY_OPTIONS}
          selected={[data.usageWorldwide ? "worldwide" : "countries"]}
          onToggle={(value) => update({ usageWorldwide: value === "worldwide" })}
        />
      </Field>

      {!data.usageWorldwide && (
        <Field label="Countries" htmlFor="usage-territories" hint="Separate countries with commas.">
          <input
            id="usage-territories"
            type="text"
            value={data.usageTerritories}
            placeholder="Nigeria, Ghana, Kenya"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ usageTerritories: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </Field>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="usage-additional-terms" className="text-xs font-medium text-neutral-500 font-rethink">
            Additional terms (optional)
          </label>
          <span
            className={cn("text-[11px] font-medium font-rethink", termsLength >= MAX_ADDITIONAL_TERMS ? "text-amber-700" : "text-neutral-400")}
            aria-live="polite"
          >
            {termsLength.toLocaleString()} / {MAX_ADDITIONAL_TERMS.toLocaleString()}
          </span>
        </div>
        <textarea
          id="usage-additional-terms"
          maxLength={MAX_ADDITIONAL_TERMS}
          value={data.usageAdditionalTerms}
          placeholder="Anything else creators should agree to, like credit in captions"
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update({ usageAdditionalTerms: e.target.value })}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5">
        <p className="text-[11px] text-neutral-600 font-medium font-rethink leading-relaxed">
          Creators accept these terms before they join or apply. You can change them while the campaign is a draft, but not after it
          launches.
        </p>
      </div>
    </div>
  );
}

// The two ways creators get in, then the bar they must clear to take part. For Content campaigns
// the step also asks where the finished content goes and how it may be used.
export function StepCreators({ data, update }: StepCreatorsProps) {
  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <StepHeading title="Who can join" body="" />
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

      <div className="space-y-6">
        <StepHeading title="Eligibility requirements" body="Leave any field blank to allow everyone." />

        <Field label="Minimum Followers" htmlFor="min-followers" hint="Typical range: 2,000–10,000">
          <input
            id="min-followers"
            inputMode="numeric"
            placeholder="5000"
            value={data.minFollowers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minFollowers: digitsOnly(e.target.value) })}
            className={TEXT_INPUT_CLASS}
          />
        </Field>

        <Field label="Minimum Engagement Rate" htmlFor="min-engagement" hint="Typical range: 2–5%">
          <div className="relative">
            <input
              id="min-engagement"
              inputMode="decimal"
              placeholder="3"
              value={data.minEngagementRate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minEngagementRate: e.target.value.replace(/[^\d.]/g, "") })}
              className={cn(TEXT_INPUT_CLASS, "pr-10")}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">%</span>
          </div>
        </Field>

        <Field label="Content categories" hint="Only creators who post in these categories can take part.">
          <ChipGroup
            label="Content categories"
            options={CREATOR_CATEGORIES.map((category) => ({ value: category, label: category }))}
            selected={data.categories}
            onToggle={(value) => update({ categories: toggleValue(data.categories, value) })}
          />
        </Field>

        <Field label="Minimum Rank" tooltip="Rank reflects a creator's track record on past campaigns.">
          <ChipGroup
            label="Minimum Rank"
            options={RANK_OPTIONS}
            selected={[data.minRank]}
            onToggle={(value) => update({ minRank: value })}
          />
        </Field>

        <Field label="Required Badges" tooltip="Earned by creators through past campaign performance.">
          <ChipGroup
            label="Required Badges"
            options={BADGE_OPTIONS}
            selected={data.requiredBadges}
            onToggle={(value) => update({ requiredBadges: toggleValue(data.requiredBadges, value) })}
          />
        </Field>

        <label className="flex items-start gap-3 bg-white border border-neutral-200 rounded-2xl p-4 cursor-pointer">
          <input
            type="checkbox"
            checked={data.verifiedOnly}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ verifiedOnly: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-neutral-900"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-neutral-900 font-rethink">Verified Creators Only</span>
            <span className="block text-xs text-neutral-500 font-medium font-rethink leading-relaxed">
              Only creators with a connected social account whose identity our team has checked.
            </span>
          </span>
        </label>
      </div>

      {data.objective === "content" && (
        <div className="space-y-6">
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

          {grantsUsageRights(data.contentDestination) && (
            <div className="space-y-4">
              <StepHeading title="Usage rights" body="How you can use the content creators send you." />
              <div className="space-y-3" role="radiogroup" aria-label="Usage rights">
                {USAGE_RIGHTS_TYPE_OPTIONS.map((option) => (
                  <OptionCard
                    key={option.value}
                    title={option.title}
                    body={option.body}
                    selected={data.usageRightsType === option.value}
                    onSelect={() => update({ usageRightsType: option.value })}
                  />
                ))}
              </div>
              {data.usageRightsType === "standard" ? (
                <div className="bg-white border border-neutral-200 rounded-2xl p-4">
                  <p className="text-xs text-neutral-500 font-medium font-rethink leading-relaxed">{USAGE_RIGHTS_TEXT}</p>
                </div>
              ) : (
                <CustomTermsForm data={data} update={update} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}