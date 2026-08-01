import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, UserIcon, Logout01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { MobileDrawer } from "../components/mobile-drawer";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./dropdown-menu";
import logoPrimary from "../assets/logo-primary.svg";
import avatarSvg from "../assets/illustrations/Avatar [1.0].svg";

export interface NavBarProps {
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  onLogout?: () => void;
  onAvatarChange?: (file: File) => void;
  className?: string;
}

export function NavBar({
  userName = "Acme Inc.",
  userEmail,
  userAvatarUrl,
  onLogout,
  onAvatarChange,
  className,
}: NavBarProps) {
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onAvatarChange?.(file);
    }
    e.target.value = "";
  };

  return (
    <header className={cn("w-full bg-stone-50 z-40", className)}>
      {/* Hidden file input for avatar upload — placed outside drawer to avoid Vaul interference */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div className="flex items-center gap-2.5">
          <Image src={logoPrimary} alt="EasilyPromote" width={32} height={32} priority />
        </div>

        {/* Desktop Profile Dropdown */}
        <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 bg-white border border-stone-200 rounded-full pl-2 pr-4 py-1.5 cursor-pointer">
                <Image
                  src={userAvatarUrl || avatarSvg}
                  alt={userName}
                  width={32}
                  height={32}
                  className="rounded-full w-8 h-8 object-cover"
                  unoptimized
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-stone-900 font-rethink">{userName}</span>
                  <HugeiconsIcon icon={ChevronDownIcon} size={16} className="text-stone-400" />
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={handleAvatarClick}>
                <HugeiconsIcon icon={UserIcon} size={16} />
                <span>Profile</span>
              </DropdownMenuItem>
              {onLogout && (
                <DropdownMenuItem variant="destructive" onSelect={() => onLogout()}>
                  <HugeiconsIcon icon={Logout01Icon} size={16} />
                  <span>Log out</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile Profile Trigger */}
        <div className="md:hidden">
          <button
            onClick={() => setIsProfileOpen(true)}
            className="flex items-center gap-3 cursor-pointer"
          >
            <Image
              src={userAvatarUrl || avatarSvg}
              alt={userName}
              width={32}
              height={32}
              className="rounded-full w-8 h-8 object-cover"
              unoptimized
            />
          </button>
        </div>

        {/* Mobile Drawer */}
        <div className="md:hidden">
          <MobileDrawer open={isProfileOpen} onOpenChange={(open) => setIsProfileOpen(open)}>
            <button
              onClick={handleAvatarClick}
              className="flex items-center gap-4 w-full px-4 py-3 text-left"
            >
              <Image
                src={userAvatarUrl || avatarSvg}
                alt={userName}
                width={48}
                height={48}
                className="rounded-full object-cover flex-shrink-0"
                unoptimized
              />
              <div>
                <p className="text-sm font-medium text-stone-900 font-rethink">{userName}</p>
                {userEmail && (
                  <p className="text-xs text-stone-500 font-rethink tracking-[-0.01em]">{userEmail}</p>
                )}
              </div>
            </button>
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
    </header>
  );
}
