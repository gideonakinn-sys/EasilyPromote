"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@ep/ui/lib/utils";
import { formatWhen, referralApi, type ReferralStatus, type WebhookKey } from "../lib/referral";

// The steps that connect a brand's app: a key, then a code check and a test conversion
// from their own server.
export function ConnectAppChecklist({ status, hasKey }: { status: ReferralStatus | null; hasKey: boolean }) {
  const verification = status?.verification;
  const items = [
    {
      label: "Create a signing key",
      detail: hasKey ? "Done" : "Generate one in your referral settings",
      done: hasKey,
    },
    {
      label: "Your app checks a code",
      detail: verification?.codeCheckAt
        ? `Received ${formatWhen(verification.codeCheckAt).toLowerCase()}`
        : "Waiting for your server to call the code check",
      done: Boolean(verification?.codeCheckAt),
    },
    {
      label: "Your app sends a test conversion",
      detail: verification?.conversionAt
        ? `Received ${formatWhen(verification.conversionAt).toLowerCase()}`
        : 'Waiting for a conversion with "test": true from your server',
      done: Boolean(verification?.conversionAt),
    },
  ];

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center",
              item.done ? "bg-[#176448] text-white" : "border border-neutral-300"
            )}
            aria-hidden="true"
          >
            {item.done && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 font-rethink">
              {item.label}
              <span className="sr-only">{item.done ? " (done)" : " (not done yet)"}</span>
            </p>
            <p className="text-xs text-neutral-500 font-medium font-rethink">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Loads the brand's app connection and checks again every 10 seconds until it's
// connected, so checklists tick by themselves.
export function useReferralConnection(enabled = true) {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [keys, setKeys] = useState<WebhookKey[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextKeys] = await Promise.all([referralApi.status(), referralApi.listKeys()]);
      setStatus(nextStatus);
      setKeys(nextKeys);
    } catch {
      // The next check tries again.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const verified = Boolean(status?.verified);
  useEffect(() => {
    if (!enabled || verified) return;
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [enabled, verified, refresh]);

  const hasKey = keys.some((key) => key.status === "active" || key.status === "expiring");
  return { status, keys, hasKey, verified, loading, refresh };
}
