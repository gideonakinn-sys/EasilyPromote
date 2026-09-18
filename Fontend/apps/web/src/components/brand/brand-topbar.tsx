"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon, Add01Icon } from "@hugeicons/core-free-icons";
import { MobileDrawer } from "@ep/ui/components/mobile-drawer";
import avatarSvg from "@ep/ui/assets/illustrations/Avatar [1.0].svg";
import { getUser } from "../../lib/auth";
import { NotificationsMenu } from "./notifications-menu";
import { BrandNavMenu } from "./brand-nav-menu";

export function BrandTopbar() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const user = getUser();
  const firstName = user?.name?.split(" ")[0] || "there";

  const createCampaign = () => {
    localStorage.removeItem("ep-draft-autosave");
    router.push("/dashboard/brand/create-campaign");
  };

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-stone-100 bg-[#fcfcfc]">
      <div className="flex h-full items-center justify-between gap-3 px-5 md:px-8">
        {/* Mobile: hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-stone-100"
          >
            <HugeiconsIcon icon={Menu01Icon} size={18} className="text-stone-700" />
          </button>
        </div>

        {/* Welcome */}
        <p className="hidden md:block text-sm font-semibold text-stone-900">
          Welcome, {firstName}
        </p>

        <div className="flex items-center gap-2 md:gap-3">
          <NotificationsMenu />

          <button
            onClick={createCampaign}
            className="hidden md:inline-flex items-center gap-2 bg-[#FEB604] text-[#1C1917] font-rethink font-semibold text-sm rounded-full px-5 py-2.5 border border-stone-100"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            New campaign
          </button>

          {/* Mobile: avatar */}
          <button
            onClick={() => router.push("/dashboard/brand/settings")}
            aria-label="Open profile"
            className="md:hidden h-9 w-9 overflow-hidden rounded-full border border-stone-100"
          >
            <Image
              src={user?.avatar || user?.avatarUrl || avatarSvg}
              alt={user?.name || "User"}
              width={36}
              height={36}
              className="h-full w-full object-cover"
              unoptimized
            />
          </button>
        </div>
      </div>

      <MobileDrawer open={menuOpen} onOpenChange={setMenuOpen}>
        <BrandNavMenu onNavigate={() => setMenuOpen(false)} />
      </MobileDrawer>
    </header>
  );
}