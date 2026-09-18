import * as React from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import illustration4 from "@ep/ui/assets/illustrations/illustration4.svg";

interface DraftAlertBannerProps {
  draftCount: number;
  onClose: () => void;
}

export function DraftAlertBanner({ draftCount, onClose }: DraftAlertBannerProps) {
  return (
    <div className="flex items-center justify-between bg-[#EBF3FF] border border-dashed border-blue-200 rounded-[20px] p-2 relative overflow-hidden w-full md:w-fit">
      <div className="flex items-center gap-4">
        <div className="flex-shrink-0">
          <Image src={illustration4} alt="Unfinished business" width={52} height={52} />
        </div>
        <div>
          <h4 className="font-rethink font-medium text-sm text-neutral-900">Unfinished business!</h4>
          <p className="font-rethink text-xs text-neutral-500 mt-0.5">You have {draftCount} draft campaign{draftCount !== 1 ? "s" : ""} waiting</p>
        </div>
      </div>
      <button onClick={onClose} className="text-neutral-400 p-1 absolute top-2 right-2">
        <HugeiconsIcon icon={Cancel01Icon} size={16} />
      </button>
    </div>
  );
}
