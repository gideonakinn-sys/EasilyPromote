"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@ep/ui/components/nav-bar";
import { PaymentStatementView } from "../../../../../components/payment-statement";
import { clearAuth, getUser, isAuthenticated } from "../../../../../lib/api";

export default function BrandPaymentStatementPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("User");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatarUrl, setUserAvatarUrl] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    const user = getUser();
    if (user?.role !== "business") {
      router.push(user?.role === "creator" ? "/dashboard/creator" : "/login");
      return;
    }
    if (user.name) setUserName(user.name);
    if (user.email) setUserEmail(user.email);
    if (user.avatar || user.avatarUrl) setUserAvatarUrl((user.avatar || user.avatarUrl) ?? "");
    setReady(true);
  }, [router]);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.push("/login");
  }, [router]);

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex flex-col font-rethink">
      <NavBar roleLabel="Brand" userName={userName} userEmail={userEmail} userAvatarUrl={userAvatarUrl} onLogout={handleLogout} helpHref="/help/brands" />
      {ready && <PaymentStatementView />}
    </div>
  );
}
