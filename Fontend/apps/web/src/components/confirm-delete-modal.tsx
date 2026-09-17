"use client";

import * as React from "react";

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// In-app confirmation for deleting something that can't be restored.
export function ConfirmDeleteModal({ open, title, busy, onCancel, onConfirm }: ConfirmDeleteModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-xs space-y-4">
        <h3 id="confirm-delete-title" className="font-rethink font-medium text-base text-stone-900 text-center">
          {title}
        </h3>
        <p className="font-rethink text-xs text-stone-500 font-medium text-center">You can&apos;t undo this.</p>
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 bg-stone-100 text-stone-900 font-semibold text-sm rounded-full font-rethink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 bg-red-50 text-red-600 font-semibold text-sm rounded-full border border-red-200 font-rethink disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
