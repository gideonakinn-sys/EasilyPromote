"use client";

// The full Brief, shown once a creator holds a placement.
import * as React from "react";
import type { CreatorBrief } from "./types";

interface CampaignBriefDetailsProps {
  brief: CreatorBrief | undefined;
  showSummary?: boolean;
}

interface BriefListProps {
  title: string;
  items: string[];
}

function BriefList({ title, items }: BriefListProps) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-medium text-neutral-500 font-rethink tracking-[-0.01em]">{title}</h5>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="font-rethink text-sm text-neutral-900 font-medium leading-relaxed tracking-[-0.01em]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BriefTextProps {
  title: string;
  text: string | null;
}

function BriefText({ title, text }: BriefTextProps) {
  if (!text) return null;
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-medium text-neutral-500 font-rethink tracking-[-0.01em]">{title}</h5>
      <p className="font-rethink text-sm text-neutral-900 font-medium leading-relaxed tracking-[-0.01em]">{text}</p>
    </div>
  );
}

export function hasBriefDetails(brief: CreatorBrief | undefined): boolean {
  if (!brief) return false;
  return Boolean(
    brief.dos.length ||
      brief.donts.length ||
      brief.hashtags.length ||
      brief.soundUrl ||
      brief.referenceVideos.length ||
      brief.tone ||
      brief.keyMessages.length ||
      brief.productInfo ||
      brief.approvalRequirements
  );
}

export function CampaignBriefDetails({ brief, showSummary = false }: CampaignBriefDetailsProps) {
  if (!brief || (!hasBriefDetails(brief) && !(showSummary && brief.summary))) return null;

  return (
    <div className="space-y-6 font-rethink">
      {showSummary && <BriefText title="Brief" text={brief.summary || null} />}
      <BriefList title="Do" items={brief.dos} />
      <BriefList title="Don't" items={brief.donts} />
      <BriefList title="Key messages" items={brief.keyMessages} />
      <BriefText title="Tone" text={brief.tone} />
      <BriefText title="Product info" text={brief.productInfo} />
      {brief.hashtags.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-xs font-medium text-neutral-500 tracking-[-0.01em]">Hashtags</h5>
          <div className="flex flex-wrap gap-1.5">
            {brief.hashtags.map((tag) => (
              <span key={tag} className="px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-700 text-xs font-medium">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
      {brief.soundUrl && (
        <div className="space-y-1.5">
          <h5 className="text-xs font-medium text-neutral-500 tracking-[-0.01em]">Sound</h5>
          <a href={brief.soundUrl} target="_blank" rel="noreferrer" className="block text-sm font-medium text-blue-700 break-all">
            {brief.soundUrl}
          </a>
        </div>
      )}
      {brief.referenceVideos.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-xs font-medium text-neutral-500 tracking-[-0.01em]">Reference videos</h5>
          <ul className="space-y-1">
            {brief.referenceVideos.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 break-all">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <BriefText title="What the brand checks before approving" text={brief.approvalRequirements} />
    </div>
  );
}
