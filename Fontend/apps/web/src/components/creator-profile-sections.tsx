"use client";

// Creator Profile v2 screens (ticket 01): public and private details, categories, follower
// counts, audience with proof, portfolio, and the read-only Verified badge, badges and stats.
import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkBadge01Icon,
  Delete01Icon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { uploadFile } from "@ep/ui/lib/upload";
import type { AudienceAge, AudienceLocation, CreatorProfile, PortfolioItem } from "./types";
import { BADGE_LABELS, RatingSummary } from "./creator-rating-summary";
import { apiRequest, getToken, getUser } from "../lib/api";
import { platformLabel } from "../lib/campaign-pay";

// Must match Backend/src/utils/creatorProfile.js.
export const CREATOR_CATEGORIES = [
  "Fashion", "Beauty", "Music", "Comedy", "Lifestyle", "Finance", "Gaming",
  "Food", "Sports", "Tech", "Education", "Business", "Other",
] as const;
const AGE_RANGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55+"] as const;
const PORTFOLIO_PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"] as const;
const MAX_LOCATIONS = 5;
const MAX_PORTFOLIO = 12;


const inputClass =
  "w-full px-4 py-2.5 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-950 placeholder-stone-400 focus:outline-none focus:border-stone-300 font-rethink";
const primaryButton = "px-5 py-2.5 bg-[#FEB604] text-stone-950 font-semibold text-xs rounded-full font-rethink disabled:opacity-50";
const secondaryButton = "px-4 py-2 bg-white border border-stone-200 text-stone-900 font-semibold text-xs rounded-full font-rethink disabled:opacity-50";

interface SectionShellProps {
  title: string;
  hint?: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

const SectionShell = React.forwardRef<HTMLElement, SectionShellProps>(function SectionShell({ title, hint, children, badge }, ref) {
  return (
    <section ref={ref} data-reveal className="scroll-mt-24 bg-stone-50 border border-stone-200 rounded-3xl p-6 font-rethink">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h3 className="font-rethink font-medium text-base tracking-tighter text-stone-900">{title}</h3>
          {badge}
        </div>
        {hint && <p className="text-xs font-medium text-stone-500 mt-1 tracking-[-0.01em]">{hint}</p>}
      </div>
      {children}
    </section>
  );
});

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const sumOf = (values: number[]) => values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);

interface ProfileSectionProps {
  profile: CreatorProfile;
  onUpdated: (data: Partial<CreatorProfile>) => void;
}

interface ProfileStandingSectionProps {
  profile: CreatorProfile;
}

// Verified badge, earned badges and stats: all read-only.
export function ProfileStandingSection({ profile }: ProfileStandingSectionProps) {
  const stats = profile.stats;
  const rows: Array<[string, string]> = [
    ["Average views", (stats?.avgViews ?? 0).toLocaleString()],
    ["Engagement", stats?.engagementRate === null || stats?.engagementRate === undefined ? "No results yet" : `${stats.engagementRate}%`],
    ["Past campaigns", (stats?.pastCampaigns ?? 0).toLocaleString()],
    ["Total campaign views", (stats?.totalCampaignViews ?? 0).toLocaleString()],
  ];

  return (
    <SectionShell
      title="Your standing"
      hint="Brands see this on your profile. It updates from your campaign results."
      badge={
        profile.verified ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-medium">
            <HugeiconsIcon icon={CheckmarkBadge01Icon} size={12} className="text-blue-600" />
            Verified Creator
          </span>
        ) : null
      }
    >
      {!profile.verified && (
        <p className="text-xs font-medium text-stone-500 mb-4 leading-relaxed">
          Not verified yet. Connect a social account and our team will check it&apos;s you.
        </p>
      )}
      <div className="mb-3">
        <RatingSummary rating={profile.rating} showEmpty />
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        {(profile.badges || []).length === 0 ? (
          <span className="text-xs font-medium text-stone-400">
            No badges yet. You earn them from finished campaigns, verified results and brand ratings.
          </span>
        ) : (
          (profile.badges || []).map((badge) => (
            <span key={badge} className="px-3 py-1 rounded-full bg-white border border-stone-200 text-xs font-medium text-stone-700">
              {BADGE_LABELS[badge] || badge}
            </span>
          ))
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="bg-white border border-stone-200 rounded-2xl px-4 py-3">
            <p className="text-[11px] font-medium text-stone-500">{label}</p>
            <p className="text-sm font-medium text-stone-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

// Public details brands see, plus categories.
export function PublicDetailsSection({ profile, onUpdated }: ProfileSectionProps) {
  const { toast } = useToast();
  const [bio, setBio] = React.useState(profile.bio || "");
  const [city, setCity] = React.useState(profile.city || "");
  const [state, setState] = React.useState(profile.state || "");
  const [country, setCountry] = React.useState(profile.country || "");
  const [categories, setCategories] = React.useState<string[]>(profile.categories || []);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setBio(profile.bio || "");
    setCity(profile.city || "");
    setState(profile.state || "");
    setCountry(profile.country || "");
    setCategories(profile.categories || []);
  }, [profile.bio, profile.city, profile.state, profile.country, profile.categories]);

  const toggleCategory = (category: string) =>
    setCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<Partial<CreatorProfile>>("/creators/profile/me", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({ bio, city, state, country, categories }),
      });
      onUpdated({ bio: data.bio ?? bio, city: data.city, state: data.state, country: data.country ?? country, categories: data.categories });
      toast("Details saved.", "success");
    } catch (err) {
      toast(errorMessage(err, "Could not save your details. Try again."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionShell title="About you" hint="Shown to brands on your profile.">
      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Bio</label>
          <textarea
            value={bio}
            maxLength={300}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-stone-200 rounded-xl text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 font-rethink resize-none"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">State</label>
            <input value={state} onChange={(e) => setState(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-2">Categories</label>
          <div className="flex flex-wrap gap-2">
            {CREATOR_CATEGORIES.map((category) => {
              const selected = categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border font-rethink",
                    selected ? "bg-stone-950 text-white border-stone-950" : "bg-white text-stone-600 border-stone-200"
                  )}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving} className={primaryButton}>
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      </div>
    </SectionShell>
  );
}

// Legal name, phone and email: never shown to brands.
interface PrivateDetailsSectionProps extends ProfileSectionProps {
  email: string;
}

export function PrivateDetailsSection({ profile, onUpdated, email }: PrivateDetailsSectionProps) {
  const { toast } = useToast();
  const [legalName, setLegalName] = React.useState(profile.legalName || "");
  const [phone, setPhone] = React.useState(profile.phone || "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setLegalName(profile.legalName || "");
    setPhone(profile.phone || "");
  }, [profile.legalName, profile.phone]);

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiRequest<Partial<CreatorProfile>>("/creators/profile/me", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({ legalName, phone }),
      });
      onUpdated({ legalName: data.legalName, phone: data.phone });
      toast("Private details saved.", "success");
    } catch (err) {
      toast(errorMessage(err, "Could not save your private details. Try again."), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionShell
      title="Private details"
      hint="Only you and the EasilyPromote team see these. Brands never do."
      badge={
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 text-[10px] font-medium">
          <HugeiconsIcon icon={SquareLock02Icon} size={12} className="text-stone-500" />
          Not shown to brands
        </span>
      }
    >
      <div className="space-y-3.5">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Legal name</label>
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="As it appears on your ID" className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Phone number</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Email address</label>
          <input type="email" value={email} readOnly className={cn(inputClass, "bg-stone-100 text-stone-500")} />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving} className={primaryButton}>
            {saving ? "Saving…" : "Save private details"}
          </button>
        </div>
      </div>
    </SectionShell>
  );
}

// Follower counts per social account (self-reported until read from the platforms).
interface FollowerCountsSectionProps extends ProfileSectionProps {
  connectedHandles: Record<string, string>;
}

export function FollowerCountsSection({ profile, onUpdated, connectedHandles }: FollowerCountsSectionProps) {
  const { toast } = useToast();
  const accounts = React.useMemo(() => {
    const list = (profile.socialAccounts || []).map((a) => ({ platform: a.platform, handle: a.handle, followers: a.followers ?? null }));
    for (const [platform, handle] of Object.entries(connectedHandles)) {
      if (!list.some((a) => a.platform === platform)) list.push({ platform, handle, followers: null });
    }
    return list;
  }, [profile.socialAccounts, connectedHandles]);

  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [savingPlatform, setSavingPlatform] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDrafts(Object.fromEntries(accounts.map((a) => [a.platform, a.followers === null ? "" : String(a.followers)])));
  }, [accounts]);

  const save = async (platform: string, handle: string) => {
    const raw = drafts[platform]?.replace(/,/g, "").trim() ?? "";
    const followers = raw === "" ? null : Number(raw);
    if (followers !== null && (!Number.isInteger(followers) || followers < 0)) {
      toast("Enter your followers as a whole number.", "error");
      return;
    }
    setSavingPlatform(platform);
    try {
      const data = await apiRequest<{ socialAccounts: CreatorProfile["socialAccounts"] }>("/creators/profile/socials", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ platform, handle: handle || platform, followers }),
      });
      onUpdated({ socialAccounts: data.socialAccounts });
      toast(`${platformLabel(platform)} followers saved.`, "success");
    } catch (err) {
      toast(errorMessage(err, "Could not save your followers. Try again."), "error");
    } finally {
      setSavingPlatform(null);
    }
  };

  if (accounts.length === 0) return null;

  return (
    <SectionShell title="Followers" hint="How many followers each account has. Some campaigns need a minimum.">
      <ul className="space-y-3">
        {accounts.map((account) => (
          <li key={account.platform} className="flex items-center gap-3 bg-white border border-stone-200/60 rounded-2xl px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-900">{platformLabel(account.platform)}</p>
              <p className="text-xs font-medium text-stone-500 truncate">{account.handle}</p>
            </div>
            <input
              inputMode="numeric"
              value={drafts[account.platform] ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [account.platform]: e.target.value }))}
              placeholder="Followers"
              className="w-28 px-3 py-2 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 font-rethink"
            />
            <button
              type="button"
              onClick={() => save(account.platform, account.handle)}
              disabled={savingPlatform === account.platform}
              className={secondaryButton}
            >
              {savingPlatform === account.platform ? "Saving…" : "Save"}
            </button>
          </li>
        ))}
      </ul>
    </SectionShell>
  );
}

// Where the creator's audience is, by share, with an analytics screenshot as proof.
export const AudienceSection = React.forwardRef<HTMLElement, ProfileSectionProps>(function AudienceSection({ profile, onUpdated }, ref) {
  const { toast } = useToast();
  const audience = profile.audience;
  const proofInput = React.useRef<HTMLInputElement>(null);

  const [locations, setLocations] = React.useState<AudienceLocation[]>([]);
  const [ages, setAges] = React.useState<Record<string, string>>({});
  const [genders, setGenders] = React.useState({ female: "", male: "", other: "" });
  const [proofUrl, setProofUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setLocations(audience?.locations?.length ? audience.locations : [{ name: "", percentage: 0 }]);
    setAges(Object.fromEntries((audience?.ages || []).map((a) => [a.range, String(a.percentage)])));
    setGenders({
      female: audience?.genders ? String(audience.genders.female) : "",
      male: audience?.genders ? String(audience.genders.male) : "",
      other: audience?.genders ? String(audience.genders.other) : "",
    });
    setProofUrl(audience?.proofUrl || null);
  }, [audience]);

  const updateLocation = (index: number, patch: Partial<AudienceLocation>) =>
    setLocations((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const uploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setProofUrl(await uploadFile(file, "image", { token: getToken() }));
    } catch (err) {
      toast(errorMessage(err, "Screenshot upload failed. Try again."), "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const save = async () => {
    setError("");
    const cleanLocations = locations
      .filter((l) => l.name.trim())
      .map((l) => ({ name: l.name.trim(), percentage: Number(l.percentage) || 0 }));
    const cleanAges: AudienceAge[] = AGE_RANGES.filter((range) => ages[range] && ages[range].trim() !== "").map((range) => ({
      range,
      percentage: Number(ages[range]) || 0,
    }));
    const hasGenders = genders.female !== "" || genders.male !== "";
    const genderSplit = { female: Number(genders.female) || 0, male: Number(genders.male) || 0, other: Number(genders.other) || 0 };

    if (sumOf(cleanLocations.map((l) => l.percentage)) > 100) return setError("Audience locations can't add up to more than 100%.");
    if (sumOf(cleanAges.map((a) => a.percentage)) > 100) return setError("Age groups can't add up to more than 100%.");
    if (hasGenders && genderSplit.female + genderSplit.male + genderSplit.other > 100) return setError("Gender split can't add up to more than 100%.");
    if (cleanLocations.length === 0 && cleanAges.length === 0 && !hasGenders) return setError("Add at least your top audience locations.");
    if (!proofUrl) return setError("Add a screenshot of your analytics as proof.");

    setSaving(true);
    try {
      const data = await apiRequest<{ audience: CreatorProfile["audience"] }>("/creators/profile/audience", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({
          ...(cleanLocations.length > 0 && { locations: cleanLocations }),
          ...(cleanAges.length > 0 && { ages: cleanAges }),
          ...(hasGenders && { genders: genderSplit }),
          proofUrl,
        }),
      });
      onUpdated({ audience: data.audience });
      toast("Audience saved.", "success");
    } catch (err) {
      setError(errorMessage(err, "Could not save your audience. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const percentInput = "w-20 px-3 py-2 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 font-rethink";

  return (
    <SectionShell
      ref={ref}
      title="Your audience"
      hint="Where your followers are, not where you live. Campaigns are matched on this. Copy the numbers from your TikTok or Instagram analytics."
      badge={
        audience ? (
          <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-600 text-[10px] font-medium">
            {audience.source === "api" ? "From your account" : "Self-reported"}
          </span>
        ) : null
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-medium text-stone-700">Top locations</p>
          {locations.map((location, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={location.name}
                onChange={(e) => updateLocation(index, { name: e.target.value })}
                placeholder="e.g. Lagos"
                className={cn(inputClass, "flex-1")}
              />
              <input
                inputMode="decimal"
                value={location.percentage ? String(location.percentage) : ""}
                onChange={(e) => updateLocation(index, { percentage: Number(e.target.value) || 0 })}
                placeholder="%"
                className={percentInput}
              />
              <button
                type="button"
                onClick={() => setLocations((prev) => prev.filter((_, i) => i !== index))}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                aria-label="Remove location"
              >
                <HugeiconsIcon icon={Delete01Icon} size={16} className="text-stone-400" />
              </button>
            </div>
          ))}
          {locations.length < MAX_LOCATIONS && (
            <button type="button" onClick={() => setLocations((prev) => [...prev, { name: "", percentage: 0 }])} className={secondaryButton}>
              Add location
            </button>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-stone-700">Age groups</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {AGE_RANGES.map((range) => (
              <label key={range} className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-full pl-4 pr-1 py-1">
                <span className="text-xs font-medium text-stone-600">{range}</span>
                <input
                  inputMode="decimal"
                  value={ages[range] ?? ""}
                  onChange={(e) => setAges((prev) => ({ ...prev, [range]: e.target.value }))}
                  placeholder="%"
                  className="w-14 px-2 py-1.5 bg-stone-50 rounded-full text-xs font-medium text-stone-950 focus:outline-none font-rethink text-right"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-stone-700">Gender split</p>
          <div className="grid grid-cols-3 gap-2">
            {(["female", "male", "other"] as const).map((key) => (
              <label key={key} className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-full pl-4 pr-1 py-1">
                <span className="text-xs font-medium text-stone-600">{key === "female" ? "Women" : key === "male" ? "Men" : "Other"}</span>
                <input
                  inputMode="decimal"
                  value={genders[key]}
                  onChange={(e) => setGenders((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder="%"
                  className="w-14 px-2 py-1.5 bg-stone-50 rounded-full text-xs font-medium text-stone-950 focus:outline-none font-rethink text-right"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-stone-700">Proof</p>
          <p className="text-[11px] font-medium text-stone-500">A screenshot of your analytics showing these numbers. Our team may check it.</p>
          <div className="flex items-center gap-3">
            {proofUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proofUrl} alt="Analytics screenshot" className="w-14 h-14 rounded-xl object-cover border border-stone-200" />
            )}
            <button type="button" onClick={() => proofInput.current?.click()} disabled={uploading} className={secondaryButton}>
              {uploading ? "Uploading…" : proofUrl ? "Replace screenshot" : "Upload screenshot"}
            </button>
            <input ref={proofInput} type="file" accept="image/*" className="hidden" onChange={uploadProof} />
          </div>
        </div>

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-stone-400">
            {audience?.updatedAt ? `Last updated ${new Date(audience.updatedAt).toLocaleDateString()}` : ""}
          </span>
          <button type="button" onClick={save} disabled={saving || uploading} className={primaryButton}>
            {saving ? "Saving…" : "Save audience"}
          </button>
        </div>
      </div>
    </SectionShell>
  );
});

interface AudienceDataPromptProps {
  profile: CreatorProfile;
  onAddAudience: () => void;
}

// "Later" is remembered per creator on this device. Storage can be unavailable (private
// windows, blocked site data); the prompt then just shows again next visit.
function audiencePromptKey(): string | null {
  const user = getUser();
  return user?.id ? `ep:audience-prompt-dismissed:${user.id}` : null;
}

function readPromptDismissed(): boolean {
  try {
    const key = audiencePromptKey();
    return Boolean(key && window.localStorage.getItem(key));
  } catch {
    return false;
  }
}

function rememberPromptDismissed() {
  try {
    const key = audiencePromptKey();
    if (key) window.localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: dismissed for this visit only.
  }
}

// Dashboard nudge for creators who haven't said where their audience is yet.
// `audience` is undefined until the profile loads, so nothing flashes on first paint.
export function AudienceDataPrompt({ profile, onAddAudience }: AudienceDataPromptProps) {
  const [dismissed, setDismissed] = React.useState(true);
  React.useEffect(() => setDismissed(readPromptDismissed()), []);
  if (profile.audience !== null || dismissed) return null;

  return (
    <div data-reveal className="w-full mb-6 bg-[#EBF3FF]/40 border border-[#BFDBFE] border-dashed rounded-[20px] p-4 flex flex-col md:flex-row md:items-center gap-3 font-rethink">
      <div className="flex-1">
        <p className="text-sm font-medium text-stone-900">Tell brands where your audience is</p>
        <p className="text-xs font-medium text-stone-500 mt-0.5 leading-relaxed">
          Add your top audience locations, ages and gender split so we can recommend campaigns that suit your followers. Some campaigns need it to join.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            rememberPromptDismissed();
            setDismissed(true);
          }}
          className={secondaryButton}
        >
          Later
        </button>
        <button type="button" onClick={onAddAudience} className={primaryButton}>
          Add audience
        </button>
      </div>
    </div>
  );
}

const emptyItem = { url: "", platform: "tiktok", title: "", views: "", category: "", thumbnailUrl: "" };

// Up to 12 pieces of past work; order is the order brands see.
export const PortfolioSection = React.forwardRef<HTMLElement, ProfileSectionProps>(function PortfolioSection({ profile, onUpdated }, ref) {
  const { toast } = useToast();
  const items = profile.portfolio || [];
  const [draft, setDraft] = React.useState(emptyItem);
  const [adding, setAdding] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const thumbInput = React.useRef<HTMLInputElement>(null);

  const persist = async (next: PortfolioItem[], success: string) => {
    setSaving(true);
    try {
      const data = await apiRequest<{ portfolio: PortfolioItem[] }>("/creators/profile/portfolio", {
        method: "PUT",
        token: getToken() || undefined,
        body: JSON.stringify({
          items: next.map((item) => ({
            url: item.url,
            platform: item.platform,
            ...(item.thumbnailUrl && { thumbnailUrl: item.thumbnailUrl }),
            ...(item.title && { title: item.title }),
            ...(item.views && { views: item.views }),
            ...(item.category && { category: item.category }),
          })),
        }),
      });
      onUpdated({ portfolio: data.portfolio });
      toast(success, "success");
      return true;
    } catch (err) {
      toast(errorMessage(err, "Could not save your portfolio. Try again."), "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next, "Portfolio order saved.");
  };

  const remove = (index: number) => persist(items.filter((_, i) => i !== index), "Removed from your portfolio.");

  const uploadThumb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile(file, "image", { token: getToken() });
      setDraft((prev) => ({ ...prev, thumbnailUrl: url }));
    } catch (err) {
      toast(errorMessage(err, "Thumbnail upload failed. Try again."), "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const add = async () => {
    if (!/^https?:\/\//i.test(draft.url.trim())) {
      toast("Paste the full link to your post, starting with https://", "error");
      return;
    }
    const views = draft.views.replace(/,/g, "").trim();
    const item: PortfolioItem = {
      url: draft.url.trim(),
      platform: draft.platform,
      title: draft.title.trim(),
      views: views ? Math.max(0, Math.floor(Number(views)) || 0) : 0,
      category: draft.category || null,
      thumbnailUrl: draft.thumbnailUrl || null,
    };
    if (await persist([...items, item], "Added to your portfolio.")) {
      setDraft(emptyItem);
      setAdding(false);
    }
  };

  return (
    <SectionShell ref={ref} title="Portfolio" hint={`Your best work, in the order brands see it. Up to ${MAX_PORTFOLIO} pieces.`}>
      {items.length > 0 && (
        <ul className="space-y-3 mb-4">
          {items.map((item, index) => (
            <li key={`${item.url}-${index}`} className="flex items-center gap-3 bg-white border border-stone-200/60 rounded-2xl px-3 py-2.5">
              {item.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbnailUrl} alt="" className="w-11 h-11 rounded-xl object-cover border border-stone-200 flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-stone-100 border border-stone-200 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <a href={item.url} target="_blank" rel="noreferrer" className="block text-sm font-medium text-stone-900 truncate">
                  {item.title || item.url}
                </a>
                <p className="text-xs font-medium text-stone-500">
                  {platformLabel(item.platform)}
                  {item.views ? ` · ${item.views.toLocaleString()} views` : ""}
                  {item.category ? ` · ${item.category}` : ""}
                </p>
              </div>
              <div className="flex items-center flex-shrink-0">
                <button type="button" onClick={() => move(index, -1)} disabled={saving || index === 0} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30" aria-label="Move up">
                  <HugeiconsIcon icon={ArrowUp01Icon} size={16} className="text-stone-500" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={saving || index === items.length - 1} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30" aria-label="Move down">
                  <HugeiconsIcon icon={ArrowDown01Icon} size={16} className="text-stone-500" />
                </button>
                <button type="button" onClick={() => remove(index)} disabled={saving} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30" aria-label="Remove">
                  <HugeiconsIcon icon={Delete01Icon} size={16} className="text-stone-400" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-3 bg-white border border-stone-200 rounded-2xl p-4">
          <input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="Link to the post" className={inputClass} />
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title (optional)" className={inputClass} />
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })} className={inputClass}>
              {PORTFOLIO_PLATFORMS.map((p) => (
                <option key={p} value={p}>{platformLabel(p)}</option>
              ))}
            </select>
            <input inputMode="numeric" value={draft.views} onChange={(e) => setDraft({ ...draft, views: e.target.value })} placeholder="Views" className={inputClass} />
          </div>
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={inputClass}>
            <option value="">Category (optional)</option>
            {CREATOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="flex items-center gap-3">
            {draft.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.thumbnailUrl} alt="" className="w-11 h-11 rounded-xl object-cover border border-stone-200" />
            )}
            <button type="button" onClick={() => thumbInput.current?.click()} disabled={uploading} className={secondaryButton}>
              {uploading ? "Uploading…" : draft.thumbnailUrl ? "Replace thumbnail" : "Add thumbnail"}
            </button>
            <input ref={thumbInput} type="file" accept="image/*" className="hidden" onChange={uploadThumb} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setDraft(emptyItem); }} className={secondaryButton}>
              Cancel
            </button>
            <button type="button" onClick={add} disabled={saving || uploading} className={primaryButton}>
              {saving ? "Saving…" : "Add to portfolio"}
            </button>
          </div>
        </div>
      ) : (
        items.length < MAX_PORTFOLIO && (
          <button type="button" onClick={() => setAdding(true)} className={secondaryButton}>
            Add a piece
          </button>
        )
      )}
    </SectionShell>
  );
});
