"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CampaignWizard } from "../../components/campaign-wizard";
import { CampaignSuccess } from "../../components/campaign-success";
import { useIsMobile } from "@ep/ui/hooks/use-is-mobile";
import { Drawer, DrawerContent } from "../../components/ui/drawer";
import { isAuthenticated, apiRequest, getToken } from "../../lib/api";

function CreateCampaignContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  // Detect Paystack return: ?payment=success&campaignId=xxx
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

  const handleClose = () => router.push("/");
  const handleSuccess = () => router.push("/");

  // Verifying payment status after Paystack return
  if (verifying) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center font-rethink text-neutral-500">
        Verifying payment...
      </div>
    );
  }

  // Payment confirmed — show success screen
  if (paymentConfirmed) {
    return <CampaignSuccess onClose={handleSuccess} isMobile={isMobile} />;
  }

  // Paystack returned but payment not confirmed (card declined etc.) —
  // show the wizard so user can retry
  const effectiveDraftId = paymentCampaignId || draftId;

  // Wizard page — popstate navigates to home

  if (isMobile) {
    return (
      <div className="h-screen bg-neutral-100 text-neutral-900 flex flex-col font-rethink">
        <div className="flex-1 overflow-y-auto">
          <CampaignWizard onClose={handleClose} onSuccess={handleSuccess} draftId={effectiveDraftId} isMobile />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-rethink">
      <Drawer open={true} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DrawerContent className="overflow-hidden bg-neutral-100">
          <CampaignWizard onClose={handleClose} onSuccess={handleSuccess} draftId={effectiveDraftId} />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default function CreateCampaignPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-50 flex items-center justify-center font-rethink text-neutral-500">Loading...</div>}>
      <CreateCampaignContent />
    </Suspense>
  );
}
