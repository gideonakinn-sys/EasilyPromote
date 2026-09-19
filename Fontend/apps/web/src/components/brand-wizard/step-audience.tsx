"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { ChipGroup, Field, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import { AudienceLocationSelect } from "../audience-location-select";
import { canonicalAudienceLocation } from "../../lib/audience-locations";
import { AGE_RANGE_OPTIONS, PLATFORM_OPTIONS, type WizardData } from "./wizard-state";

interface StepAudienceProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

export function StepAudience({ data, update }: StepAudienceProps) {
  const ageOptionsLeft = AGE_RANGE_OPTIONS.filter((range) => !data.ageRanges.includes(range));

  return (
    <div className="space-y-12">
      <Field label="Platforms" hint="Choose where your customers spend time. Creators must have an account on at least one to take part.">
        <ChipGroup
          label="Platforms"
          options={PLATFORM_OPTIONS}
          selected={data.platforms}
          onToggle={(value) => update({ platforms: toggleValue(data.platforms, value) })}
        />
      </Field>

      <Field
        label="Where are your customers?"
        htmlFor="audience-locations"
        hint="We'll match you with creators whose followers are mostly based here."
      >
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

      <Field label="Customer age range" htmlFor="customer-age-range" hint="The age range of the customers you're trying to reach.">
        <div className="space-y-2">
          <select
            id="customer-age-range"
            value=""
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const value = e.target.value;
              if (value) update({ ageRanges: toggleValue(data.ageRanges, value) });
            }}
            disabled={ageOptionsLeft.length === 0}
            className={cn(
              "appearance-none bg-white border border-neutral-200 rounded-full px-4 py-3 text-sm font-medium font-rethink text-neutral-950 focus:outline-none focus:border-neutral-300 disabled:bg-neutral-100 cursor-pointer",
              data.ageRanges.length === 0 && "text-neutral-400"
            )}
          >
            <option value="" disabled>
              {ageOptionsLeft.length === 0 ? "All age ranges added" : data.ageRanges.length ? "Add another age range" : "Add an age range"}
            </option>
            {ageOptionsLeft.map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
          </select>
          {data.ageRanges.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {data.ageRanges.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => update({ ageRanges: data.ageRanges.filter((existing) => existing !== item) })}
                    aria-label={`Remove ${item}`}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-900 text-white text-xs font-medium font-rethink"
                  >
                    {item} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>
    </div>
  );
}