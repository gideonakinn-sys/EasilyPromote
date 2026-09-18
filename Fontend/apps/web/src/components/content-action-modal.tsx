"use client";

// Campaign engine: content approval (ticket 07)
// In-app confirmation for a content decision, with an optional note the action needs.
import * as React from "react";
import { cn } from "@ep/ui/lib/utils";

interface ContentActionModalProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  // When set, the modal asks for text and won't confirm until some is entered.
  noteLabel?: string;
  notePlaceholder?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

export function ContentActionModal({
  open,
  title,
  description,
  confirmLabel,
  tone = "primary",
  noteLabel,
  notePlaceholder,
  busy,
  error,
  onCancel,
  onConfirm,
}: ContentActionModalProps) {
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) setNote("");
  }, [open]);

  if (!open) return null;
  const needsNote = Boolean(noteLabel);
  const canConfirm = !busy && (!needsNote || note.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="content-action-title"
    >
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 font-rethink">
        <h3 id="content-action-title" className="font-medium text-base text-neutral-900 text-center">
          {title}
        </h3>
        {description && <div className="text-xs text-neutral-500 font-medium text-center leading-relaxed">{description}</div>}
        {needsNote && (
          <div className="space-y-1.5">
            <label htmlFor="content-action-note" className="text-xs font-medium text-neutral-500">
              {noteLabel}
            </label>
            <textarea
              id="content-action-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder}
              maxLength={2000}
              className="w-full px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm font-medium text-neutral-900 placeholder-neutral-300 focus:outline-none focus:border-neutral-400 resize-none min-h-[96px]"
            />
          </div>
        )}
        {error && <p className="text-xs font-medium text-red-600 text-center">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 bg-neutral-100 text-neutral-900 font-semibold text-sm rounded-full"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note.trim())}
            disabled={!canConfirm}
            className={cn(
              "flex-1 py-2.5 font-semibold text-sm rounded-full border disabled:opacity-50",
              tone === "danger" ? "bg-red-50 text-red-600 border-red-200" : "bg-[#FEB604] text-neutral-900 border-neutral-100"
            )}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
