"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";

interface ViewsSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  steps?: number[];
  className?: string;
}

const DEFAULT_STEPS = [100000, 500000, 1000000, 1500000, 2000000, 3000000];

function formatFullNumber(value: number): string {
  return value.toLocaleString();
}

function formatCompact(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${Math.round(value / 1000)}K`;
}

export function ViewsSlider({
  value,
  onChange,
  min = DEFAULT_STEPS[0],
  max = DEFAULT_STEPS[DEFAULT_STEPS.length - 1],
  steps = DEFAULT_STEPS,
  className,
}: ViewsSliderProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const fillPercent = ((value - min) / (max - min)) * 100;

  const getValueFromPosition = React.useCallback(
    (clientX: number) => {
      if (!trackRef.current) return value;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + percent * (max - min);
      return Math.round(raw / 10000) * 10000;
    },
    [min, max, value]
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const newVal = getValueFromPosition(e.clientX);
      onChange(newVal);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getValueFromPosition, onChange]
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const newVal = getValueFromPosition(e.clientX);
      onChange(newVal);
    },
    [isDragging, getValueFromPosition, onChange]
  );

  const handlePointerUp = React.useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className={cn("relative select-none", className)} data-vaul-no-drag>
      {/* Value bubble */}
      <div className="flex justify-center mb-3">
        <div className="bg-stone-900 text-white text-sm font-medium font-rethink px-3 py-1 rounded-full">
          {formatFullNumber(value)} views
        </div>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-[30px] bg-stone-200 rounded-full cursor-pointer overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        tabIndex={0}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${formatFullNumber(value)} views`}
      >
        {/* Fill */}
        <div
          className="absolute top-0 left-0 h-full bg-stone-900 rounded-full transition-[width] duration-75"
          style={{ width: `${fillPercent}%` }}
        />

        {/* Milestone dots */}
        {steps.map((step) => {
          const percent = ((step - min) / (max - min)) * 100;
          const isPassed = step <= value;
          return (
            <div
              key={step}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-[5]"
              style={{ left: `${percent}%` }}
            >
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isPassed ? "bg-white/70" : "bg-stone-300"
                )}
              />
            </div>
          );
        })}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-5 h-5 bg-white rounded-full border border-stone-200 transition-[left] duration-75"
          style={{ left: `${fillPercent}%` }}
        />
      </div>

      {/* Step labels — clickable presets */}
      <div className="flex justify-between mt-2 px-0">
        {steps.map((step) => {
          const isClosest = steps.reduce((prev, curr) =>
            Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
          ) === step;
          return (
            <button
              key={step}
              type="button"
              onClick={() => onChange(step)}
              className={cn(
                "text-[10px] font-medium font-rethink tracking-[-0.01em]",
                isClosest ? "text-stone-900" : "text-stone-400"
              )}
              style={{ width: `${100 / steps.length}%` }}
            >
              {formatCompact(step)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
