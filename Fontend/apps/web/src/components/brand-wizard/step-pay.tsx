"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { InfoTooltip } from "@ep/ui/components/info-tooltip";
import { Field, OptionCard, TEXT_INPUT_CLASS } from "./wizard-fields";
import {
  BONUS_METRIC_OPTIONS,
  MAX_DELIVERABLES,
  MIN_BONUS_POOL,
  MIN_VIEWS,
  PAY_SHAPE_OPTIONS,
  usesReferralBudget,
  hasViewsTarget,
  actionNoun,
  type WizardData,
} from "./wizard-state";
import type { CampaignQuote } from "../types";
import { MIN_REFERRAL_BUDGET, formatNaira } from "../../lib/referral";

const PRESET_VIEWS = [100000, 1000000, 5000000, 10000000, 20000000] as const;

const formatCompact = (value: number) =>
  value >= 1000000 ? `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M` : `${Math.round(value / 1000)}K`;

const digitsOnly = (value: string) => value.replace(/\D/g, "");

const PLATFORM_FEE_TOOLTIP = "Covers payment processing, creator matching, and dispute support.";

// Which cost rows the breakdown should show, by campaign type.
export type PayVariant = "views" | "signups" | "hybrid" | "content";

export function payVariant(data: Pick<WizardData, "objective" | "payShape" | "includeViews">): PayVariant {
  if (data.objective === "content") return "content";
  if (!usesReferralBudget(data.objective)) return "views";
  return hasViewsTarget(data) ? "hybrid" : "signups";
}

interface QuoteSummaryProps {
  variant: PayVariant;
  quote: CampaignQuote | null;
  loading: boolean;
  error: string;
}

// Numbers come from the API's calculator, the same one checkout charges with. The rows follow the
// campaign type: Views and Content pay the creator budget, sign-ups pay a performance budget,
// Hybrid shows both.
export function QuoteSummary({ variant, quote, loading, error }: QuoteSummaryProps) {
  const hybridBonus = quote?.bonusPool !== undefined;
  const rows: { label: string; value: number | undefined; tooltip?: string }[] =
    variant === "signups"
      ? [
          { label: "Referral Budget", value: quote?.performanceBudget },
          { label: "Platform Fee", value: quote?.platformFee, tooltip: PLATFORM_FEE_TOOLTIP },
        ]
      : variant === "hybrid"
        ? [
            { label: "Creator Budget", value: quote?.creatorBudget },
            { label: "Referral Budget", value: quote?.performanceBudget },
            { label: "Platform Fee", value: quote?.platformFee, tooltip: PLATFORM_FEE_TOOLTIP },
          ]
        : [
            { label: "Creator Budget", value: quote?.creatorBudget },
            ...(variant === "content" && hybridBonus ? [{ label: "Bonus Pool", value: quote?.bonusPool }] : []),
            { label: "Platform Fee", value: quote?.platformFee, tooltip: PLATFORM_FEE_TOOLTIP },
          ];
  return (
    <div className="bg-white border border-neutral-200 rounded-[18px] p-6 space-y-4 text-xs font-rethink" aria-live="polite" aria-busy={loading}>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-neutral-500">{row.label}</span>
            {row.tooltip && <InfoTooltip text={row.tooltip} />}
          </span>
          <span className={cn("font-medium tabular-nums", loading ? "text-neutral-300" : "text-neutral-900")}>
            {quote ? formatNaira(row.value) : "—"}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-4">
        <span className="font-semibold text-sm text-neutral-900">Total to Pay</span>
        <span className={cn("text-xl font-semibold tabular-nums tracking-tight", loading ? "text-neutral-300" : "text-neutral-900")}>
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
    <Field label="Target Views" htmlFor="target-views" hint={`${MIN_VIEWS.toLocaleString()} views minimum. You can enter any amount above that — cost updates automatically.`}>
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
        className={cn(TEXT_INPUT_CLASS, "tabular-nums")}
      />
      <div className="flex gap-2">
        {PRESET_VIEWS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={views === preset}
            onClick={() => onChange(preset)}
            className={cn(
              "flex-1 py-2 rounded-full text-xs font-medium font-rethink tabular-nums transition-colors",
              views === preset ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
            )}
          >
            {formatCompact(preset)}
          </button>
        ))}
      </div>
    </Field>
  );
}

// A whole-naira amount input with a ₦ prefix.
function NairaInput({ id, value, placeholder, onChange }: { id: string; value: string; placeholder: string; onChange: (digits: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">₦</span>
      <input
        id={id}
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(digitsOnly(e.target.value))}
        className={cn(TEXT_INPUT_CLASS, "pl-8 tabular-nums")}
      />
    </div>
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
  const unitNoun = actionNoun(data.objective);
  const hybrid = isContent && data.payShape === "hybrid";
  const views = hasViewsTarget(data);
  const variant = payVariant(data);

  return (
    <div className="space-y-10">
      {isContent && (
        <Field label="How Creators Are Paid">
          <div role="radiogroup" aria-label="How creators are paid" className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {PAY_SHAPE_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                title={option.title}
                body={option.body}
                selected={data.payShape === option.value}
                onSelect={() => update({ payShape: option.value })}
              />
            ))}
          </div>
        </Field>
      )}

      {isContent && (
        <>
          <Field
            label={hybrid ? "Base Pay Per Approved Deliverable" : "Creator Pay Per Approved Deliverable"}
            htmlFor="rate-per-deliverable"
            hint="A deliverable is one piece of content, such as one video."
          >
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">₦</span>
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

      {hybrid && (
        <>
          <Field label="What the Bonus Pays For">
            <div role="radiogroup" aria-label="What the bonus pays for" className="space-y-2">
              {BONUS_METRIC_OPTIONS.map((option) => (
                <OptionCard
                  key={option.value}
                  title={option.title}
                  body={option.body}
                  selected={data.bonusMetric === option.value}
                  onSelect={() => update({ bonusMetric: option.value })}
                />
              ))}
            </div>
          </Field>
          <Field label="Bonus Pool" htmlFor="bonus-pool" hint={`Minimum ${formatNaira(MIN_BONUS_POOL)}. Paid with the base; what isn't earned is refunded when the campaign ends.`}>
            <NairaInput id="bonus-pool" placeholder="50000" value={data.bonusPool} onChange={(bonusPool) => update({ bonusPool })} />
          </Field>
          <Field label="Most One Creator Can Earn in Bonus" htmlFor="bonus-cap" hint="No more than the bonus pool.">
            <NairaInput id="bonus-cap" placeholder="10000" value={data.bonusCap} onChange={(bonusCap) => update({ bonusCap })} />
          </Field>
          <p className="bg-neutral-100 rounded-2xl px-4 py-3 text-xs text-neutral-600 font-medium font-rethink">
            {data.bonusMetric === "views"
              ? "The bonus per 1,000 views comes from our price table."
              : `Bonus per ${actionNoun(data.bonusMetric)} is set by our team. Your app needs to be connected before you pay.`}
          </p>
        </>
      )}

      {views && <ViewsPicker views={data.views} onChange={(views) => update({ views })} />}

      {referral && (
        <Field label="Referral Budget" htmlFor="referral-budget" hint={`Minimum ${formatNaira(MIN_REFERRAL_BUDGET)}. ${views ? "Paid together with your views." : "You're only charged for sign-ups you get — anything unused is refunded at the end."}`}>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-neutral-400 font-rethink" aria-hidden="true">₦</span>
            <input
              id="referral-budget"
              inputMode="numeric"
              placeholder="100000"
              value={data.referralBudget}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ referralBudget: digitsOnly(e.target.value) })}
              className={cn(TEXT_INPUT_CLASS, "pl-8")}
            />
          </div>
          <p className="bg-neutral-100 rounded-2xl px-4 py-3 text-xs text-neutral-600 font-medium font-rethink">
            Reward per {unitNoun} is set by our team.
            {data.objective === "clicks" && " Only valid clicks are paid, and each person's click counts once a day per creator link."}
          </p>
        </Field>
      )}

      <QuoteSummary variant={variant} quote={quote} loading={quoteLoading} error={quoteError} />
    </div>
  );
}
