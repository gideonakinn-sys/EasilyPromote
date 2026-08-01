"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "../components/ui/spinner";
import { getUser, isAuthenticated, clearAuth } from "../lib/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    const user = getUser();
    const role = user?.role;

    if (role === "creator") {
      router.replace("/dashboard/creator");
    } else if (role === "admin" || role === "super_admin" || role === "finance_admin" || role === "support") {
      window.location.href = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:3003";
    } else if (role === "business") {
      router.replace("/dashboard/brand");
    } else {
      clearAuth();
      router.replace("/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <Spinner className="size-6 text-stone-400" aria-hidden="true" />
    </div>
  );
}
