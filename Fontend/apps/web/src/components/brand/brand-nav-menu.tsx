"use client";

import * as React from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home01Icon,
  FolderOpenIcon,
  AnalyticsUpIcon,
  Wallet03Icon,
  Add01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import avatarSvg from "@ep/ui/assets/illustrations/Avatar [1.0].svg";
import { getUser } from "../../lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard/brand", label: "Overview", icon: Home01Icon, exact: true },
  { href: "/dashboard/brand/campaigns", label: "Campaigns", icon: FolderOpenIcon, exact: false },
  { href: "/dashboard/brand/analytics", label: "Analytics", icon: AnalyticsUpIcon, exact: false },
  { href: "/dashboard/brand/billing", label: "Billing & payments", icon: Wallet03Icon, exact: false },
] as const;

interface BrandNavMenuProps {
  onNavigate?: () => void;
}

export function BrandNavMenu({ onNavigate }: BrandNavMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();

  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => {
          onNavigate?.();
          router.push("/dashboard/brand/settings");
        }}
        className="mb-2 flex items-center gap-3 rounded-xl px-1 py-1 text-left"
      >
        <Image
          src={user?.avatar || user?.avatarUrl || avatarSvg}
          alt={user?.name || "User"}
          width={40}
          height={40}
          className="h-10 w-10 rounded-full object-cover"
          unoptimized
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-stone-900">{user?.name || "User"}</span>
          <span className="block truncate text-xs font-medium text-stone-500">{user?.email || ""}</span>
        </span>
      </button>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.href}
          onClick={() => {
            onNavigate?.();
            router.push(item.href);
          }}
          className={cn(
            "flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium",
            isActive(item) ? "bg-stone-100 text-stone-900" : "text-stone-600"
          )}
        >
          <HugeiconsIcon icon={item.icon} size={18} className={isActive(item) ? "text-stone-900" : "text-stone-400"} />
          {item.label}
        </button>
      ))}

      <div className="my-2 h-px bg-stone-100" />

      <button
        onClick={() => {
          onNavigate?.();
          localStorage.removeItem("ep-draft-autosave");
          router.push("/dashboard/brand/create-campaign");
        }}
        className="flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-stone-900"
      >
        <HugeiconsIcon icon={Add01Icon} size={18} className="text-stone-400" />
        New campaign
      </button>
    </div>
  );
}