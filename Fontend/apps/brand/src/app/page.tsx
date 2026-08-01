"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@ep/ui/components/nav-bar";
import { EmptyState } from "../components/empty-state";
import { ActiveDashboard, type BrandCampaign } from "../components/active-dashboard";
import { DraftAlertBanner } from "../components/draft-alert-banner";
import { Skeleton } from "../components/ui/skeleton";
import { apiRequest, getUser, clearAuth, isAuthenticated, getToken } from "../lib/api";
import { useSocket } from "../lib/socket";

function BrandDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [dashboardState, setDashboardState] = useState<"empty" | "active">("empty");
  const [showAlert, setShowAlert] = useState(true);
  const [userName, setUserName] = useState("User");
  const [userEmail, setUserEmail] = useState("");
  const [userAvatarUrl, setUserAvatarUrl] = useState("");
  const [campaigns, setCampaigns] = useState<BrandCampaign[]>([]);
  const [draftCount, setDraftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const fetchCampaigns = useCallback(async () => {
    setFetchError("");
    try {
      const data = await apiRequest<{ campaigns: BrandCampaign[]; draftCount: number }>("/campaigns", {
        method: "GET",
        token: getToken() || undefined,
      });

      const list = data.campaigns || [];
      setDraftCount(data.draftCount || 0);

      const pending = list.filter(c => c.status === "pending_payment");
      let finalList = list;

      if (pending.length > 0) {
        await Promise.allSettled(
          pending.map(c =>
            apiRequest(`/campaigns/${c.id}/payment-status`, { token: getToken() || undefined })
          )
        );

        const refreshed = await apiRequest<{ campaigns: BrandCampaign[]; draftCount: number }>("/campaigns", {
          method: "GET",
          token: getToken() || undefined,
        });

        finalList = refreshed.campaigns || list;
        setDraftCount(refreshed.draftCount || 0);
      }
      setCampaigns(finalList);
      setDashboardState(finalList.length > 0 ? "active" : "empty");
    } catch (err: unknown) {
      console.error("Could not load campaigns:", err);
      setFetchError(err instanceof Error ? err.message : "Could not load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useSocket((data) => {
    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === data.campaignId ? { ...c, status: data.status } : c
      )
    );
  });

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }

    const user = getUser();
    if (user?.role === "creator") {
      window.location.href = `${window.location.protocol}//${window.location.hostname}:3001`;
      return;
    }
    if (user?.role !== "business") {
      clearAuth();
      router.push("/login");
      return;
    }

    const reference = searchParams.get("reference") || searchParams.get("trxref");
    const payment = searchParams.get("payment");
    if (reference || payment === "success") {
      router.replace("/");
      return;
    }

    if (user?.name) setUserName(user.name);
    if (user?.email) setUserEmail(user.email);
    if (user?.avatarUrl) setUserAvatarUrl(user.avatarUrl);

    apiRequest<{ emailVerified: boolean }>("/auth/me", { token: getToken() || undefined })
      .then((me) => {
        if (!me.emailVerified) {
          router.push("/login");
          return;
        }
        const freshUser = getUser();
        if (freshUser) {
          freshUser.emailVerified = me.emailVerified;
          localStorage.setItem("user", JSON.stringify(freshUser));
        }
        fetchCampaigns();
      })
      .catch(() => {
        router.push("/login");
      });
  }, [searchParams, router, fetchCampaigns]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isAuthenticated()) {
        fetchCampaigns();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchCampaigns]);

  const handleCreateCampaign = useCallback(() => {
    router.push("/create-campaign");
  }, [router]);

  const handleLogout = useCallback(() => {
    clearAuth();
    router.push("/login");
  }, [router]);

  const handleAvatarUpload = useCallback(async (file: File) => {
    const token = getToken();
    if (!token) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"}/upload/image`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData }
      );
      const data = await res.json();
      if (data.url) setUserAvatarUrl(data.url);
    } catch (err) {
      console.error("Avatar upload failed:", err);
    }
  }, []);

  return (
    <div className="h-dvh bg-[#F5F5F4] text-stone-900 flex flex-col font-rethink">
      <NavBar
        userName={userName}
        userEmail={userEmail}
        userAvatarUrl={userAvatarUrl}
        onLogout={handleLogout}
        onAvatarChange={handleAvatarUpload}
      />

      {showAlert && draftCount > 0 && (
        <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 z-50">
          <DraftAlertBanner draftCount={draftCount} onClose={() => setShowAlert(false)} />
        </div>
      )}

      {loading ? (
          <main className="flex-1 p-6 md:p-10">
            <div className="max-w-7xl mx-auto space-y-6">
              <Skeleton className="h-8 w-48" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        ) : fetchError ? (
          <main className="flex-1 flex flex-col items-center justify-center max-w-7xl w-full mx-auto px-6 py-12">
            <div className="text-center max-w-sm bg-white border border-stone-200 rounded-2xl p-8 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-red-50 flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h2 className="font-rethink font-medium text-lg text-stone-900">Something went wrong</h2>
              <p className="font-rethink text-xs text-stone-500 font-medium">{fetchError}</p>
              <button
                onClick={() => fetchCampaigns()}
                className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium font-rethink rounded-full"
              >
                Try again
              </button>
            </div>
          </main>
        ) : dashboardState === "empty" ? (
          <EmptyState onCreateCampaign={handleCreateCampaign} userName={userName} />
        ) : (
          <ActiveDashboard
            campaigns={campaigns}
            onCreateCampaign={handleCreateCampaign}
            userName={userName}
            onLogout={handleLogout}
          />
        )
      }
    </div>
  );
}

export default function BrandDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F5F5F4] flex items-center justify-center"><Skeleton className="h-6 w-40" /></div>}>
      <BrandDashboardContent />
    </Suspense>
  );
}
