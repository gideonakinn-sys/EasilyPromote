"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAuth, getUser, isAuthenticated } from "../lib/auth";

const ADMIN_ROLES = ["admin", "super_admin", "finance_admin", "support"];

// Gate every brand section page: unauthenticated users go to login, a creator to
// their dashboard, and admins to the admin console.
export function useBrandGuard(): void {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    const user = getUser();
    if (!user?.role) {
      clearAuth();
      router.replace("/login");
      return;
    }

    if (user.role === "creator") {
      router.replace("/dashboard/creator");
      return;
    }

    if (ADMIN_ROLES.includes(user.role)) {
      window.location.href = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3003";
      return;
    }

    if (user.role !== "business") {
      clearAuth();
      router.replace("/login");
    }
  }, [router]);
}