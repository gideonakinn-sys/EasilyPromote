"use client";

import * as React from "react";
import { SummaryRow } from "./wizard-fields";
import {
  ACCESS_OPTIONS,
  BADGE_OPTIONS,
  BONUS_METRIC_OPTIONS,
  DESTINATION_OPTIONS,
  GENDER_OPTIONS,
  OBJECTIVE_OPTIONS,
  PLATFORM_OPTIONS,
  RANK_OPTIONS,
  USAGE_RIGHTS_TEXT,
  USAGE_DURATION_OPTIONS,
  isWorldwide,
  usageRightsPayload,
  usesReferralBudget,
  hasViewsTarget,
  asksContentDestination,
  actionNoun,
  ageFilterActive,
  genderFilterActive,
  DEFAULT_HARD_FILTER_SHARE,
  specificGenders,
  type WizardData,
} from "./wizard-state";
import type { AudienceTargeting, CampaignBrief, CampaignObjective, ContentDestination, ContentPay, CreatorAccess, CreatorEligibility, HybridBonus } from "../types";
import { formatNaira } from "../../lib/referral";
import type { CampaignUsageRights } from "../types";

export interface SetupSummaryInput {
  campaignObjective: CampaignObjective | null;
  contentPay: ContentPay | null;
  hybridBonus?: HybridBonus | null;
  targetViews?: number;
  referralBudget?: number;
  contentDestination: ContentDestination | null;
  creatorAccess: CreatorAccess | null;
  audienceTargeting: AudienceTargeting;
  creatorEligibility: CreatorEligibility;
  brief: CampaignBrief;
  destinationUrl?: string | null;
  // Custom usage-rights terms (SPEC D30); missing or standard shows the standard licence.
  usageRights?: CampaignUsageRights | null;
}

const labelFor = (options: { value: string; label: string }[], value: string) => options.find((option) => option.value === value)?.label || value;
const joined = (values: string[] | undefined) => (values && values.length ? values.join(", ") : null);

export function setupFromWizard(data: WizardData): SetupSummaryInput {
  const isContent = data.objective === "content";
  return {
    campaignObjective: data.objective,
    contentPay: isContent ? { ratePerDeliverable: Number(data.ratePerDeliverable) || 0, deliverables: Number(data.deliverables) || 0 } : null,
    hybridBonus:
      isContent && data.payShape === "hybrid"
        ? { metric: data.bonusMetric, pool: Number(data.bonusPool) || 0, capPerCreator: Number(data.bonusCap) || 0 }
        : null,
    targetViews: hasViewsTarget(data) ? data.views : undefined,
    referralBudget: usesReferralBudget(data.objective) ? Number(data.referralBudget) || 0 : undefined,
    contentDestination: asksContentDestination(data) ? data.contentDestination : null,
    creatorAccess: data.creatorAccess,
    audienceTargeting: {
      locations: data.locations,
      minLocationShare: data.minLocationShare ? Number(data.minLocationShare) : undefined,
      ageRanges: data.ageRanges,
      genders: data.genders,
      interests: data.interests,
      platforms: data.platforms,
      ...(ageFilterActive(data) && { requireAgeMatch: true, minAgeShare: data.minAgeShare.trim() ? Number(data.minAgeShare) : DEFAULT_HARD_FILTER_SHARE }),
      ...(genderFilterActive(data) && { requireGenderMatch: true, minGenderShare: data.minGenderShare.trim() ? Number(data.minGenderShare) : DEFAULT_HARD_FILTER_SHARE }),
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
    destinationUrl: data.objective === "clicks" ? data.destinationUrl.trim() : undefined,
    usageRights: asksContentDestination(data) ? usageRightsPayload(data) : null,
  };
}

function UsageRightsLines({ usageRights }: { usageRights: CampaignUsageRights | null | undefined }) {
  const terms = usageRights?.type === "custom" ? usageRights.terms || {} : null;
  if (!terms) {
    return (
      <>
        <SummaryRow label="Usage Rights" value="Standard licence" />
        <p className="text-[11px] text-neutral-500 font-medium font-rethink leading-relaxed">{USAGE_RIGHTS_TEXT}</p>
      </>
    );
  }
  return (
    <>
      <SummaryRow label="Usage Rights" value="Custom terms" />
      <SummaryRow label="Usage Period" value={labelFor(USAGE_DURATION_OPTIONS, terms.duration || "perpetual")} />
      <SummaryRow
        label="Exclusivity"
        value={terms.exclusivity === "category" ? `Category exclusive${terms.exclusivityPeriod ? `, ${terms.exclusivityPeriod}` : ""}` : "Not exclusive"}
      />
      <SummaryRow label="Paid Ads" value={terms.paidAdsAllowed === false ? "Not allowed" : "Allowed"} />
      <SummaryRow label="Where" value={isWorldwide(terms.territories) ? "Worldwide" : joined(terms.territories)} />
      <BriefText label="Additional Terms" text={terms.additionalTerms || undefined} />
      <p className="text-[11px] text-neutral-500 font-medium font-rethink leading-relaxed">
        Creators accept these terms before they join or apply. They can&apos;t change after launch.
      </p>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h5 className="text-xs font-medium text-neutral-500 font-rethink">{title}</h5>
      <div className="bg-white border border-neutral-200 rounded-[18px] p-4 space-y-3">{children}</div>
    </section>
  );
}

function BriefList({ label, items }: { label: string; items: string[] | undefined }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-500 font-rethink">{label}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm font-medium text-neutral-900 font-rethink leading-relaxed break-words">
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
      <p className="text-xs font-medium text-neutral-500 font-rethink">{label}</p>
      {link ? (
        <a href={text} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-neutral-900 font-rethink underline underline-offset-2 break-all">
          {text}
        </a>
      ) : (
        <p className="text-sm font-medium text-neutral-900 font-rethink leading-relaxed whitespace-pre-line">{text}</p>
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
  const unitNoun = actionNoun(setup.campaignObjective);
  // Destination and usage rights are only a Content campaign's (SPEC D31).
  const isContent = setup.campaignObjective === "content";
  // Referral objectives are Hybrid with a views target and referrals only without one (SPEC D31).
  const campaignType = isContent ? "Content" : !referral ? "Views" : (setup.targetViews || 0) > 0 ? "Hybrid" : "Referrals";

  return (
    <div className="space-y-6">
      <Section title="Objective and Pay">
        {setup.campaignObjective && <SummaryRow label="Campaign Type" value={campaignType} />}
        <SummaryRow label="Objective" value={objective?.title || "Not set"} />
        {setup.campaignObjective === "clicks" && (
          <SummaryRow
            label="Destination Link"
            value={
              setup.destinationUrl ? (
                <a href={setup.destinationUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
                  {setup.destinationUrl}
                </a>
              ) : (
                "Not set"
              )
            }
          />
        )}
        {setup.contentPay ? (
          <>
            <SummaryRow label={setup.hybridBonus ? "Base Pay Per Deliverable" : "Creator Pay Per Deliverable"} value={formatNaira(setup.contentPay.ratePerDeliverable)} />
            <SummaryRow label="Deliverables" value={setup.contentPay.deliverables.toLocaleString()} />
            {setup.hybridBonus && (
              <>
                <SummaryRow label="Bonus Pays For" value={labelFor(BONUS_METRIC_OPTIONS.map((o) => ({ value: o.value, label: o.title })), setup.hybridBonus.metric)} />
                <SummaryRow label="Bonus Pool" value={formatNaira(setup.hybridBonus.pool)} />
                <SummaryRow label="Bonus Cap Per Creator" value={formatNaira(setup.hybridBonus.capPerCreator)} />
                <SummaryRow
                  label={setup.hybridBonus.metric === "views" ? "Bonus Per 1,000 Views" : "Bonus Per Conversion"}
                  value={setup.hybridBonus.ratePerThousandViews ? formatNaira(setup.hybridBonus.ratePerThousandViews) : setup.hybridBonus.metric === "views" ? "From our price table" : "Set by our team"}
                />
              </>
            )}
          </>
        ) : (
          setup.targetViews !== undefined && <SummaryRow label="Target Views" value={setup.targetViews.toLocaleString()} />
        )}
        {referral && (
          <>
            <SummaryRow label="Referral Budget" value={formatNaira(setup.referralBudget)} />
            <SummaryRow label={`Reward Per ${unitNoun[0].toUpperCase()}${unitNoun.slice(1)}`} value="Set by our team" />
          </>
        )}
      </Section>

      <Section title={isContent ? "Destination and Access" : "Access"}>
        {isContent && <SummaryRow label="Content Destination" value={destination?.title || "Creator's page"} />}
        {isContent && (setup.contentDestination === "brand_page" || setup.contentDestination === "both") && (
          <UsageRightsLines usageRights={setup.usageRights} />
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
        {targeting.requireAgeMatch && joined(targeting.ageRanges) && (
          <SummaryRow label="Age Requirement" value={`Required: at least ${targeting.minAgeShare ?? DEFAULT_HARD_FILTER_SHARE}% aged ${joined(targeting.ageRanges)}`} />
        )}
        <SummaryRow label="Gender" value={joined(targeting.genders?.map((value) => labelFor(GENDER_OPTIONS, value))) || "Everyone"} />
        {targeting.requireGenderMatch && specificGenders(targeting.genders || []).length > 0 && (
          <SummaryRow
            label="Gender Requirement"
            value={`Required: at least ${targeting.minGenderShare ?? DEFAULT_HARD_FILTER_SHARE}% ${specificGenders(targeting.genders || [])
              .map((value) => labelFor(GENDER_OPTIONS, value).toLowerCase())
              .join(" or ")}`}
          />
        )}
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
            <p className="text-xs font-medium text-neutral-500 font-rethink">Reference Videos</p>
            {brief.referenceVideos.map((link) => (
              <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-neutral-900 font-rethink underline underline-offset-2 break-all">
                {link}
              </a>
            ))}
          </div>
        )}
        <BriefText label="Product Info" text={brief.productInfo} />
        <BriefText label="Approval Requirements" text={brief.approvalRequirements} />
        {!brief.summary && <p className="text-xs text-neutral-400 font-medium font-rethink">No brief yet.</p>}
      </Section>
    </div>
  );
}
