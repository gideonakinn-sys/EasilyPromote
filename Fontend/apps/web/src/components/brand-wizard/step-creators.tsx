"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@ep/ui/components/dropdown-menu";
import { ChipGroup, Field, OptionCard, StepHeading, TEXT_INPUT_CLASS, TEXTAREA_CLASS, toggleValue } from "./wizard-fields";
import {
  ACCESS_OPTIONS,
  CREATOR_CATEGORIES,
  DESTINATION_OPTIONS,
  MAX_ADDITIONAL_TERMS,
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
        <p className="text-xs font-medium text-neutral-900 font-rethink">Exclusivity</p>
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
      <div className="space-y-3">
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

      <div className="space-y-3">
        <StepHeading title="Eligibility requirements" body="Leave any field blank to allow everyone." />

        <div className="space-y-8">
        <Field label="Minimum Followers" htmlFor="min-followers" hint="Typical range: 2,000–10,000.">
          <input
            id="min-followers"
            inputMode="numeric"
            placeholder="5000"
            value={data.minFollowers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ minFollowers: digitsOnly(e.target.value) })}
            className={cn(TEXT_INPUT_CLASS, "tabular-nums")}
          />
        </Field>

        <Field label="Content categories" hint="Only creators who post in these categories can take part.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(TEXT_INPUT_CLASS, "flex items-center justify-between gap-2 text-left")}>
                <span className={cn("truncate", data.categories.length === 0 && "text-neutral-300")}>
                  {data.categories.length ? data.categories.join(" · ") : "Select categories"}
                </span>
                <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] max-h-56 overflow-y-auto">
              {CREATOR_CATEGORIES.map((category) => (
                <DropdownMenuCheckboxItem
                  key={category}
                  checked={data.categories.includes(category)}
                  onCheckedChange={() => update({ categories: toggleValue(data.categories, category) })}
                >
                  {category}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
        </div>
      </div>

      {data.objective === "content" && (
        <div className="space-y-3">
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
            <div className="space-y-3">
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