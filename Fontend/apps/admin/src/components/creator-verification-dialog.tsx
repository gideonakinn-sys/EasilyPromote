"use client";

import * as React from "react";
import { cn } from "@ep/ui/lib/utils";
import { apiRequest, getToken } from "../lib/api";

export interface ConnectedAccount {
  platform: string;
  username: string | null;
  // SPEC D32: the platform stopped accepting the connection; views don't sync until the creator reconnects.
  needsReconnect?: boolean;
  needsReconnectAt?: string | null;
  needsReconnectReason?: string | null;
}

// "Instagram needs reconnecting since 3 Sep 2026" for each flagged connection.
export function reconnectNotices(accounts: ConnectedAccount[]): string[] {
  return accounts
    .filter((a) => a.needsReconnect)
    .map((a) => {
      const since = a.needsReconnectAt
        ? ` since ${new Date(a.needsReconnectAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        : "";
      return `${PLATFORM_LABELS[a.platform] || a.platform} needs reconnecting${since}`;
    });
}

interface CreatorVerificationDialogProps {
  creatorId: string;
  creatorName: string;
  verifiedAt: string | null;
  connectedAccounts: ConnectedAccount[];
  onClose: () => void;
  onChanged: (verifiedAt: string | null) => void;
}

interface VerificationResponse {
  verified: boolean;
  verifiedAt: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

// Verify Creator / Remove Verification (D13): a verified creator has at least one connected social
// account and passed our team's identity check, which happens outside the product.
export function CreatorVerificationDialog({ creatorId, creatorName, verifiedAt, connectedAccounts, onClose, onChanged }: CreatorVerificationDialogProps) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const verifying = !verifiedAt;
  const canVerify = connectedAccounts.length > 0;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const submit = async () => {
    try {
      setSubmitting(true);
      setError("");
      const data = await apiRequest<VerificationResponse>(`/admin/creators/${creatorId}/verification`, {
        method: "PATCH",
        token: getToken() || undefined,
        body: JSON.stringify({ verified: verifying }),
      });
      onChanged(data.verified ? data.verifiedAt : null);
    } catch (err: unknown) {
      // A creator without a connected account is refused with the reason (409).
      setError(err instanceof Error ? err.message : "Couldn't change verification");
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
        aria-labelledby="creator-verification-heading"
        className="bg-white border border-stone-200 rounded-3xl p-8 max-w-md w-full space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <h3 id="creator-verification-heading" className="font-medium text-lg text-stone-900">
            {verifying ? `Verify ${creatorName}?` : `Remove ${creatorName}'s Verification?`}
          </h3>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-stone-500">Connected Social Accounts</p>
            {connectedAccounts.length === 0 ? (
              <p className="text-xs font-medium text-red-700">
                None. A creator needs a connected TikTok, Instagram or Facebook account before they can be verified.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {connectedAccounts.map((account) => (
                  <li
                    key={`${account.platform}:${account.username || ""}`}
                    className="px-2.5 py-1 rounded-full bg-stone-100 text-[11px] font-medium text-stone-700"
                  >
                    {PLATFORM_LABELS[account.platform] || account.platform}
                    {account.username ? ` · @${account.username}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {reconnectNotices(connectedAccounts).map((notice) => (
              <p key={notice} className="mt-2 text-xs font-medium text-amber-700">
                {notice}. Ask the creator to reconnect it so their views keep syncing.
              </p>
            ))}
          </div>

          <p className="text-xs text-stone-500 font-medium leading-relaxed">
            {verifying
              ? "Only verify after checking the creator's identity. Campaigns that accept verified creators only will let them join, and the change is logged."
              : "The creator loses the Verified badge and can't join campaigns limited to verified creators. The change is logged."}
          </p>
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
            onClick={submit}
            disabled={submitting || (verifying && !canVerify)}
            className={cn(
              "flex-1 py-2.5 rounded-full font-semibold text-xs text-white disabled:opacity-50",
              verifying ? "bg-stone-900" : "bg-red-600"
            )}
          >
            {submitting ? "Saving…" : verifying ? "Verify Creator" : "Remove Verification"}
          </button>
        </div>
      </div>
    </div>
  );
}
