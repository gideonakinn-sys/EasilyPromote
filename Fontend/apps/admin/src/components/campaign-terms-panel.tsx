"use client";

// M8 batch 7: a campaign's clicks destination (SPEC D29) and usage-rights terms (SPEC D30), plus
// which creators accepted the terms, in the admin campaign detail.

export interface UsageRightsTerms {
  duration?: string;
  exclusivity?: "none" | "category";
  exclusivityPeriod?: string | null;
  paidAdsAllowed?: boolean;
  territories?: string[];
  additionalTerms?: string | null;
}

export interface CampaignUsageRights {
  type: "standard" | "custom";
  version?: number;
  terms?: UsageRightsTerms;
}

export interface TermsAccepted {
  version?: number | null;
  acceptedAt?: string | null;
}

export interface SlotWithTerms {
  _id?: string;
  status?: string;
  creatorId?: { _id?: string; name?: string; email?: string } | string | null;
  usageRightsAccepted?: TermsAccepted | null;
}

const DURATION_LABELS: Record<string, string> = {
  perpetual: "No end date",
  "3_months": "3 months",
  "6_months": "6 months",
  "12_months": "12 months",
  "24_months": "24 months",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export function creatorKey(creator: SlotWithTerms["creatorId"]): string | null {
  if (!creator) return null;
  return typeof creator === "string" ? creator : creator._id || null;
}

// Map of creator id to the terms they accepted on their placement.
export function acceptedTermsByCreator(slots: SlotWithTerms[] | undefined): Map<string, TermsAccepted> {
  const map = new Map<string, TermsAccepted>();
  for (const slot of slots || []) {
    const key = creatorKey(slot.creatorId);
    if (key && slot.usageRightsAccepted?.acceptedAt) map.set(key, slot.usageRightsAccepted);
  }
  return map;
}

export function TermsAcceptedText({ accepted }: { accepted: TermsAccepted | null | undefined }) {
  if (!accepted?.acceptedAt) return null;
  return (
    <span className="text-[11px] font-semibold text-green-700">
      Terms v{accepted.version ?? "?"} accepted {formatDate(accepted.acceptedAt)}
    </span>
  );
}

export function CampaignTermsPanel({
  campaignObjective,
  destinationUrl,
  usageRights,
  slots,
}: {
  campaignObjective?: string | null;
  destinationUrl?: string | null;
  usageRights?: CampaignUsageRights | null;
  slots?: SlotWithTerms[];
}) {
  const isClicks = campaignObjective === "clicks";
  const custom = usageRights?.type === "custom";
  const terms = usageRights?.terms || {};
  const accepted = (slots || []).filter((slot) => slot.usageRightsAccepted?.acceptedAt);
  if (!isClicks && !usageRights) return null;

  return (
    <div className="space-y-4">
      {isClicks && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">Destination Link</h4>
          <div className="p-4 bg-white border border-stone-200 rounded-xl">
            {destinationUrl ? (
              <a href={destinationUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-blue-600 hover:underline break-all">
                {destinationUrl}
              </a>
            ) : (
              <span className="text-sm text-amber-700">No destination link set</span>
            )}
            <p className="text-[11px] text-stone-400 mt-1">Creators&apos; tracked links (/r/&lt;campaign&gt;/&lt;code&gt;) only redirect here.</p>
          </div>
        </div>
      )}

      {usageRights && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">
            Usage Rights · {custom ? `Custom terms v${usageRights.version ?? 1}` : "Standard licence"}
          </h4>
          <div className="p-4 bg-white border border-stone-200 rounded-xl space-y-3">
            {custom ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Duration", DURATION_LABELS[terms.duration || "perpetual"] || terms.duration || "—"],
                    ["Exclusivity", terms.exclusivity === "category" ? `Category${terms.exclusivityPeriod ? ` · ${terms.exclusivityPeriod}` : ""}` : "None"],
                    ["Paid Ads", terms.paidAdsAllowed === false ? "Not allowed" : "Allowed"],
                    ["Territories", terms.territories?.length ? terms.territories.join(", ") : "Worldwide"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span className="text-[10px] uppercase font-bold text-stone-400 block">{label}</span>
                      <span className="text-sm font-semibold text-stone-900 break-words">{value}</span>
                    </div>
                  ))}
                </div>
                {terms.additionalTerms && (
                  <div>
                    <span className="text-[10px] uppercase font-bold text-stone-400 block">Additional Terms</span>
                    <p className="text-xs text-stone-700 whitespace-pre-line break-words">{terms.additionalTerms}</p>
                  </div>
                )}
                <div className="pt-3 border-t border-stone-100">
                  <span className="text-[10px] uppercase font-bold text-stone-400 block mb-1">Accepted By ({accepted.length})</span>
                  {accepted.length === 0 ? (
                    <p className="text-[11px] text-stone-400">No creator has accepted these terms yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {accepted.map((slot, index) => {
                        const creator = slot.creatorId && typeof slot.creatorId === "object" ? slot.creatorId : null;
                        return (
                          <li key={slot._id || index} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-stone-800 font-semibold truncate">{creator?.name || creator?.email || "Creator"}</span>
                            <TermsAcceptedText accepted={slot.usageRightsAccepted} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-stone-600">
                Perpetual, non-exclusive licence to use the content on the brand&apos;s own channels, organic and paid social. No
                separate acceptance needed.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
