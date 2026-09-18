"use client";

import * as React from "react";

interface ConfirmExitModalProps {
  open: boolean;
  busy?: boolean;
  onSaveDraft: () => void;
  onDiscard: () => void;
}

// Shown when the brand backs out of the wizard: save what they've typed or discard it.
export function ConfirmExitModal({ open, busy, onSaveDraft, onDiscard }: ConfirmExitModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-exit-title"
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs space-y-4">
        <h3 id="confirm-exit-title" className="font-rethink font-medium text-base text-stone-900 text-center">
          Save your draft?
        </h3>
        <p className="font-rethink text-xs text-stone-500 font-medium text-center">
          You haven&apos;t launched this campaign yet. Save what you&apos;ve typed so far, or discard it.
        </p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onDiscard}
            className="flex-1 py-2.5 bg-stone-100 text-stone-900 font-semibold text-sm rounded-full font-rethink"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={busy}
            className="flex-1 py-2.5 bg-[#FEB604] text-[#1C1917] font-semibold text-sm rounded-full border border-stone-100 font-rethink disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save as draft"}
          </button>
        </div>
      </div>
    </div>
  );
}