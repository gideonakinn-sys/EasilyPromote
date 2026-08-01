"use client";

import { useEffect } from "react";
import Image from "next/image";
import { cn } from "@ep/ui/lib/utils";
import illustration3 from "@ep/ui/assets/illustrations/illustration3.svg";

interface CampaignSuccessProps {
  onClose: () => void;
  isMobile?: boolean;
}

export function CampaignSuccess({ onClose, isMobile }: CampaignSuccessProps) {
  useEffect(() => {
    history.pushState(null, "", location.href);
    const handlePopState = () => onClose();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onClose]);

  return (
    <div className="h-screen bg-stone-50 text-stone-900 flex flex-col font-rethink">
      <div className={cn(
        "flex-1 overflow-y-auto flex flex-col items-center justify-center",
        isMobile ? "p-5 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" : "p-12"
      )} data-lenis-prevent>
        <div className={cn(
          "text-center space-y-8 py-8 flex flex-col items-center",
          isMobile ? "w-full" : "w-[350px]"
        )}>
          {/* Folder Illustration */}
          <div>
            <Image src={illustration3} alt="Success Folder" width={120} height={120} className="md:w-[160px] md:h-[160px] w-[120px] h-[120px]" />
          </div>

          {/* Header & Subtitle */}
          <div className="space-y-3">
            <h3 className="font-rethink font-medium tracking-tighter md:text-2xl text-xl text-stone-900">Locked in. Let's get you views.</h3>
            <p className="font-rethink text-sm text-stone-500 leading-relaxed max-w-md mx-auto">
              Your campaign is funded and waiting for a quick review. We'll notify you the moment it's live and creators can start claiming slots.
            </p>
          </div>

          {/* View Dashboard Button */}
          <button
            onClick={onClose}
            className="w-full py-3 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink"
          >
            View Campaign Dashboard
          </button>

          {/* What happens next box */}
          <div className="bg-stone-100 rounded-[24px] p-4 border border-dashed border-stone-200 text-left w-full space-y-8">
            <h4 className="font-rethink md:text-[19px] text-lg font-medium tracking-tighter text-stone-900">What happens next</h4>
            <div className="space-y-8">
              <div>
                <h5 className="text-sm font-medium tracking-[-0.01em] text-stone-800 font-rethink">Quick review</h5>
                <p className="text-sm text-stone-500 mt-1 font-rethink">We check your campaign meets our guidelines — usually within a few hours.</p>
              </div>
              <div>
                <h5 className="text-sm font-medium tracking-[-0.01em] text-stone-800 font-rethink">Finding creators</h5>
                <p className="text-sm text-stone-500 mt-1 font-rethink">Once live, your campaign appears to matching creators instantly.</p>
              </div>
              <div>
                <h5 className="text-sm font-medium tracking-[-0.01em] text-stone-800 font-rethink">Creators submit content</h5>
                <p className="text-sm text-stone-500 mt-1 font-rethink">You'll get notified as work starts coming in.</p>
              </div>
              <div>
                <h5 className="text-sm font-medium tracking-[-0.01em] text-stone-800 font-rethink">Review & approve</h5>
                <p className="text-sm text-stone-500 mt-1 font-rethink">Approve submissions you're happy with — you only pay for what's delivered.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
