"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { Field, StepHeading, TEXT_INPUT_CLASS } from "./wizard-fields";
import { MAX_DELIVERABLES, MIN_VIEWS, usesReferralBudget, type WizardData } from "./wizard-state";
import type { CampaignQuote } from "../types";
import { MIN_REFERRAL_BUDGET, formatNaira } from "../../lib/referral";

const PRESET_VIEWS = [100000, 1000000, 5000000, 10000000, 20000000] as const;

const formatCompact = (value: number) =>
  value >= 1000000 ? `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(value / 1000)}K`;

const digitsOnly = (value: string) => value.replace(/\D/g, "");

interface QuoteSummaryProps {
  quote: CampaignQuote | null;
  loading: boolean;
  error: string;
}

// Numbers come from the API's calculator, the same one checkout charges with.
export function QuoteSummary({ quote, loading, error }: QuoteSummaryProps) {
  const rows: { label: string; value: number | undefined }[] = [
    { label: "Creator Budget", value: quote?.creatorBudget },
    { label: "Performance Budget", value: quote?.performanceBudget },
    { label: "Platform Fee", value: quote?.platformFee },
  ];
  return (
    <div className="bg-white border border-stone-200 rounded-[18px] p-4 space-y-2 text-xs font-rethink" aria-live="polite" aria-busy={loading}>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <span className="font-medium text-stone-500">{row.label}</span>
          <span className={cn("font-medium tabular-nums", loading ? "text-stone-300" : "text-stone-900")}>
            {quote ? formatNaira(row.value) : "—"}
          </span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-stone-100 pt-2">
        <span className="font-medium text-stone-900">Total to Pay</span>
        <span className={cn("font-medium tabular-nums", loading ? "text-stone-300" : "text-stone-900")}>
          {quote ? formatNaira(quote.total) : "—"}
        </span>
      </div>
      {error && <p className="text-red-600 font-medium pt-1">{error}</p>}
    </div>
  );
}

interface ViewsPickerProps {
  views: number;
  onChange: (views: number) => void;
}

function ViewsPicker({ views, onChange }: ViewsPickerProps) {
  const [input, setInput] = React.useState(views.toLocaleString());

  React.useEffect(() => {
    setInput(views.toLocaleString());
  }, [views]);

  return (
    <Field label="Target Views" htmlFor="target-views" hint={`${MIN_VIEWS.toLocaleString()} views minimum. The price comes from our price table.`}>
      <input
        id="target-views"
        type="text"
        inputMode="numeric"
        value={input}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const digits = digitsOnly(e.target.value);
          setInput(digits ? Number(digits).toLocaleString() : "");
          if (digits && Number(digits) >= MIN_VIEWS) onChange(Number(digits));
        }}
        onBlur={() => setInput(views.toLocaleString())}
        className={TEXT_INPUT_CLASS}
      />
      <div className="flex gap-2">
        {PRESET_VIEWS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={views === preset}
            onClick={() => onChange(preset)}
            className={cn(
              "flex-1 py-2 rounded-full text-xs font-medium font-rethink transition-colors",
              views === preset ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600"
            )}
          >
            {formatCompact(preset)}
          </button>
        ))}
      </div>
    </Field>
  );
}

interface StepPayProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  quote: CampaignQuote | null;
  quoteLoading: boolean;
  quoteError: string;
}

export function StepPay({ data, update, quote, quoteLoading, quoteError }: StepPayProps) {
  const isContent = data.objective === "content";
  const referral = usesReferralBudget(data.objective);
  const actionNoun = data.objective === "downloads" ? "download" : "sign-up";

  return (
    <div className="space-y-8">
      <StepHeading
        title="What you'll pay"
        body={
          isContent
            ? "You set what creators earn for each deliverable you approve. Our fee is added on top, so creators get exactly your rate."
            : referral
              ? `You fund a budget and our team sets what creators earn per ${actionNoun}.`
              : "You choose how many views you want. The price comes from our price table."
        }
      />

      {isContent && (
        <>
          <Field label="Creator Pay Per Approved Deliverable" htmlFor="rate-per-deliverable" hint="A deliverable is one piece of content, such as one video.">
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-stone-400 font-rethink" aria-hidden="true">₦</span>
              <input
                id="rate-per-deliverable"
                inputMode="numeric"
                placeholder="15000"
                value={data.ratePerDeliverable}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ ratePerDeliverable: digitsOnly(e.target.value) })}
                className={cn(TEXT_INPUT_CLASS, "pl-8")}
              />
            </div>
          </Field>
          <Field
            label="Number of Deliverables"
            htmlFor="deliverables"
            hint={`Each deliverable is one Placement a creator can take. Up to ${MAX_DELIVERABLES}.`}
          >
            <input
              id="deliverables"
              inputMode="numeric"
              placeholder="10"
              value={data.deliverables}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const digits = digitsOnly(e.target.value).slice(0, 3);
                update({ deliverables: digits && Number(digits) > MAX_DELIVERABLES ? String(MAX_DELIVERABLES) : digits });
              }}
              className={TEXT_INPUT_CLASS}
            />
          </Field>
        </>
      )}

      {!isContent && <ViewsPicker views={data.views} onChange={(views) => update({ views })} />}

      {referral && (
        <Field label="Referral Budget" htmlFor="referral-budget" hint={`Minimum ${formatNaira(MIN_REFERRAL_BUDGET)}. Paid together with your views.`}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-stone-400 font-rethink" aria-hidden="true">₦</span>
            <input
              id="referral-budget"
              inputMode="numeric"
              placeholder="100000"
              value={data.referralBudget}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ referralBudget: digitsOnly(e.target.value) })}
              className={cn(TEXT_INPUT_CLASS, "pl-8")}
            />
          </div>
          <p className="bg-stone-100 rounded-2xl px-4 py-3 text-xs text-stone-600 font-medium font-rethink">
            Reward per {actionNoun} is set by our team.
          </p>
        </Field>
      )}

      <QuoteSummary quote={quote} loading={quoteLoading} error={quoteError} />
    </div>
  );
}
