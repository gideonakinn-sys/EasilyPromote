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
import { ChipGroup, Field, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import { AudienceLocationSelect } from "../audience-location-select";
import { canonicalAudienceLocation } from "../../lib/audience-locations";
import { AGE_RANGE_OPTIONS, PLATFORM_OPTIONS, type WizardData } from "./wizard-state";

interface StepAudienceProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

export function StepAudience({ data, update }: StepAudienceProps) {
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

        <Field label="Customer age range" hint="The age range of the customers you're trying to reach.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(TEXT_INPUT_CLASS, "flex items-center justify-between gap-2 text-left")}>
                <span className={cn("truncate", data.ageRanges.length === 0 && "text-neutral-300")}>
                  {data.ageRanges.length ? data.ageRanges.join(" · ") : "Select age ranges"}
                </span>
                <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] max-h-56 overflow-y-auto">
              {AGE_RANGE_OPTIONS.map((range) => (
                <DropdownMenuCheckboxItem
                  key={range}
                  checked={data.ageRanges.includes(range)}
                  onCheckedChange={() => update({ ageRanges: toggleValue(data.ageRanges, range) })}
                >
                  {range}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
    </div>
  );
}