"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CampaignWizard } from "../../../../../components/campaign-wizard";
import { CampaignSuccess } from "../../../../../components/campaign-success";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { Drawer, DrawerContent } from "../../../../../components/ui/drawer";
import { Skeleton } from "../../../../../components/ui/skeleton";
import { isAuthenticated, apiRequest, getToken } from "../../../../../lib/api";

function CreateCampaignContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const paymentSuccess = searchParams.get("payment") === "success";
  const paymentCampaignId = searchParams.get("campaignId") || undefined;

  const draftId = paymentCampaignId || searchParams.get("id") || undefined;

  const [verifying, setVerifying] = useState(true);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
  }, []);

  useEffect(() => {
    if (!paymentSuccess || !paymentCampaignId) {
      setVerifying(false);
      return;
    }

    apiRequest<{ status: string; isPaid: boolean }>(`/campaigns/${paymentCampaignId}/payment-status`, {
      token: getToken() || undefined,
    }).then((data) => {
      if (data.isPaid) {
        setPaymentConfirmed(true);
      }
      setVerifying(false);
    }).catch(() => {
      setVerifying(false);
    });
  }, [paymentSuccess, paymentCampaignId]);

  const handleClose = () => router.push("/dashboard/brand");
  const handleSuccess = () => router.push("/dashboard/brand");

  if (verifying) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-10">
        <div className="w-full max-w-[520px] bg-white border border-stone-200 rounded-3xl p-8 space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      </div>
    );
  }

  if (paymentConfirmed) {
    return <CampaignSuccess onClose={handleSuccess} isMobile={isMobile} />;
  }

  const effectiveDraftId = paymentCampaignId || draftId;

  if (isMobile) {
    return (
      <div className="h-screen bg-stone-100 text-stone-900 flex flex-col font-rethink">
        <div className="flex-1 overflow-y-auto" data-lenis-prevent>
          <CampaignWizard onClose={handleClose} onSuccess={handleSuccess} draftId={effectiveDraftId} isMobile />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col font-rethink">
      <Drawer open={true} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DrawerContent className="overflow-hidden bg-stone-100">
          <CampaignWizard onClose={handleClose} onSuccess={handleSuccess} draftId={effectiveDraftId} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default function CreateCampaignPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-50 flex items-center justify-center"><Skeleton className="h-6 w-40" /></div>}>
      <CreateCampaignContent />
    </Suspense>
  );
}
