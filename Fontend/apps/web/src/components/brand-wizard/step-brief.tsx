"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, CloudUploadIcon, Delete01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@ep/ui/components/dropdown-menu";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import { Field, ListInput, StepHeading, TEXTAREA_CLASS, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import { MAX_DELIVERABLES, PLATFORM_OPTIONS, type WizardBrief, type WizardData } from "./wizard-state";
import { getToken } from "../../lib/api";

interface StepBriefProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const withHash = (value: string) => (value.startsWith("#") ? value : `#${value}`).replace(/\s+/g, "");

const BRIEF_PLACEHOLDER = "e.g. Film a 30s morning skincare routine featuring the serum. Casual, natural light, talk to camera…";

// Content type pills grouped by the platform(s) picked on the Audience step.
const CONTENT_TYPES_BY_PLATFORM: Record<string, { value: string; label: string }[]> = {
  tiktok: [{ value: "TikTok Video", label: "Video" }],
  instagram: [
    { value: "Reel", label: "Reel" },
    { value: "Story", label: "Story" },
    { value: "Post", label: "Post" },
    { value: "Carousel", label: "Carousel" },
  ],
  youtube: [
    { value: "YouTube Video", label: "Video" },
    { value: "YouTube Short", label: "Short" },
  ],
  facebook: [
    { value: "Facebook Video", label: "Video" },
    { value: "Facebook Photo", label: "Photo" },
  ],
  twitter: [
    { value: "X Video", label: "Video" },
    { value: "X Post", label: "Post" },
  ],
};

const USAGE_RIGHTS_CHOICES = [
  { value: "campaign", label: "Campaign use only" },
  { value: "paid_ads", label: "Can be used in brand's paid ads" },
  { value: "anywhere", label: "Can be used anywhere, indefinitely." },
] as const;

const DISPUTE_WINDOWS = ["24h", "48h", "72h"] as const;

function labelFor(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function StepBrief({ data, update }: StepBriefProps) {
  const { toast } = useToast();
  const scriptInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const brief = data.brief;
  const setBrief = (patch: Partial<WizardBrief>) => update({ brief: { ...brief, ...patch } });
  const isContent = data.objective === "content";
  const isViews = data.objective === "views";
  const platformLabel = (value: string) => PLATFORM_OPTIONS.find((option) => option.value === value)?.label ?? value;

  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type && file.type !== "application/pdf") {
      toast("Only PDF files are supported.", "error");
      if (scriptInputRef.current) scriptInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file, "document", { token: getToken() });
      update({ scriptUrl: url, scriptFileName: file.name });
    } catch (err: unknown) {
      toast(err instanceof Error && err.message ? err.message : "We couldn't upload the document. Try again.", "error");
    } finally {
      setUploading(false);
      if (scriptInputRef.current) scriptInputRef.current.value = "";
    }
  };

  const soundField = (
    <Field label="Sound" htmlFor="brief-sound" hint="Link to the audio/sound you want creators to use, if any.">
      <input
        id="brief-sound"
        type="url"
        maxLength={500}
        placeholder="https://www.tiktok.com/music/..."
        value={brief.soundUrl}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ soundUrl: e.target.value })}
        className={TEXT_INPUT_CLASS}
      />
    </Field>
  );

  return (
    <div className="space-y-8">
      <Field label="Creator Brief" htmlFor="brief-creator" hint={brief.briefMode === "write" ? "Include the format, length, and key message." : undefined}>
        <div className="space-y-3">
          <div className="inline-flex rounded-full bg-neutral-100 p-1" role="tablist" aria-label="How you write the brief">
            {(["write", "upload"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={brief.briefMode === mode}
                onClick={() => setBrief({ briefMode: mode })}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium font-rethink",
                  brief.briefMode === mode ? "bg-white text-neutral-900" : "text-neutral-500"
                )}
              >
                {mode === "write" ? "Write" : "Upload brief"}
              </button>
            ))}
          </div>

          {brief.briefMode === "write" ? (
            <textarea
              id="brief-creator"
              maxLength={4000}
              placeholder={BRIEF_PLACEHOLDER}
              value={brief.summary}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief({ summary: e.target.value })}
              className={cn(TEXTAREA_CLASS, "min-h-[160px]")}
            />
          ) : (
            <div className="space-y-2">
              <input ref={scriptInputRef} type="file" accept=".pdf" onChange={handleScriptUpload} className="hidden" />
              {data.scriptFileName ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 py-1.5 pl-3 pr-2">
                  <HugeiconsIcon icon={File01Icon} size={14} className="text-neutral-500" />
                  <span className="text-xs font-medium text-neutral-600 font-rethink">{data.scriptFileName}</span>
                  <button
                    type="button"
                    onClick={() => update({ scriptUrl: "", scriptFileName: "" })}
                    aria-label="Remove document"
                    className="text-neutral-400"
                  >
                    <HugeiconsIcon icon={Delete01Icon} size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => scriptInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-white py-6 text-sm font-medium text-neutral-500 font-rethink disabled:opacity-60"
                >
                  <HugeiconsIcon icon={CloudUploadIcon} size={24} className="text-neutral-400" />
                  <span>{uploading ? "Uploading…" : "Attach PDF"}</span>
                </button>
              )}
              <p className="text-xs text-neutral-400 font-medium font-rethink leading-relaxed">Upload a PDF instead of writing the brief here.</p>
            </div>
          )}
        </div>
      </Field>

      <Field label="Key message" htmlFor="brief-key-message" tooltip="The main thing you want viewers to take away or do — your CTA, if you have one.">
        <input
          id="brief-key-message"
          type="text"
          maxLength={200}
          placeholder="e.g. Try the serum before bed"
          value={brief.keyMessage}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ keyMessage: e.target.value })}
          className={TEXT_INPUT_CLASS}
        />
      </Field>

      <Field label="What type of content?" tooltip="Pick the formats creators should make for each platform you chose.">
        <div className="space-y-4">
          {data.platforms.length === 0 ? (
            <p className="text-xs font-medium text-neutral-400 font-rethink">Choose platforms on the Audience step first.</p>
          ) : (
            data.platforms.map((platform) => {
              const group = CONTENT_TYPES_BY_PLATFORM[platform];
              if (!group) return null;
              const remaining = group.filter((option) => !brief.contentTypes.includes(option.value));
              const picked = group.filter((option) => brief.contentTypes.includes(option.value));
              return (
                <div key={platform} className="space-y-2">
                  <StepHeading title={platformLabel(platform)} body="" />
                  <select
                    value=""
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const value = e.target.value;
                      if (value) setBrief({ contentTypes: toggleValue(brief.contentTypes, value) });
                    }}
                    disabled={remaining.length === 0}
                    className={cn(
                      "appearance-none w-full bg-white border border-neutral-200 rounded-full px-4 py-3 text-sm font-medium font-rethink text-neutral-950 focus:outline-none focus:border-neutral-300 disabled:bg-neutral-100 cursor-pointer",
                      picked.length === 0 && "text-neutral-400"
                    )}
                  >
                    <option value="" disabled>
                      {remaining.length === 0
                        ? `All ${platformLabel(platform)} types added`
                        : picked.length > 0
                          ? "Add another"
                          : "Select a content type"}
                    </option>
                    {remaining.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {picked.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {picked.map((option) => (
                        <li key={option.value}>
                          <button
                            type="button"
                            onClick={() => setBrief({ contentTypes: toggleValue(brief.contentTypes, option.value) })}
                            aria-label={`Remove ${option.label}`}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-neutral-900 text-white text-xs font-medium font-rethink"
                          >
                            {option.label} ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Field>

      <Field label="Tone, do's & don'ts">
        <textarea
          id="brief-tone-dos-donts"
          maxLength={2000}
          placeholder="Say the brand name, no competitor products, keep it upbeat…"
          value={brief.toneDosDonts}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief({ toneDosDonts: e.target.value })}
          className={cn(TEXTAREA_CLASS, "min-h-[76px]")}
        />
      </Field>

      <Field label="Reference content" htmlFor="brief-references">
        <input
          id="brief-references"
          type="url"
          maxLength={500}
          placeholder="https://www.instagram.com/reel/…"
          value={brief.referenceVideos[0] ?? ""}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setBrief({ referenceVideos: e.target.value.trim() ? [e.target.value] : [] })
          }
          className={TEXT_INPUT_CLASS}
        />
      </Field>

      <Field label="Hashtags" htmlFor="brief-hashtags">
        <ListInput
          id="brief-hashtags"
          items={brief.hashtags}
          onChange={(hashtags) => setBrief({ hashtags })}
          placeholder="#SummerDrop"
          maxItems={20}
          maxLength={60}
          normalize={withHash}
        />
      </Field>

      {isContent && (
        <>
          <Field label="Deliverables" hint="How many pieces of content creators will submit.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" htmlFor="brief-deliverables-qty">
                <input
                  id="brief-deliverables-qty"
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="10"
                  value={data.deliverables}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                    update({ deliverables: digits && Number(digits) > MAX_DELIVERABLES ? String(MAX_DELIVERABLES) : digits });
                  }}
                  className={cn(TEXT_INPUT_CLASS, "tabular-nums")}
                />
              </Field>
              <Field label="Approx. length" htmlFor="brief-deliverables-length">
                <input
                  id="brief-deliverables-length"
                  type="text"
                  maxLength={40}
                  placeholder="30–60 sec"
                  value={brief.deliverablesLength}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ deliverablesLength: e.target.value })}
                  className={TEXT_INPUT_CLASS}
                />
              </Field>
            </div>
          </Field>

          <Field label="Submission deadline" htmlFor="brief-deadline" hint="When creators need to submit their content by.">
            <input
              id="brief-deadline"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={brief.submissionDeadline}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ submissionDeadline: e.target.value })}
              className={TEXT_INPUT_CLASS}
            />
          </Field>

          <Field label="Usage rights" hint="Let creators know how their content may be used beyond the campaign.">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(TEXT_INPUT_CLASS, "flex items-center justify-between gap-2 text-left")}>
                  <span>{labelFor(USAGE_RIGHTS_CHOICES, brief.usageRightsChoice)}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
                <DropdownMenuRadioGroup
                  value={brief.usageRightsChoice}
                  onValueChange={(value) => setBrief({ usageRightsChoice: value as WizardBrief["usageRightsChoice"] })}
                >
                  {USAGE_RIGHTS_CHOICES.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          {soundField}
        </>
      )}

      {isViews && (
        <>
          <Field
            label="How long can you flag content after it's submitted?"
            tooltip="After this window, submitted content is confirmed and creators are paid based on views."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(TEXT_INPUT_CLASS, "flex items-center justify-between gap-2 text-left")}>
                  <span>{brief.disputeWindow}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
                <DropdownMenuRadioGroup
                  value={brief.disputeWindow}
                  onValueChange={(value) => setBrief({ disputeWindow: value as WizardBrief["disputeWindow"] })}
                >
                  {DISPUTE_WINDOWS.map((window) => (
                    <DropdownMenuRadioItem key={window} value={window}>
                      {window}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </Field>

          {soundField}
        </>
      )}
    </div>
  );
}