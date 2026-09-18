"use client";

import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import { InfoTooltip } from "@ep/ui/components/info-tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@ep/ui/components/dropdown-menu";
import { Field, TEXT_INPUT_CLASS } from "./wizard-fields";
import {
  CAMPAIGN_TYPES,
  applyCampaignType,
  isDestinationUrl,
  selectedCampaignType,
  type WizardData,
} from "./wizard-state";
import { getToken } from "../../lib/api";

import emptyCampaignCover from "@ep/ui/assets/empty campaign cover.png";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

interface StepObjectiveProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  categoryOptions: string[];
}

export function StepObjective({ data, update, categoryOptions }: StepObjectiveProps) {
  const { toast } = useToast();
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [destinationTouched, setDestinationTouched] = React.useState(false);
  const destinationError =
    destinationTouched && data.destinationUrl.trim() && !isDestinationUrl(data.destinationUrl)
      ? "The link must start with http:// or https://."
      : "";

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      toast("That image is over 10MB. Upload a smaller one.", "error");
      if (coverInputRef.current) coverInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const url = await uploadFile(file, "image", { token: getToken(), onProgress: (p) => setProgress(p * 0.9) });
      update({ coverImageUrl: url });
    } catch (err: unknown) {
      toast(err instanceof Error && err.message ? err.message : "We couldn't upload the image. Try again.", "error");
    } finally {
      setUploading(false);
      setProgress(0);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-12">
      <div className="space-y-10">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 bg-neutral-100 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
            {data.coverImageUrl ? (
              <img src={data.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
            ) : (
              <Image src={emptyCampaignCover} alt="" width={48} height={48} className="object-contain" unoptimized />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-neutral-500 font-rethink">Campaign Cover</span>
              <InfoTooltip text="Shown to creators in the marketplace. 1200×630px recommended, up to 10MB." />
            </span>
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
            {uploading ? (
              <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress}>
                <div className="h-full bg-neutral-900 rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="px-4 py-1.5 bg-white border border-neutral-200 rounded-full text-xs font-medium text-neutral-900 font-rethink"
              >
                {data.coverImageUrl ? "Change image" : "Upload image"}
              </button>
            )}
          </div>
        </div>

        <Field label="Campaign Name" htmlFor="campaign-name" tooltip="The name creators see for this campaign">
          <input
            id="campaign-name"
            type="text"
            placeholder="e.g. Detty December Giveaway"
            maxLength={120}
            value={data.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ name: e.target.value })}
            className={TEXT_INPUT_CLASS}
          />
        </Field>

        <Field label="Industry" tooltip="The industry your brand is in" hint="Helps us match you with the right creators.">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(TEXT_INPUT_CLASS, "text-left flex items-center justify-between")}>
                {data.category ? (
                  <span>{data.category}</span>
                ) : (
                  <span className="text-neutral-400">Select your industry</span>
                )}
                <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] max-h-56 overflow-y-auto">
              {categoryOptions.map((category) => (
                <DropdownMenuItem
                  key={category}
                  onSelect={() => update({ category })}
                  className={cn("font-medium", data.category === category ? "text-neutral-900" : "text-neutral-700")}
                >
                  {category}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-medium text-neutral-900 font-rethink leading-relaxed">
          Pick the campaign type that fits your goal — it decides how creators are paid and what you pay for.
        </p>

        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Campaign type">
          {CAMPAIGN_TYPES.map((option) => {
            const selected = data.typeChosen && selectedCampaignType(data) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update({ ...applyCampaignType(option.value), typeChosen: true })}
                className={cn(
                  "w-full text-left px-4 py-4 rounded-2xl border bg-white transition-colors",
                  selected ? "border-neutral-900" : "border-neutral-200"
                )}
              >
                <span className="block text-sm font-semibold text-neutral-900 font-rethink">{option.title}</span>
                <span className="block mt-1 text-xs font-medium text-neutral-500 font-rethink leading-relaxed">{option.body}</span>
              </button>
            );
          })}
        </div>
      </div>

      {data.objective === "clicks" && (
        <Field
          label="Destination Link"
          htmlFor="destination-url"
          hint="Each creator gets a tracked link that sends people here. You can't change it after launch."
        >
          <input
            id="destination-url"
            type="url"
            inputMode="url"
            placeholder="https://yourwebsite.com/offer"
            maxLength={2000}
            value={data.destinationUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ destinationUrl: e.target.value })}
            onBlur={() => setDestinationTouched(true)}
            aria-invalid={destinationError ? true : undefined}
            aria-describedby={destinationError ? "destination-url-error" : undefined}
            className={cn(TEXT_INPUT_CLASS, destinationError && "border-red-300")}
          />
          {destinationError && (
            <p id="destination-url-error" className="text-[11px] text-red-600 font-medium font-rethink">
              {destinationError}
            </p>
          )}
        </Field>
      )}
    </div>
  );
}