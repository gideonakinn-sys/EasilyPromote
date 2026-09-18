"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { countMatchingCreators, getToken, type MatchCount } from "../../lib/api";
import { ChipGroup, Field, ListInput, OptionCard, StepHeading, TEXT_INPUT_CLASS, TEXTAREA_CLASS, toggleValue } from "./wizard-fields";
import { AudienceLocationSelect } from "../audience-location-select";
import { canonicalAudienceLocation } from "../../lib/audience-locations";
import {
  ACCESS_OPTIONS,
  AGE_RANGE_OPTIONS,
  BADGE_OPTIONS,
  CREATOR_CATEGORIES,
  DESTINATION_OPTIONS,
  GENDER_OPTIONS,
  MAX_ADDITIONAL_TERMS,
  PLATFORM_OPTIONS,
  RANK_OPTIONS,
  USAGE_DURATION_OPTIONS,
  USAGE_EXCLUSIVITY_OPTIONS,
  USAGE_RIGHTS_TEXT,
  USAGE_RIGHTS_TYPE_OPTIONS,
  ageFilterActive,
  genderFilterActive,
  grantsUsageRights,
  specificGenders,
  targetingPayload,
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

// SPEC D30: the brand's own terms, which creators accept before joining or applying.
function CustomTermsForm({ data, update }: StepAudienceProps) {
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

interface StepAudienceProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// Ticket 11: how many creators could join with these settings, updated a moment after the brand
// stops changing them. Interests only rank creators, so they don't change it; age and gender do
// only when the brand makes them required.
function LiveMatchCount({ data }: { data: WizardData }) {
  const key = JSON.stringify(targetingPayload(data));
  const [result, setResult] = React.useState<MatchCount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      countMatchingCreators(JSON.parse(key) as Record<string, unknown>, getToken() || undefined)
        .then((res) => {
          if (cancelled) return;
          setResult(res);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key]);

  const text = failed ? "We couldn't count matching creators right now." : result ? `${result.label}.` : "Counting matching creators…";
  return (
    <div
      className="sticky top-0 z-10 bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
      aria-live="polite"
    >
      <p className={cn("text-sm font-medium font-rethink", result && result.count === 0 && !failed ? "text-amber-800" : "text-neutral-900")}>
        {text}
      </p>
      {loading && <span className="text-[11px] font-medium text-neutral-400 font-rethink shrink-0">Updating</span>}
    </div>
  );
}

interface HardFilterProps {
  id: string;
  label: string;
  body: string;
  on: boolean;
  share: string;
  showShare: boolean;
  shareHint: string;
  onToggle: (on: boolean) => void;
  onShareChange: (share: string) => void;
}

// A "Required" switch that turns an age or gender preference into a requirement, with the share
// of a creator's audience that has to match.
function HardFilter({ id, label, body, on, share, showShare, shareHint, onToggle, onShareChange }: HardFilterProps) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <span className="space-y-0.5">
          <span id={`${id}-label`} className="block text-sm font-medium text-neutral-900 font-rethink">
            {label}
          </span>
          <span className="block text-xs text-neutral-500 font-medium font-rethink leading-relaxed">{body}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          onClick={() => onToggle(!on)}
          className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-neutral-900" : "bg-neutral-200")}
        >
          <span
            aria-hidden="true"
            className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform", on && "translate-x-5")}
          />
        </button>
      </div>
      {showShare && (
        <Field label="Minimum Audience Share" htmlFor={`${id}-share`} hint={shareHint}>
          <div className="relative">
            <input
              id={`${id}-share`}
              inputMode="numeric"
              placeholder="50"
              value={share}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onShareChange(digitsOnly(e.target.value).slice(0, 3))}
              className={cn(TEXT_INPUT_CLASS, "pr-10")}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">%</span>
          </div>
        </Field>
      )}
    </div>
  );
}

export function StepAudience({ data, update }: StepAudienceProps) {
  // "Everyone" and a specific gender don't go together.
  const toggleGender = (value: string) => {
    if (value === "all") return update({ genders: ["all"] });
    const next = toggleValue(data.genders.filter((gender) => gender !== "all"), value);
    update({ genders: next.length ? next : ["all"] });
  };

  return (
    <div className="space-y-10">
      <LiveMatchCount data={data} />

      <div className="space-y-6">
        <Field label="Platforms" hint="Creators need an account on at least one of these.">
          <ChipGroup
            label="Platforms"
            options={PLATFORM_OPTIONS}
            selected={data.platforms}
            onToggle={(value) => update({ platforms: toggleValue(data.platforms, value) })}
          />
        </Field>

        <Field label="Audience Locations" htmlFor="audience-locations" hint="Where a creator's followers are, not where the creator lives.">
          <div className="space-y-2">
            <AudienceLocationSelect
              id="audience-locations"
              value=""
              placeholder={data.locations.length >= 10 ? "Up to 10 locations" : "Add a location"}
              disabled={data.locations.length >= 10}
              exclude={data.locations}
              onChange={(value) => {
                if (value && !data.locations.includes(value)) update({ locations: [...data.locations, value] });
              }}
              className="w-full"
            />
            {data.locations.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {data.locations.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => update({ locations: data.locations.filter((existing) => existing !== item) })}
                      aria-label={`Remove ${item}`}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-900 text-white text-xs font-medium font-rethink"
                    >
                      {canonicalAudienceLocation(item) === "Abuja" ? "Abuja (FCT)" : item} ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">%</span>
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
          <HardFilter
            id="require-age"
            label="Required"
            body={data.ageRanges.length ? "Only creators whose audience is mostly in these age ranges can take part." : "Pick at least one age range to require it."}
            on={data.requireAgeMatch}
            share={data.minAgeShare}
            showShare={ageFilterActive(data)}
            shareHint="For example, 50 means at least 50% of a creator's followers are in the age ranges above."
            onToggle={(requireAgeMatch) => update({ requireAgeMatch })}
            onShareChange={(minAgeShare) => update({ minAgeShare })}
          />
        </Field>

        <Field label="Gender">
          <ChipGroup label="Gender" options={GENDER_OPTIONS} selected={data.genders} onToggle={toggleGender} />
          <HardFilter
            id="require-gender"
            label="Required"
            body={
              specificGenders(data.genders).length
                ? "Only creators whose audience is mostly the genders above can take part."
                : "Pick a gender other than Everyone to require it."
            }
            on={data.requireGenderMatch}
            share={data.minGenderShare}
            showShare={genderFilterActive(data)}
            shareHint="For example, 50 means at least 50% of a creator's followers are the genders above."
            onToggle={(requireGenderMatch) => update({ requireGenderMatch })}
            onShareChange={(minGenderShare) => update({ minGenderShare })}
          />
        </Field>

        {(data.requireAgeMatch || data.requireGenderMatch) && (
          <p className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs text-amber-800 font-medium font-rethink leading-relaxed">
            Audience age and gender are self-reported by creators, and many haven&apos;t added them yet. Requiring them may shrink the number of creators who can take part.
          </p>
        )}

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
        <StepHeading title="How should creators join?" body="Creator Access decides whether anyone who meets your requirements can join, or creators apply and you pick." />
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
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">%</span>
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
