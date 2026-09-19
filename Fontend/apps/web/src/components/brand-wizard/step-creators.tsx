"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { Field, OptionCard, StepHeading, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import { ACCESS_OPTIONS, CREATOR_CATEGORIES, type WizardData } from "./wizard-state";

interface StepCreatorsProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// How creators get in (only for non-Content campaigns — Content is application-only, like a
// commission), then the bar they must clear to take part.
export function StepCreators({ data, update }: StepCreatorsProps) {
  const isContent = data.objective === "content";
  return (
    <div className="space-y-10">
      {!isContent && (
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
          {data.creatorAccess === "application_required" && (
            <p className="bg-neutral-100 rounded-2xl px-4 py-3 text-xs text-neutral-600 font-medium font-rethink leading-relaxed">
              Once the campaign is live, creators apply and you approve each one.
            </p>
          )}
        </div>
      )}

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

          <Field label="Content categories" htmlFor="content-categories" hint="Only creators who post in these categories can take part.">
            <div className="space-y-2">
              <select
                id="content-categories"
                value=""
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const value = e.target.value;
                  if (value) update({ categories: toggleValue(data.categories, value) });
                }}
                disabled={CREATOR_CATEGORIES.every((category) => data.categories.includes(category))}
                className={cn(
                  "appearance-none w-full bg-white border border-neutral-200 rounded-full px-4 py-3 text-sm font-medium font-rethink text-neutral-950 focus:outline-none focus:border-neutral-300 disabled:bg-neutral-100 cursor-pointer",
                  data.categories.length === 0 && "text-neutral-400"
                )}
              >
                <option value="" disabled>
                  {CREATOR_CATEGORIES.every((category) => data.categories.includes(category))
                    ? "All categories added"
                    : data.categories.length
                      ? "Add another category"
                      : "Select a category"}
                </option>
                {CREATOR_CATEGORIES.filter((category) => !data.categories.includes(category)).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {data.categories.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {data.categories.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => update({ categories: data.categories.filter((existing) => existing !== item) })}
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
      </div>
    </div>
  );
}