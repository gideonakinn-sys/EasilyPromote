"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { Drawer, DrawerContent } from "../../../../../../components/ui/drawer";
import { CampaignDetails } from "../../../../../../components/campaign-details";
import { isAuthenticated } from "../../../../../../lib/api";

export default function CampaignDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const isMobile = useIsMobile();

  const campaignId = params.id as string;

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
  }, [router]);

  useEffect(() => {
    history.pushState(null, "", location.href);
    const handlePopState = () => router.push("/dashboard/brand");
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [router]);

  const handleClose = () => router.push("/dashboard/brand");

  if (!campaignId) {
    return (
      <div className="h-screen bg-neutral-100 flex items-center justify-center font-rethink text-neutral-500">
        Invalid campaign
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="h-screen bg-neutral-100 text-neutral-900 flex flex-col font-rethink">
        <CampaignDetails campaignId={campaignId} onClose={handleClose} isMobile />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 flex flex-col font-rethink">
      <Drawer open={true} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DrawerContent className="overflow-hidden">
          <CampaignDetails campaignId={campaignId} onClose={handleClose} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}
