"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Home01Icon,
  FolderOpenIcon,
  AnalyticsUpIcon,
  Wallet03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@ep/ui/lib/utils";
import logoPrimary from "@ep/ui/assets/logo-primary.svg";
import avatarSvg from "@ep/ui/assets/illustrations/Avatar [1.0].svg";
import { getUser } from "../../lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard/brand", label: "Overview", icon: Home01Icon, exact: true },
  { href: "/dashboard/brand/campaigns", label: "Campaigns", icon: FolderOpenIcon, exact: false },
  { href: "/dashboard/brand/analytics", label: "Analytics", icon: AnalyticsUpIcon, exact: false },
  { href: "/dashboard/brand/billing", label: "Billing & payments", icon: Wallet03Icon, exact: false },
] as const;

export function BrandSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const user = getUser();
  const isActive = (item: (typeof NAV_ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <aside className="hidden md:flex sticky top-0 h-dvh w-64 flex-shrink-0 flex-col border-r border-neutral-100 bg-neutral-50 px-4 py-6">
      <Link href="/dashboard/brand" className="flex items-center gap-2.5 px-2" aria-label="EasilyPromote brand dashboard">
        <Image src={logoPrimary} alt="EasilyPromote" width={32} height={32} priority />
      </Link>

      <nav className="mt-10 flex flex-col gap-1" aria-label="Brand workspace">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium",
                active ? "bg-neutral-900 text-white" : "text-neutral-600"
              )}
            >
              <HugeiconsIcon
                icon={item.icon}
                size={18}
                className={active ? "text-white" : "text-neutral-400"}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        onClick={() => router.push("/dashboard/brand/settings")}
        className="mt-auto flex w-full items-center gap-3 rounded-2xl border border-neutral-100 bg-white px-3 py-2.5 text-left"
      >
        <Image
          src={user?.avatar || user?.avatarUrl || avatarSvg}
          alt={user?.name || "User"}
          width={32}
          height={32}
          className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
          unoptimized
        />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-neutral-900">{user?.name || "User"}</span>
          <span className="block truncate text-[11px] font-medium text-neutral-500">{user?.email || ""}</span>
        </span>
      </button>
    </aside>
  );
}