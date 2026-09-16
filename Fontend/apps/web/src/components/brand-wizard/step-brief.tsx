"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudUploadIcon, Delete01Icon, File01Icon } from "@hugeicons/core-free-icons";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import { Field, ListInput, StepHeading, TEXTAREA_CLASS, TEXT_INPUT_CLASS } from "./wizard-fields";
import type { WizardBrief, WizardData } from "./wizard-state";
import { getToken } from "../../lib/api";

interface StepBriefProps {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
}

const withHash = (value: string) => (value.startsWith("#") ? value : `#${value}`).replace(/\s+/g, "");

export function StepBrief({ data, update }: StepBriefProps) {
  const { toast } = useToast();
  const scriptInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const brief = data.brief;
  const setBrief = (patch: Partial<WizardBrief>) => update({ brief: { ...brief, ...patch } });

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

  return (
    <div className="space-y-8">
      <StepHeading title="Your brief" body="Everything a creator needs to make the content. Creators see this before they join or apply." />

      <Field label="Summary" htmlFor="brief-summary">
        <textarea
          id="brief-summary"
          maxLength={2000}
          placeholder="Style three looks from our summer drop and show how the fabric moves."
          value={brief.summary}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief({ summary: e.target.value })}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field label="Do's" htmlFor="brief-dos">
        <ListInput id="brief-dos" items={brief.dos} onChange={(dos) => setBrief({ dos })} placeholder="Show the product up close" maxItems={10} />
      </Field>

      <Field label="Don'ts" htmlFor="brief-donts">
        <ListInput id="brief-donts" items={brief.donts} onChange={(donts) => setBrief({ donts })} placeholder="No other brands in frame" maxItems={10} />
      </Field>

      <Field label="Key Messages" htmlFor="brief-key-messages" tooltip="What every creator should say or get across">
        <ListInput
          id="brief-key-messages"
          items={brief.keyMessages}
          onChange={(keyMessages) => setBrief({ keyMessages })}
          placeholder="Breathable cotton for hot days"
          maxItems={10}
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

      <Field label="Tone" htmlFor="brief-tone">
        <input
          id="brief-tone"
          type="text"
          maxLength={100}
          placeholder="Playful and upbeat"
          value={brief.tone}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBrief({ tone: e.target.value })}
          className={TEXT_INPUT_CLASS}
        />
      </Field>

      <Field label="Sound" htmlFor="brief-sound" hint="A link to the sound or song creators should use.">
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

      <Field label="Reference Videos" htmlFor="brief-references" hint="Links to videos that show what you're after.">
        <ListInput
          id="brief-references"
          items={brief.referenceVideos}
          onChange={(referenceVideos) => setBrief({ referenceVideos })}
          placeholder="https://www.tiktok.com/@brand/video/..."
          maxItems={10}
          maxLength={500}
        />
      </Field>

      <Field label="Product Info" htmlFor="brief-product">
        <textarea
          id="brief-product"
          maxLength={1000}
          placeholder="What it is, what it costs and where to buy it"
          value={brief.productInfo}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief({ productInfo: e.target.value })}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field label="Approval Requirements" htmlFor="brief-approval" hint="What content must include before you approve it.">
        <textarea
          id="brief-approval"
          maxLength={500}
          placeholder="Product visible in the first 3 seconds"
          value={brief.approvalRequirements}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBrief({ approvalRequirements: e.target.value })}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field label="Brief Document" hint="Optional. Attach a PDF if you have a longer brief.">
        <input ref={scriptInputRef} type="file" accept=".pdf" onChange={handleScriptUpload} className="hidden" />
        {data.scriptFileName ? (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full">
            <HugeiconsIcon icon={File01Icon} size={14} className="text-stone-500" />
            <span className="text-xs font-medium text-stone-600 font-rethink">{data.scriptFileName}</span>
            <button type="button" onClick={() => update({ scriptUrl: "", scriptFileName: "" })} aria-label="Remove document" className="text-stone-400 ml-0.5">
              <HugeiconsIcon icon={Delete01Icon} size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => scriptInputRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-2 py-6 bg-white border-2 border-dashed border-stone-300 rounded-2xl text-sm font-medium text-stone-500 font-rethink disabled:opacity-60"
          >
            <HugeiconsIcon icon={CloudUploadIcon} size={24} className="text-stone-400" />
            <span>{uploading ? "Uploading…" : "Attach PDF"}</span>
          </button>
        )}
      </Field>
    </div>
  );
}
