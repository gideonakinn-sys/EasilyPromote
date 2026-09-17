"use client";

import * as React from "react";
import { apiRequest, getToken } from "../lib/api";

interface CompleteCampaignDialogProps {
  campaignId: string;
  campaignName: string;
  isContent: boolean;
  // The note typed in the campaign's admin actions; sent to the brand with the notification.
  note?: string;
  onClose: () => void;
  onCompleted: () => void;
}

interface CompleteResponse {
  success: boolean;
  status: string;
  closedPlaces: number;
}

export function CompleteCampaignDialog({ campaignId, campaignName, isContent, note = "", onClose, onCompleted }: CompleteCampaignDialogProps) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const complete = async () => {
    try {
      setSubmitting(true);
      setError("");
      await apiRequest<CompleteResponse>(`/admin/campaigns/${campaignId}/complete`, {
        method: "POST",
        token: getToken() || undefined,
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      onCompleted();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't complete this campaign");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/40 backdrop-blur-sm px-4 font-rethink"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-campaign-heading"
        className="bg-white border border-stone-200 rounded-3xl p-8 max-w-md w-full space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h3 id="complete-campaign-heading" className="font-medium text-lg text-stone-900">
            Complete &ldquo;{campaignName}&rdquo;?
          </h3>
          <ul className="space-y-1.5 text-xs text-stone-600 font-medium leading-relaxed list-disc pl-4">
            <li>Places nobody has taken close. The campaign leaves the marketplace, and new joins and applications are refused.</li>
            <li>Creators who already have a place keep it and can finish their work.</li>
            <li>The brand is told the campaign is completed{note.trim() ? ", with your note" : ""}.</li>
            {isContent ? (
              <li>Unused deliverable budget becomes refundable: a finance admin can then use Refund Unused Budget.</li>
            ) : (
              <li>Completing doesn&apos;t refund anything. Creators can still withdraw what they earned.</li>
            )}
          </ul>
          <p className="text-xs text-stone-500 font-medium">This can&apos;t be undone.</p>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 bg-stone-50 border border-stone-200 text-stone-600 rounded-full font-semibold text-xs disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={complete}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-full font-semibold text-xs text-white bg-stone-900 disabled:opacity-50"
          >
            {submitting ? "Completing…" : "Complete Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
