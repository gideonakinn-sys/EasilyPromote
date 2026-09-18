"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, CloudUploadIcon, Delete01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@ep/ui/components/dropdown-menu";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import { ChipGroup, Field, ListInput, TEXTAREA_CLASS, TEXT_INPUT_CLASS, toggleValue } from "./wizard-fields";
import { PLATFORM_OPTIONS, type WizardBrief, type WizardData } from "./wizard-state";
import { getToken } from "../../lib/api";

interface StepBriefProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const withHash = (value: string) => (value.startsWith("#") ? value : `#${value}`).replace(/\s+/g, "");

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const EDITOR_PLACEHOLDER = "e.g. Film a 30s morning skincare routine featuring the serum. Casual, natural light, talk to camera…";

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

// Pending confirmation: we cap previews at 50MB each for now (the API allows 100MB).
const MAX_REFERENCE_FILES = 5;
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

function labelFor(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

// A small formatting-editor built on contentEditable: Bold / Italic / Strikethrough / Link,
// Write and Preview tabs and a live word counter.
function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string, plainText: string) => void }) {
  const { toast } = useToast();
  const ref = React.useRef<HTMLDivElement>(null);
  const [tab, setTab] = React.useState<"write" | "preview">("write");
  const [wordCount, setWordCount] = React.useState(0);
  const [marks, setMarks] = React.useState({ bold: false, italic: false, strike: false });

  React.useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML || "";
    setWordCount(countWords(ref.current?.textContent || ""));
    onChange(html, (ref.current?.textContent || "").trim());
  };

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt("Enter the link URL (https://…)"); // eslint-disable-line no-alert
    if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
  };

  React.useEffect(() => {
    const updateMarks = () => {
      const inEditor = ref.current && document.activeElement === ref.current;
      if (!inEditor) return;
      setMarks({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        strike: document.queryCommandState("strikeThrough"),
      });
    };
    document.addEventListener("selectionchange", updateMarks);
    return () => document.removeEventListener("selectionchange", updateMarks);
  }, [tab]);

  const markButton = (label: string, command: () => void, active: boolean) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={command}
      aria-pressed={active}
      className={cn(
        "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold font-rethink",
        active ? "bg-neutral-900 text-white" : "text-neutral-600"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-2 py-1.5">
        <div className="flex items-center gap-1">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium font-rethink",
                tab === t ? "bg-neutral-900 text-white" : "text-neutral-500"
              )}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-medium text-neutral-400 font-rethink" aria-live="polite">
          {wordCount.toLocaleString()} words
        </span>
      </div>

      {tab === "write" && (
        <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {markButton("B", () => exec("bold"), marks.bold)}
            {markButton("I", () => exec("italic"), marks.italic)}
            {markButton("S", () => exec("strikeThrough"), marks.strike)}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addLink}
              className="h-8 rounded-lg px-2 text-xs font-medium font-rethink text-neutral-600"
            >
              Link
            </button>
          </div>
          <button
            type="button"
            onClick={() => toast("Write with AI is coming soon.", "error")}
            className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium font-rethink text-neutral-700"
          >
            Write with AI
          </button>
        </div>
      )}

      {tab === "preview" ? (
        <div className="min-h-[160px] px-4 py-3 text-sm leading-relaxed text-neutral-900 font-rethink empty:hidden" dangerouslySetInnerHTML={{ __html: value }} />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          data-placeholder={EDITOR_PLACEHOLDER}
          className="relative min-h-[160px] px-4 py-3 text-sm leading-relaxed text-neutral-900 font-rethink focus:outline-none empty:before:absolute empty:before:text-neutral-300 empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]"
        />
      )}
    </div>
  );
}

// PNG or MP4 preview files plus links to existing content, five items in total.
function ReferenceContent({ files, links, onChangeFiles, onChangeLinks }: {
  files: { url: string; name: string }[];
  links: string[];
  onChangeFiles: (files: { url: string; name: string }[]) => void;
  onChangeLinks: (links: string[]) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [linksOpen, setLinksOpen] = React.useState(false);
  const total = files.length + links.length;
  const room = MAX_REFERENCE_FILES - total;

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (picked.length === 0) return;
    const allowed = files.length + picked.length <= MAX_REFERENCE_FILES ? picked : picked.slice(0, room);
    if (allowed.length < picked.length) toast(`You can add up to ${MAX_REFERENCE_FILES} files.`, "error");
    setUploading(true);
    try {
      const done: { url: string; name: string }[] = [];
      for (const file of allowed) {
        if (file.type !== "image/png" && file.type !== "video/mp4") {
          toast("Only PNG and MP4 files are supported.", "error");
          continue;
        }
        if (file.size > MAX_REFERENCE_BYTES) {
          toast(`${file.name} is over 50MB.`, "error");
          continue;
        }
        const url = await uploadFile(file, file.type === "video/mp4" ? "video" : "image", { token: getToken() });
        done.push({ url, name: file.name });
      }
      if (done.length > 0) onChangeFiles([...files, ...done].slice(0, MAX_REFERENCE_FILES));
    } catch (err: unknown) {
      toast(err instanceof Error && err.message ? err.message : "We couldn't upload that file. Try again.", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={uploading || room <= 0}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium font-rethink text-neutral-700 disabled:opacity-50"
        >
          <HugeiconsIcon icon={CloudUploadIcon} size={16} className="text-neutral-500" />
          {uploading ? "Uploading…" : room > 0 ? "Select file" : "Up to 5 files"}
        </button>
        <button
          type="button"
          disabled={room <= 0}
          onClick={() => setLinksOpen((open) => !open)}
          aria-pressed={linksOpen}
          className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium font-rethink text-neutral-700 disabled:opacity-50"
        >
          Add link
        </button>
        <input ref={fileInputRef} type="file" accept=".png,.mp4,video/mp4,image/png" multiple onChange={handleFiles} className="hidden" />
        <span className="ml-auto self-center text-[11px] font-medium text-neutral-400 font-rethink tabular-nums">
          {total.toLocaleString()} / {MAX_REFERENCE_FILES.toLocaleString()}
        </span>
      </div>

      {linksOpen && (
        <ListInput
          id="brief-reference-links"
          items={links}
          onChange={onChangeLinks}
          placeholder="https://www.instagram.com/reel/…"
          maxItems={room}
          maxLength={500}
        />
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file) => (
            <li key={file.url} className="inline-flex items-center gap-2 rounded-full bg-neutral-100 py-1.5 pl-3 pr-2">
              <HugeiconsIcon icon={File01Icon} size={14} className="text-neutral-500" />
              <span className="text-xs font-medium text-neutral-600 font-rethink">{file.name}</span>
              <button
                type="button"
                onClick={() => onChangeFiles(files.filter((item) => item.url !== file.url))}
                aria-label={`Remove ${file.name}`}
                className="text-neutral-400"
              >
                <HugeiconsIcon icon={Delete01Icon} size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
      <Field label="Creator Brief" hint="Include the format, length, and key message.">
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
            <RichTextEditor value={brief.creatorBrief} onChange={(html, plainText) => setBrief({ creatorBrief: html, summary: plainText })} />
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

      <Field label="Key message" hint="The main thing you want viewers to take away or do — your CTA, if you have one.">
        <input
          type="text"
          maxLength={200}
          placeholder="e.g. Try the serum before bed"
          value={brief.keyMessage}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ keyMessage: e.target.value })}
          className={TEXT_INPUT_CLASS}
        />
      </Field>

      <Field label="What type of content?" hint="Pick the formats creators should make for each platform you chose.">
        <div className="space-y-4">
          {data.platforms.length === 0 ? (
            <p className="text-xs font-medium text-neutral-400 font-rethink">Choose platforms on the Audience step first.</p>
          ) : (
            data.platforms.map((platform) => {
              const group = CONTENT_TYPES_BY_PLATFORM[platform];
              if (!group) return null;
              return (
                <div key={platform} className="space-y-2">
                  <p className="text-xs font-medium text-neutral-500 font-rethink">{platformLabel(platform)}</p>
                  <ChipGroup
                    label={`${platformLabel(platform)} content types`}
                    options={group}
                    selected={brief.contentTypes}
                    onToggle={(value) => setBrief({ contentTypes: toggleValue(brief.contentTypes, value) })}
                  />
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

      <Field label="Reference content" hint="PNG or MP4 files (up to 50MB each), or links to examples you like.">
        <ReferenceContent
          files={brief.referenceFiles}
          links={brief.referenceVideos}
          onChangeFiles={(referenceFiles) => setBrief({ referenceFiles })}
          onChangeLinks={(referenceVideos) => setBrief({ referenceVideos })}
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
              <Field label="Quantity">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  value={brief.deliverablesQuantity}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBrief({ deliverablesQuantity: e.target.value.replace(/\D/g, "") || "1" })
                  }
                  className={cn(TEXT_INPUT_CLASS, "tabular-nums")}
                />
              </Field>
              <Field label="Approx. length">
                <input
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
          <Field label="How long can you flag content after it's submitted?" hint="After this window, submitted content is confirmed and creators are paid based on views.">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(TEXT_INPUT_CLASS, "flex items-center justify-between gap-2 text-left")}>
                  <span>{brief.disputeWindow}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-neutral-400 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[200px]">
                <DropdownMenuRadioGroup value={brief.disputeWindow} onValueChange={(value) => setBrief({ disputeWindow: value as WizardBrief["disputeWindow"] })}>
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