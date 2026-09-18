"use client";

import { AUDIENCE_LOCATION_GROUPS, isKnownAudienceLocation } from "../lib/audience-locations";
import { cn } from "@ep/ui/lib/utils";

interface AudienceLocationSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // Locations already chosen elsewhere in the list, left out so one isn't picked twice.
  exclude?: string[];
  disabled?: boolean;
  className?: string;
}

// Picks an audience location from the shared list. A value saved before the list existed stays
// selectable, so an older profile or campaign still shows what it had.
export function AudienceLocationSelect({ id, value, onChange, placeholder = "Choose a location", exclude = [], disabled, className }: AudienceLocationSelectProps) {
  const taken = new Set(exclude.filter((item) => item !== value));
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "appearance-none bg-white border border-neutral-200 rounded-full px-4 py-2.5 text-sm font-medium font-rethink text-neutral-950 focus:outline-none focus:border-neutral-300 disabled:bg-neutral-100",
        !value && "text-neutral-400",
        className
      )}
    >
      <option value="">{placeholder}</option>
      {value && !isKnownAudienceLocation(value) && <option value={value}>{value}</option>}
      {AUDIENCE_LOCATION_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options
            .filter((option) => !taken.has(option.value))
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
