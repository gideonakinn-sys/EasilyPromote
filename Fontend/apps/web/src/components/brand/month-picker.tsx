"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "@hugeicons/core-free-icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@ep/ui/components/dropdown-menu";
import { monthLabel } from "../../lib/brand";

interface MonthPickerProps {
  months: string[];
  value: string;
  onChange: (month: string) => void;
  refreshing?: boolean;
}

export function MonthPicker({ months, value, onChange, refreshing }: MonthPickerProps) {
  // Always offer the current month and the selected month, then every month with data.
  const options = Array.from(new Set([value, ...months])).sort((a, b) => (a < b ? 1 : -1));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Select month"
          className="flex items-center gap-2 rounded-full border border-stone-100 bg-white px-4 py-2 text-sm font-medium text-stone-900"
        >
          {monthLabel(value)}
          {refreshing ? (
            <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500" />
          ) : (
            <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-52 overflow-y-auto">
        {options.map((m) => (
          <DropdownMenuItem key={m} onSelect={() => onChange(m)}>
            <span className={m === value ? "font-semibold text-stone-900" : "font-medium text-stone-700"}>
              {monthLabel(m)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}