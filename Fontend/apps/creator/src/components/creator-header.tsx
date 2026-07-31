"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon, ClipboardIcon, Wallet03Icon, Menu01Icon, ChevronDownIcon, UserIcon, Logout01Icon } from "@hugeicons/core-free-icons";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import logoPrimary from "@ep/ui/assets/logo-primary.svg";
import rankIllustration from "@ep/ui/assets/Rank illustration.svg";
import avatarSvg from "@ep/ui/assets/illustrations/Avatar [1.0].svg";
import type { ActiveTab, CreatorProfile } from "./types";

interface CreatorHeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  profile: CreatorProfile;
  onLogout?: () => void;
  onOpenProfile?: () => void;
}

export function CreatorHeader({ activeTab, onTabChange, profile, onLogout, onOpenProfile }: CreatorHeaderProps) {
  const isOnboarding = !profile.socialAccounts.length || !profile.niches.length || !profile.country;
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const scoreViews = profile.creatorScore
    ? `${profile.creatorScore.toLocaleString()} / 10,000 views`
    : "0 / 10,000 views";

  const rankLabel = profile.rank
    ? profile.rank.replace("rank", "#")
    : "#1";

  return (
    <header className="sticky top-0 z-40 w-full bg-stone-100">
      <div className="max-w-7xl mx-auto px-6 h-16 grid grid-cols-3 items-center">
        {/* Logo — no text */}
        <div className="justify-self-start flex items-center gap-2.5">
          <Image src={logoPrimary} alt="EasilyPromote" width={32} height={32} priority />
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="justify-self-center hidden md:flex bg-stone-50 p-1 rounded-full gap-1 items-center">
          <button
            onClick={() => onTabChange("home")}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold ${
              activeTab === "home"
                ? "bg-white text-stone-950 border border-stone-200"
                : "text-stone-500"
            }`}
          >
            <HugeiconsIcon icon={Home01Icon} size={14} />
            <span>Home</span>
          </button>

          {!isOnboarding && (
            <button
              onClick={() => onTabChange("campaign")}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold ${
                activeTab === "campaign"
                  ? "bg-white text-stone-950 border border-stone-200"
                  : "text-stone-500"
              }`}
            >
              <HugeiconsIcon icon={ClipboardIcon} size={14} />
              <span>Campaign</span>
            </button>
          )}

          <button
            onClick={() => {
              if (!isOnboarding) onTabChange("wallet");
            }}
            disabled={isOnboarding}
            className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold ${
              activeTab === "wallet"
                ? "bg-white text-stone-950 border border-stone-200"
                : "text-stone-500 disabled:opacity-40"
            }`}
          >
            <HugeiconsIcon icon={Wallet03Icon} size={14} />
            <span>Wallet</span>
          </button>
        </nav>

        {/* Mobile Menu Button (same grid cell as nav) */}
        <button
          onClick={() => setIsMenuOpen(true)}
          className="justify-self-center md:hidden flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold text-stone-700 bg-stone-50 border border-stone-200"
        >
          <HugeiconsIcon icon={Menu01Icon} size={14} />
          <span>Menu</span>
        </button>

        <div className="justify-self-end flex items-center gap-3">
          {/* Rank — desktop: full pill with rank + view count */}
          {!isOnboarding && (
            <div className="hidden md:flex items-center gap-1.5 bg-stone-50 rounded-full pl-1 pr-3 py-1">
              <Image
                src={rankIllustration}
                alt="Rank"
                width={32}
                height={32}
              />
              <div className="flex flex-col gap-[2px]">
                <span className="text-[11px] font-semibold text-[#6D28D9] leading-[1.2]">Rank {rankLabel}</span>
                <span className="text-[9px] text-stone-500 font-medium leading-[1.1]">{scoreViews}</span>
              </div>
            </div>
          )}

          {/* Rank — mobile: just illustration */}
          {!isOnboarding && (
            <Image
              src={rankIllustration}
              alt="Rank"
              width={32}
              height={32}
              className="md:hidden"
            />
          )}

          {/* Profile Pill — matches brand's NavBar */}
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-3 md:bg-stone-50 md:rounded-full md:pl-2 md:pr-4 md:py-1.5 cursor-pointer"
            >
              <Image
                src={profile.avatar || avatarSvg}
                alt={profile.displayName}
                width={32}
                height={32}
                className="rounded-full object-cover"
                unoptimized
              />
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="text-sm font-medium text-stone-900">{profile.displayName}</span>
                <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
              </div>
            </button>

            {/* Desktop Dropdown */}
            <div className="hidden md:block">
              {isProfileOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-stone-200 rounded-xl py-1 z-50">
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      onOpenProfile?.();
                    }}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-stone-900"
                  >
                    <HugeiconsIcon icon={UserIcon} size={16} />
                    <span className="font-medium">Profile</span>
                  </button>
                  {onLogout && (
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        onLogout();
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-stone-900"
                    >
                      <HugeiconsIcon icon={Logout01Icon} size={16} />
                      <span className="font-medium">Log out</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Mobile Drawer */}
            <div className="md:hidden">
              <MobileDrawer open={isProfileOpen} onOpenChange={(open) => setIsProfileOpen(open)}>
                <button
                  className="flex items-center gap-4 w-full px-4 py-3 text-left"
                >
                  <Image
                    src={profile.avatar || avatarSvg}
                    alt={profile.displayName}
                    width={48}
                    height={48}
                    className="rounded-full object-cover flex-shrink-0"
                    unoptimized
                  />
                  <div>
                    <p className="text-sm font-medium text-stone-900">{profile.displayName}</p>
                    <p className="text-xs text-stone-500">@{profile.username}</p>
                  </div>
                </button>
                {onOpenProfile && (
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      onOpenProfile();
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-stone-900"
                  >
                    <HugeiconsIcon icon={UserIcon} size={16} />
                    <span className="font-medium">View profile</span>
                  </button>
                )}
                {onLogout && (
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      onLogout();
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-sm text-stone-900"
                  >
                    <HugeiconsIcon icon={Logout01Icon} size={16} />
                    <span className="font-medium">Log out</span>
                  </button>
                )}
              </MobileDrawer>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      <div className="md:hidden">
        <MobileDrawer open={isMenuOpen} onOpenChange={(open) => setIsMenuOpen(open)}>
          <button
            onClick={() => {
              onTabChange("home");
              setIsMenuOpen(false);
            }}
            className={`flex items-center gap-3 w-full px-4 py-3 text-left text-sm font-medium rounded-xl ${
              activeTab === "home" ? "text-stone-900 bg-stone-100" : "text-stone-600"
            }`}
          >
            <HugeiconsIcon icon={Home01Icon} size={18} />
            Home
          </button>
          {!isOnboarding && (
            <button
              onClick={() => {
                onTabChange("campaign");
                setIsMenuOpen(false);
              }}
              className={`flex items-center gap-3 w-full px-4 py-3 text-left text-sm font-medium rounded-xl ${
                activeTab === "campaign" ? "text-stone-900 bg-stone-100" : "text-stone-600"
              }`}
            >
              <HugeiconsIcon icon={ClipboardIcon} size={18} />
              Campaign
            </button>
          )}
          <button
            onClick={() => {
              if (!isOnboarding) {
                onTabChange("wallet");
                setIsMenuOpen(false);
              }
            }}
            disabled={isOnboarding}
            className={`flex items-center gap-3 w-full px-4 py-3 text-left text-sm font-medium rounded-xl ${
              activeTab === "wallet" ? "text-stone-900 bg-stone-100" : "text-stone-600"
            } disabled:opacity-40`}
          >
            <HugeiconsIcon icon={Wallet03Icon} size={18} />
            Wallet
          </button>
        </MobileDrawer>
      </div>
    </header>
  );
}
