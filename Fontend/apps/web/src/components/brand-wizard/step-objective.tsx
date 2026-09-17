"use client";

import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@ep/ui/components/dropdown-menu";
import { Field, OptionCard, StepHeading, TEXT_INPUT_CLASS } from "./wizard-fields";
import { OBJECTIVE_OPTIONS, isDestinationUrl, type WizardData } from "./wizard-state";
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
    <div className="space-y-8">
      <StepHeading title="What do you want from this campaign?" body="Your objective decides how creators are paid and what you pay for." />

      <div className="flex items-center gap-4">
        <div className="w-20 h-20 bg-stone-100 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
          {data.coverImageUrl ? (
            <img src={data.coverImageUrl} alt="Campaign cover" className="w-full h-full object-cover" />
          ) : (
            <Image src={emptyCampaignCover} alt="" width={48} height={48} className="object-contain" unoptimized />
          )}
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-xs font-medium text-stone-900 font-rethink">Campaign Cover</p>
          <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
          {uploading ? (
            <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress}>
              <div className="h-full bg-stone-900 rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="px-4 py-1.5 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-900 font-rethink"
            >
              {data.coverImageUrl ? "Change image" : "Upload image"}
            </button>
          )}
          <p className="text-[10px] font-medium text-stone-400 font-rethink">The image creators see first. Up to 10MB.</p>
        </div>
      </div>

      <Field label="Campaign Name" htmlFor="campaign-name" tooltip="The name creators see for this campaign">
        <input
          id="campaign-name"
          type="text"
          placeholder="Summer lookbook"
          maxLength={120}
          value={data.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ name: e.target.value })}
          className={TEXT_INPUT_CLASS}
        />
      </Field>

      <Field label="Industry" tooltip="The industry your brand is in">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(TEXT_INPUT_CLASS, "text-left flex items-center justify-between")}>
              <span>{data.category}</span>
              <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px] max-h-56 overflow-y-auto">
            {categoryOptions.map((category) => (
              <DropdownMenuItem
                key={category}
                onSelect={() => update({ category })}
                className={cn("font-medium", data.category === category ? "text-stone-900" : "text-stone-700")}
              >
                {category}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Field>

      <fieldset className="space-y-3" role="radiogroup" aria-label="Objective">
        <legend className="text-xs font-medium text-stone-500 font-rethink mb-3">Objective</legend>
        {OBJECTIVE_OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            title={option.title}
            body={option.body}
            selected={data.objective === option.value}
            disabled={!option.available}
            badge={option.available ? undefined : "Coming soon"}
            onSelect={() => update({ objective: option.value })}
          />
        ))}
      </fieldset>

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
