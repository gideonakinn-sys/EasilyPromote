"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { apiRequest, getToken, isAuthenticated } from "../../../../../../lib/api";
import type { CampaignItem } from "../../../../../../components/types";
import { CampaignDetailsDrawer } from "../../../../../../components/campaign-details-drawer";
import { Skeleton } from "../../../../../../components/ui/skeleton";

function toCampaignItem(c: Record<string, unknown>): CampaignItem {
  return {
    id: c.id as string,
    slotId: c.slotId as string,
    title: c.title as string,
    category: c.category as string,
    coverImageUrl: c.coverImageUrl as string,
    delivery: c.delivery as string,
    status: c.status as CampaignItem["status"],
    reward: c.reward as number,
    viewTarget: c.viewTarget as number,
    minViews: c.minViews as number | undefined,
    maxViews: c.maxViews as number | undefined,
    costPerView: c.costPerView as number | undefined,
    comment: c.comment as string,
    progress: c.progress as number,
    currentViews: c.currentViews as number,
    targetViews: c.targetViews as number,
    videoUrl: c.videoUrl as string,
    caption: c.caption as string,
    videoDuration: c.videoDuration as string,
    submittedAgo: c.submittedAgo as string,
    postedPlatforms: c.postedPlatforms as Array<{ platform: string; views: number }>,
    creatorHandle: c.creatorHandle as string | undefined,
    submissionId: c.submissionId as string,
    contentBrief: c.contentBrief as string,
    description: c.description as string,
    keyMessageCta: c.keyMessageCta as string,
    whatToAvoid: c.whatToAvoid as string,
    platforms: c.platforms as string[],
    contentStyle: c.contentStyle as string[],
    brandName: c.brandName as string | undefined,
    brandAvatar: c.brandAvatar as string | undefined,
    scriptUrl: c.scriptUrl as string | undefined,
    scriptFileName: c.scriptFileName as string | undefined,
  };
}

function CampaignDetailsContent() {
  const router = useRouter();
  const params = useParams();
  const isMobile = useIsMobile();

  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const data = await apiRequest<{ campaigns: Array<Record<string, unknown>> }>(
          "/creators/slots/mine",
          { token: getToken() || undefined }
        );
        const found = (data.campaigns || []).find((c) => (c.id as string) === campaignId);
        if (active) setCampaign(found ? toCampaignItem(found) : null);
      } catch {
        if (active) setCampaign(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();

    return () => {
      active = false;
    };
  }, [campaignId, router]);

  useEffect(() => {
    history.pushState(null, "", location.href);
    const handlePopState = () => router.push("/dashboard/creator");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router]);

  const handleClose = () => router.push("/dashboard/creator");

  const handleSubmitContent = async (id: string, videoUrl: string, caption: string) => {
    if (!videoUrl) return;

    try {
      await apiRequest("/submissions", {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({
          campaignId: id,
          videoUrl,
          caption,
        }),
      });

      setCampaign((prev) =>
        prev && prev.id === id
          ? { ...prev, status: "under_review" as const, delivery: "Submitted just now", videoUrl, caption }
          : prev
      );
    } catch (err) {
      console.error("Failed to submit content:", err);
    }
  };

  const handleUpdateContent = async (id: string, videoUrl: string, caption: string) => {
    if (!videoUrl) return;

    try {
      const submissionId = campaign?.id === id ? campaign.submissionId : undefined;
      if (submissionId) {
        await apiRequest(`/submissions/${submissionId}`, {
          method: "PUT",
          token: getToken() || undefined,
          body: JSON.stringify({ videoUrl, caption }),
        });
      }

      setCampaign((prev) =>
        prev && prev.id === id
          ? { ...prev, status: "under_review" as const, comment: undefined, delivery: "Submitted just now", videoUrl, caption }
          : prev
      );
    } catch (err) {
      console.error("Failed to update content:", err);
    }
  };

  const handleSubmitPostUrl = async (
    id: string,
    urls: Record<string, string>
  ) => {
    try {
      const submissionId = campaign?.id === id ? campaign.submissionId : undefined;
      if (submissionId) {
        const platforms = Object.entries(urls).filter(([, url]) => url);
        for (const [platform, url] of platforms) {
          await apiRequest(`/submissions/${submissionId}/mark-posted`, {
            method: "PATCH",
            token: getToken() || undefined,
            body: JSON.stringify({ url, platform }),
          });
        }
      }

      setCampaign((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              status: "live_tracking" as const,
              progress: 0,
              currentViews: 0,
              postedPlatforms: Object.keys(urls)
                .filter((k) => urls[k])
                .map((k) => ({ platform: k, views: 0 })),
            }
          : prev
      );
    } catch (err) {
      console.error("Failed to submit post URLs:", err);
    }
  };

  if (!campaignId) {
    return (
      <div className="h-dvh bg-stone-100 flex items-center justify-center font-rethink text-stone-500">
        Invalid campaign
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-[#F5F5F4] flex items-center justify-center">
        <div className="space-y-4 w-full max-w-md mx-auto px-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="h-dvh bg-stone-100 flex items-center justify-center font-rethink text-stone-500">
        Campaign not found
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F5F5F4] font-rethink">
      <CampaignDetailsDrawer
        campaign={campaign}
        isMobile={isMobile}
        onClose={handleClose}
        onSubmitContent={handleSubmitContent}
        onUpdateContent={handleUpdateContent}
        onSubmitPostUrl={handleSubmitPostUrl}
      />
    </div>
  );
}

export default function CampaignDetailsPage() {
  return <CampaignDetailsContent />;
}
