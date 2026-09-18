"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { InfoTooltip } from "@ep/ui/components/info-tooltip";

export const TEXT_INPUT_CLASS =
  "w-full px-4 py-3 bg-white border border-neutral-200 rounded-full text-sm font-rethink font-medium placeholder-neutral-300 focus:outline-none focus:border-neutral-400 focus:ring-0";
export const TEXTAREA_CLASS =
  "w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-rethink font-medium placeholder-neutral-300 focus:outline-none focus:border-neutral-400 focus:ring-0 resize-none min-h-[88px]";

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  tooltip?: string;
  children: React.ReactNode;
}

export function Field({ label, htmlFor, hint, tooltip, children }: FieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-xs font-medium text-neutral-500 font-rethink">
          {label}
        </label>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {children}
      {hint && <p className="text-xs text-neutral-400 font-medium font-rethink leading-relaxed">{hint}</p>}
    </div>
  );
}

interface StepHeadingProps {
  title: string;
  body: string;
}

export function StepHeading({ title, body }: StepHeadingProps) {
  return (
    <div className="space-y-1">
      <h4 className="font-rethink font-semibold text-lg text-neutral-900 tracking-tight">{title}</h4>
      {body && <p className="font-rethink text-xs text-neutral-500 font-medium leading-relaxed">{body}</p>}
    </div>
  );
}

interface OptionCardProps {
  title: string;
  body: string;
  selected: boolean;
  disabled?: boolean;
  badge?: string;
  onSelect: () => void;
}

// A radio-style choice with a title and a plain explanation. Selection is shown by the border
// (like the Campaign type cards); the circle indicator is deliberately not used.
export function OptionCard({ title, body, selected, disabled, badge, onSelect }: OptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-4 rounded-2xl border bg-white transition-colors",
        selected ? "border-neutral-900" : "border-neutral-200",
        disabled && "bg-neutral-50 cursor-not-allowed"
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className={cn("text-sm font-semibold font-rethink", disabled ? "text-neutral-400" : "text-neutral-900")}>{title}</span>
        {badge && (
          <span className="px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-500 text-[10px] font-medium font-rethink shrink-0">{badge}</span>
        )}
      </span>
      <span className={cn("block text-xs font-medium font-rethink mt-1 leading-relaxed", disabled ? "text-neutral-400" : "text-neutral-500")}>{body}</span>
    </button>
  );
}

interface ChipGroupProps {
  options: { value: string; label: string; icon?: string | { src: string } }[];
  selected: string[];
  onToggle: (value: string) => void;
  label: string;
}

export function ChipGroup({ options, selected, onToggle, label }: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        const iconSrc = option.icon ? (typeof option.icon === "string" ? option.icon : option.icon.src) : null;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(option.value)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium font-rethink transition-colors",
              option.icon && "inline-flex items-center gap-2",
              isSelected ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"
            )}
          >
            {iconSrc && (
              <span className="flex items-center justify-center w-4 h-4 rounded-sm bg-white shrink-0 overflow-hidden" aria-hidden="true">
                <img src={iconSrc} alt="" className="w-3.5 h-3.5 object-contain" loading="lazy" />
              </span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface ListInputProps {
  id: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  maxItems: number;
  maxLength?: number;
  // Applied to each item before it's added, e.g. to add a leading #.
  normalize?: (value: string) => string;
}

// Short free-text items added one at a time, shown as removable chips.
export function ListInput({ id, items, onChange, placeholder, maxItems, maxLength = 300, normalize }: ListInputProps) {
  const [value, setValue] = React.useState("");
  const full = items.length >= maxItems;

  const add = () => {
    const trimmed = value.trim();
    if (!trimmed || full) return;
    const next = normalize ? normalize(trimmed) : trimmed;
    if (!items.includes(next)) onChange([...items, next]);
    setValue("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={value}
          maxLength={maxLength}
          disabled={full}
          placeholder={full ? `Up to ${maxItems}` : placeholder}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={cn(TEXT_INPUT_CLASS, "flex-1 disabled:bg-neutral-100")}
        />
        <button
          type="button"
          onClick={add}
          disabled={!value.trim() || full}
          className={cn(
            "shrink-0 px-5 py-3 rounded-full text-sm font-semibold font-rethink transition-colors",
            value.trim() && !full ? "bg-[#FEB604] text-[#171717]" : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
          )}
        >
          Add
        </button>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => onChange(items.filter((existing) => existing !== item))}
                aria-label={`Remove ${item}`}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-900 text-white text-xs font-medium font-rethink max-w-full"
              >
                <span className="truncate">{item}</span>
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 text-xs font-rethink">
      <span className="font-medium text-neutral-500 shrink-0">{label}</span>
      <span className="font-medium text-neutral-800 text-right tabular-nums">{value}</span>
    </div>
  );
}
