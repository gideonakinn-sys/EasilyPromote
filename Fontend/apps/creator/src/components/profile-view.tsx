"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Camera01Icon,
  CheckmarkBadge01Icon,
  Delete01Icon,
  InstagramIcon,
  TiktokIcon,
  YoutubeIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import { AVAILABLE_NICHES } from "./constants";
import type { CreatorProfile, ProfileFocusSection, ProfileForm } from "./types";
import { API_URL, DEMO_MODE } from "../lib/api";
import { useReveal } from "../hooks/use-reveal";

interface ProfileViewProps {
  profile: CreatorProfile;
  profileForm: ProfileForm;
  onProfileFormChange: (form: ProfileForm) => void;
  focusSection: ProfileFocusSection | null;
  onClose: () => void;
  onConnectSocial: (platform: string, handle: string) => void;
  onRemoveSocial: (platform: string) => void;
  onSaveNiches: (niches: string[]) => void;
  onSaveProfile: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

const PLATFORM_STYLES: Record<string, { icon: typeof TiktokIcon; iconBg: string; iconColor: string }> = {
  tiktok: { icon: TiktokIcon, iconBg: "bg-purple-100 border-purple-200", iconColor: "text-purple-600" },
  instagram: { icon: InstagramIcon, iconBg: "bg-pink-100 border-pink-200", iconColor: "text-pink-600" },
  youtube: { icon: YoutubeIcon, iconBg: "bg-red-100 border-red-200", iconColor: "text-red-600" },
};

const DEFAULT_PLATFORM_STYLE = { icon: TiktokIcon, iconBg: "bg-purple-100 border-purple-200", iconColor: "text-purple-600" };

const SOCIAL_PLATFORMS = ["TikTok", "Instagram", "YouTube"];

export function ProfileView({
  profile,
  profileForm,
  onProfileFormChange,
  focusSection,
  onClose,
  onConnectSocial,
  onRemoveSocial,
  onSaveNiches,
  onSaveProfile,
}: ProfileViewProps) {
  useReveal();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const socialRef = useRef<HTMLDivElement>(null);
  const nichesRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  const [addPlatform, setAddPlatform] = useState("TikTok");
  const [addHandle, setAddHandle] = useState("");
  const [niches, setNiches] = useState<string[]>(profile.niches);

  useEffect(() => {
    if (!focusSection) return;
    const target = focusSection === "social" ? socialRef : focusSection === "niches" ? nichesRef : detailsRef;
    target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusSection]);

  const handleAddSocial = () => {
    if (!addHandle.trim()) return;
    onConnectSocial(addPlatform, addHandle.trim());
    setAddHandle("");
  };

  const handleToggleNiche = (niche: string) => {
    const next = niches.includes(niche)
      ? niches.filter((n) => n !== niche)
      : [...niches, niche];
    setNiches(next);
    if (next.length > 0) onSaveNiches(next);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    onProfileFormChange({ ...profileForm, avatarUrl: localUrl });

    if (DEMO_MODE) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/upload/image`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = (await res.json()) as { url: string };
      onProfileFormChange({ ...profileForm, avatarUrl: data.url });
    } catch (err) {
      console.error("Avatar upload failed", err);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto font-rethink">
      <div data-reveal className="flex items-center gap-4 mb-6">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white border border-stone-200 flex items-center justify-center"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="text-stone-600" />
        </button>
        <h2 className="font-rethink font-medium text-lg tracking-tighter text-stone-900">Profile</h2>
      </div>

      <div className="space-y-6">
        <section data-reveal ref={socialRef} className="scroll-mt-24 bg-white border border-stone-200 rounded-3xl p-6">
          <div className="mb-5">
            <h3 className="font-rethink font-medium text-base tracking-tighter text-stone-900">Social accounts</h3>
            <p className="text-xs font-medium text-stone-500 mt-1 tracking-[-0.01em]">
              Link the platforms you create on so we can verify your views.
            </p>
          </div>

          {profile.socialAccounts.length > 0 && (
            <ul className="space-y-3 mb-5">
              {profile.socialAccounts.map((acct) => {
                const style = PLATFORM_STYLES[acct.platform] ?? DEFAULT_PLATFORM_STYLE;
                return (
                  <li key={acct.platform} className="flex items-center gap-3 bg-stone-50 border border-stone-200/60 rounded-2xl px-3 py-2.5">
                    <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0", style.iconBg)}>
                      <HugeiconsIcon icon={style.icon} size={16} className={style.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-900 flex items-center gap-1.5">
                        {PLATFORM_LABELS[acct.platform] ?? acct.platform}
                        {acct.verified && (
                          <HugeiconsIcon icon={CheckmarkBadge01Icon} size={14} className="text-blue-600" />
                        )}
                      </p>
                      <p className="text-xs font-medium text-stone-500">{acct.handle}</p>
                    </div>
                    <button
                      onClick={() => onRemoveSocial(acct.platform)}
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    >
                      <HugeiconsIcon icon={Delete01Icon} size={16} className="text-stone-400" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {SOCIAL_PLATFORMS.map((p) => (
                <button
                  key={p}
                  onClick={() => setAddPlatform(p)}
                  className={cn(
                    "py-2 rounded-full text-xs font-medium border font-rethink",
                    addPlatform === p
                      ? "bg-stone-950 text-white border-stone-950"
                      : "bg-white text-stone-600 border-stone-200"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="@yourhandle"
                value={addHandle}
                onChange={(e) => setAddHandle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSocial();
                }}
                className="flex-1 min-w-0 px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-full text-xs font-medium text-stone-950 placeholder-stone-400 focus:outline-none focus:border-stone-300 font-rethink"
              />
              <button
                onClick={handleAddSocial}
                className="px-5 py-2.5 bg-stone-950 text-white rounded-full font-semibold text-xs font-rethink"
              >
                Connect
              </button>
            </div>
          </div>
        </section>

        <section data-reveal ref={nichesRef} className="scroll-mt-24 bg-white border border-stone-200 rounded-3xl p-6">
          <div className="mb-5">
            <h3 className="font-rethink font-medium text-base tracking-tighter text-stone-900">Niches</h3>
            <p className="text-xs font-medium text-stone-500 mt-1 tracking-[-0.01em]">
              Select categories that match the type of content you publish.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_NICHES.map((niche) => {
              const isSelected = niches.includes(niche);
              return (
                <button
                  key={niche}
                  onClick={() => handleToggleNiche(niche)}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-medium border font-rethink",
                    isSelected
                      ? "bg-[#FEB604] text-stone-950 border-[#FEB604]"
                      : "bg-white text-stone-600 border-stone-200"
                  )}
                >
                  {niche}
                </button>
              );
            })}
          </div>
        </section>

        <section data-reveal ref={detailsRef} className="scroll-mt-24 bg-white border border-stone-200 rounded-3xl p-6">
          <div className="mb-5">
            <h3 className="font-rethink font-medium text-base tracking-tighter text-stone-900">Profile details</h3>
            <p className="text-xs font-medium text-stone-500 mt-1 tracking-[-0.01em]">
              Add a display name and photo so brands know who&apos;s delivering.
            </p>
          </div>

          <div className="flex justify-center mb-5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full bg-stone-100 border-2 border-dashed border-stone-300 flex items-center justify-center overflow-hidden"
            >
              {profileForm.avatarUrl ? (
                <img src={profileForm.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <HugeiconsIcon icon={Camera01Icon} size={24} className="text-stone-300" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Display Name</label>
              <input
                type="text"
                value={profileForm.displayName}
                onChange={(e) => onProfileFormChange({ ...profileForm, displayName: e.target.value })}
                className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-full text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 font-rethink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Country</label>
              <input
                type="text"
                value={profileForm.country}
                onChange={(e) => onProfileFormChange({ ...profileForm, country: e.target.value })}
                className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-full text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 font-rethink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Bio</label>
              <textarea
                value={profileForm.bio}
                onChange={(e) => onProfileFormChange({ ...profileForm, bio: e.target.value })}
                rows={2}
                className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-medium text-stone-950 focus:outline-none focus:border-stone-300 resize-none font-rethink"
              />
            </div>
          </div>

          <button
            onClick={onSaveProfile}
            className="w-full mt-5 py-3 bg-[#FEB604] text-stone-950 font-semibold text-sm rounded-full font-rethink"
          >
            Save
          </button>
        </section>
      </div>
    </div>
  );
}
