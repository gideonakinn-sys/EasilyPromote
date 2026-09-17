"use client";

import * as React from "react";
import { SummaryRow } from "./wizard-fields";
import {
  ACCESS_OPTIONS,
  BADGE_OPTIONS,
  DESTINATION_OPTIONS,
  GENDER_OPTIONS,
  OBJECTIVE_OPTIONS,
  PLATFORM_OPTIONS,
  RANK_OPTIONS,
  USAGE_RIGHTS_TEXT,
  usesReferralBudget,
  type WizardData,
} from "./wizard-state";
import type { AudienceTargeting, CampaignBrief, CampaignObjective, ContentDestination, ContentPay, CreatorAccess, CreatorEligibility } from "../types";
import { formatNaira } from "../../lib/referral";

export interface SetupSummaryInput {
  campaignObjective: CampaignObjective | null;
  contentPay: ContentPay | null;
  targetViews?: number;
  referralBudget?: number;
  contentDestination: ContentDestination | null;
  creatorAccess: CreatorAccess | null;
  audienceTargeting: AudienceTargeting;
  creatorEligibility: CreatorEligibility;
  brief: CampaignBrief;
}

const labelFor = (options: { value: string; label: string }[], value: string) => options.find((option) => option.value === value)?.label || value;
const joined = (values: string[] | undefined) => (values && values.length ? values.join(", ") : null);

export function setupFromWizard(data: WizardData): SetupSummaryInput {
  const isContent = data.objective === "content";
  return {
    campaignObjective: data.objective,
    contentPay: isContent ? { ratePerDeliverable: Number(data.ratePerDeliverable) || 0, deliverables: Number(data.deliverables) || 0 } : null,
    targetViews: isContent ? undefined : data.views,
    referralBudget: usesReferralBudget(data.objective) ? Number(data.referralBudget) || 0 : undefined,
    contentDestination: data.contentDestination,
    creatorAccess: data.creatorAccess,
    audienceTargeting: {
      locations: data.locations,
      minLocationShare: data.minLocationShare ? Number(data.minLocationShare) : undefined,
      ageRanges: data.ageRanges,
      genders: data.genders,
      interests: data.interests,
      platforms: data.platforms,
    },
    creatorEligibility: {
      minFollowers: data.minFollowers ? Number(data.minFollowers) : undefined,
      minEngagementRate: data.minEngagementRate ? Number(data.minEngagementRate) : undefined,
      categories: data.categories,
      verifiedOnly: data.verifiedOnly,
      minRank: data.minRank || undefined,
      requiredBadges: data.requiredBadges,
    },
    brief: data.brief,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h5 className="text-xs font-medium text-stone-500 font-rethink">{title}</h5>
      <div className="bg-white border border-stone-200 rounded-[18px] p-4 space-y-3">{children}</div>
    </section>
  );
}

function BriefList({ label, items }: { label: string; items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-stone-500 font-rethink">{label}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm font-medium text-stone-900 font-rethink leading-relaxed break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BriefText({ label, text, link }: { label: string; text: string | undefined; link?: boolean }) {
  if (!text) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-stone-500 font-rethink">{label}</p>
      {link ? (
        <a href={text} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-stone-900 font-rethink underline underline-offset-2 break-all">
          {text}
        </a>
      ) : (
        <p className="text-sm font-medium text-stone-900 font-rethink leading-relaxed whitespace-pre-line">{text}</p>
      )}
    </div>
  );
}

interface CampaignSetupSummaryProps {
  setup: SetupSummaryInput;
}

// A campaign's objective, pay, destination, access, targeting, eligibility and brief, as the brand set them.
export function CampaignSetupSummary({ setup }: CampaignSetupSummaryProps) {
  const objective = OBJECTIVE_OPTIONS.find((option) => option.value === setup.campaignObjective);
  const destination = DESTINATION_OPTIONS.find((option) => option.value === setup.contentDestination);
  const access = ACCESS_OPTIONS.find((option) => option.value === setup.creatorAccess);
  const targeting = setup.audienceTargeting || {};
  const eligibility = setup.creatorEligibility || {};
  const brief = setup.brief || {};
  const referral = setup.campaignObjective ? usesReferralBudget(setup.campaignObjective) : false;
  const actionNoun = setup.campaignObjective === "downloads" ? "download" : "sign-up";

  return (
    <div className="space-y-6">
      <Section title="Objective and Pay">
        <SummaryRow label="Objective" value={objective?.title || "Not set"} />
        {setup.contentPay ? (
          <>
            <SummaryRow label="Creator Pay Per Deliverable" value={formatNaira(setup.contentPay.ratePerDeliverable)} />
            <SummaryRow label="Deliverables" value={setup.contentPay.deliverables.toLocaleString()} />
          </>
        ) : (
          setup.targetViews !== undefined && <SummaryRow label="Target Views" value={setup.targetViews.toLocaleString()} />
        )}
        {referral && (
          <>
            <SummaryRow label="Referral Budget" value={formatNaira(setup.referralBudget)} />
            <SummaryRow label={actionNoun === "download" ? "Reward Per Download" : "Reward Per Sign-up"} value="Set by our team" />
          </>
        )}
      </Section>

      <Section title="Destination and Access">
        <SummaryRow label="Content Destination" value={destination?.title || "Creator's page"} />
        {(setup.contentDestination === "brand_page" || setup.contentDestination === "both") && (
          <p className="text-[11px] text-stone-500 font-medium font-rethink leading-relaxed">{USAGE_RIGHTS_TEXT}</p>
        )}
        <SummaryRow label="Creator Access" value={access?.title || "Open Call"} />
      </Section>

      <Section title="Audience Targeting">
        <SummaryRow label="Platforms" value={joined(targeting.platforms?.map((value) => labelFor(PLATFORM_OPTIONS, value))) || "Any"} />
        <SummaryRow
          label="Locations"
          value={
            joined(targeting.locations)
              ? `${joined(targeting.locations)}${targeting.minLocationShare ? ` (at least ${targeting.minLocationShare}% of followers)` : ""}`
              : "Anywhere"
          }
        />
        <SummaryRow label="Age" value={joined(targeting.ageRanges) || "Any"} />
        <SummaryRow label="Gender" value={joined(targeting.genders?.map((value) => labelFor(GENDER_OPTIONS, value))) || "Everyone"} />
        <SummaryRow label="Interests" value={joined(targeting.interests) || "Any"} />
      </Section>

      <Section title="Creator Eligibility">
        <SummaryRow label="Minimum Followers" value={eligibility.minFollowers ? eligibility.minFollowers.toLocaleString() : "Any"} />
        <SummaryRow label="Minimum Engagement" value={eligibility.minEngagementRate ? `${eligibility.minEngagementRate}%` : "Any"} />
        <SummaryRow label="Categories" value={joined(eligibility.categories) || "Any"} />
        <SummaryRow label="Rank" value={eligibility.minRank ? labelFor(RANK_OPTIONS, eligibility.minRank) : "Any rank"} />
        <SummaryRow label="Badges" value={joined(eligibility.requiredBadges?.map((value) => labelFor(BADGE_OPTIONS, value))) || "None needed"} />
        <SummaryRow label="Verified Creators Only" value={eligibility.verifiedOnly ? "Yes" : "No"} />
      </Section>

      <Section title="Brief">
        <BriefText label="Summary" text={brief.summary} />
        <BriefList label="Do's" items={brief.dos} />
        <BriefList label="Don'ts" items={brief.donts} />
        <BriefList label="Key Messages" items={brief.keyMessages} />
        <BriefText label="Hashtags" text={joined(brief.hashtags) || undefined} />
        <BriefText label="Tone" text={brief.tone} />
        <BriefText label="Sound" text={brief.soundUrl} link />
        {brief.referenceVideos && brief.referenceVideos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-stone-500 font-rethink">Reference Videos</p>
            {brief.referenceVideos.map((link) => (
              <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-stone-900 font-rethink underline underline-offset-2 break-all">
                {link}
              </a>
            ))}
          </div>
        )}
        <BriefText label="Product Info" text={brief.productInfo} />
        <BriefText label="Approval Requirements" text={brief.approvalRequirements} />
        {!brief.summary && <p className="text-xs text-stone-400 font-medium font-rethink">No brief yet.</p>}
      </Section>
    </div>
  );
}
