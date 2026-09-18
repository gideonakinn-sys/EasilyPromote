"use client";

import * as React from "react";
import { apiRequest, getToken } from "../lib/api";

interface DeleteUserDialogProps {
  userId: string;
  userName: string;
  role: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteUserDialog({ userId, userName, role, onClose, onDeleted }: DeleteUserDialogProps) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const remove = async () => {
    try {
      setSubmitting(true);
      setError("");
      await apiRequest(`/admin/users/${userId}`, { method: "DELETE", token: getToken() || undefined });
      onDeleted();
    } catch (err: unknown) {
      // A 409 explains what has to happen first (e.g. active campaigns or a payout in flight).
      setError(err instanceof Error ? err.message : "Couldn't delete this account");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm px-4 font-rethink"
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-heading"
        className="bg-white border border-neutral-200 rounded-3xl p-8 max-w-md w-full space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h3 id="delete-user-heading" className="font-medium text-lg text-neutral-900">
            Delete &ldquo;{userName}&rdquo;?
          </h3>
          <ul className="space-y-1.5 text-xs text-neutral-600 font-medium leading-relaxed list-disc pl-4">
            <li>The account, profile and connected social accounts are removed.</li>
            <li>Payments, campaigns and content stay on record with personal details removed, so refunds, pay owed and the books aren&apos;t affected.</li>
            {role === "creator" && <li>Places with no delivered work are offered to other creators, and pending withdrawal requests are cancelled.</li>}
            {role === "business" && <li>A brand with active campaigns can&apos;t be deleted until they&apos;re completed or cancelled.</li>}
          </ul>
          <p className="text-xs text-neutral-500 font-medium">This can&apos;t be undone.</p>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-xs font-semibold text-neutral-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={submitting}
            className="flex-1 rounded-full bg-red-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Deleting…" : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
