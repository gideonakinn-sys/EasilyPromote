"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useBrandGuard } from "../../hooks/use-brand-guard";
import { BrandSidebar } from "./brand-sidebar";
import { BrandTopbar } from "./brand-topbar";

// Drawer/flow pages get the full viewport; section pages get the SaaS shell.
const FULL_SCREEN_ROUTES = [
  /^\/dashboard\/brand\/campaign\/[^/]+$/,
  /^\/dashboard\/brand\/create-campaign$/,
  /^\/dashboard\/brand\/settings\/referral$/,
];

export function BrandShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useBrandGuard();

  const isFullScreen = FULL_SCREEN_ROUTES.some((re) => re.test(pathname));
  if (isFullScreen) return <>{children}</>;

  return (
    <div className="min-h-dvh bg-white text-stone-900 font-rethink md:flex">
      <BrandSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <BrandTopbar />
        <main className="mx-auto w-full max-w-6xl flex-1 bg-white px-5 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}