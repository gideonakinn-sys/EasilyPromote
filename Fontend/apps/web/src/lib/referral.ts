import { API_URL, apiRequest, getToken } from "./api";

export type ReferralEventType = "install" | "signup" | "purchase" | "deposit" | "custom";
export type ReferralCodeSource = "easilypromote" | "business";

export const REFERRAL_EVENT_TYPES: { value: ReferralEventType; label: string }[] = [
  { value: "signup", label: "Sign-ups" },
  { value: "install", label: "App installs" },
  { value: "purchase", label: "Purchases" },
  { value: "deposit", label: "Deposits" },
  { value: "custom", label: "Custom event" },
];

export const CODE_SOURCE_OPTIONS: { value: ReferralCodeSource; label: string; shortLabel: string; description: string }[] = [
  {
    value: "easilypromote",
    label: "Easily Promote creates them",
    shortLabel: "Easily Promote codes",
    description: "We generate a code for each creator. Your app checks codes with our API as users enter them, so there's nothing to load.",
  },
  {
    value: "business",
    label: "We'll use our own codes",
    shortLabel: "Your own codes",
    description: "Enter or upload a code per creator from your existing referral system.",
  },
];

const CONVERSION_NOUNS: Record<ReferralEventType, [string, string]> = {
  signup: ["sign-up", "sign-ups"],
  install: ["install", "installs"],
  purchase: ["purchase", "purchases"],
  deposit: ["deposit", "deposits"],
  custom: ["conversion", "conversions"],
};

export function conversionNoun(eventType: string | undefined, count: number): string {
  const nouns = CONVERSION_NOUNS[(eventType as ReferralEventType) || "custom"] || CONVERSION_NOUNS.custom;
  return count === 1 ? nouns[0] : nouns[1];
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return rtf.format(diffSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  return rtf.format(Math.round(diffSeconds / 86400), "day");
}

export const DEVELOPER_DOCS_URL = "https://www.easilypromote.com/developers";

export interface WebhookDeliveryLog {
  id: string;
  createdAt: string;
  source: "webhook" | "code_check" | "dashboard_test";
  statusCode: number;
  result: "recorded" | "ignored" | "test_ok" | "valid" | "invalid" | "rejected";
  error: string | null;
  eventId: string | null;
  code: string | null;
  eventType: string | null;
  isTest: boolean;
  counted: boolean;
  keyId: string | null;
}

export type TestRequestType = "validate" | "conversion";

export interface TestEventResult {
  type: TestRequestType;
  request: { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> };
  response: {
    status: number;
    body: {
      status?: string;
      error?: string;
      details?: string[];
      valid?: boolean;
      reason?: string;
      campaign_id?: string;
      event?: string;
      code?: string | { value: string; found: boolean; status?: string; campaignAcceptingConversions?: boolean };
    };
  };
}

export interface ReferralSettings {
  enabled: boolean;
  eventType: ReferralEventType;
  codeSource: ReferralCodeSource;
  conversions: number;
}

export interface WebhookKey {
  id: string;
  keyId: string;
  last4: string;
  status: "active" | "expiring" | "revoked" | "expired";
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ReferralStatus {
  connected: boolean;
  connectedAt: string | null;
  lastEventAt: string | null;
  activeKeys: number;
  webhookUrl: string;
  validateUrl: string;
}

export interface ReferralCodeRow {
  slotId: string;
  creatorId: string;
  creatorName: string | null;
  creatorUsername: string | null;
  codeId: string | null;
  code: string | null;
  source: ReferralCodeSource | null;
  status: "active" | "awaiting_business" | "disabled" | "missing";
  conversions: number;
  loadedAt: string | null;
}

export interface ReferralCodesPayload {
  referral: ReferralSettings;
  summary: { creators: number; active: number; awaitingBusiness: number; missing: number; conversions: number };
  codes: ReferralCodeRow[];
}

export interface ReferralImportResult {
  saved: number;
  failed: number;
  results: { row: number; creatorUsername: string; code: string | null; status: "saved" | "error"; error?: string }[];
}

type SettingsChanges = Partial<Pick<ReferralSettings, "enabled" | "eventType" | "codeSource">>;

const auth = () => ({ token: getToken() || undefined });

export const referralApi = {
  status: () => apiRequest<ReferralStatus>("/referral/status", auth()),
  listKeys: () => apiRequest<WebhookKey[]>("/referral/keys", auth()),
  createKey: () => apiRequest<{ key: WebhookKey; secret: string }>("/referral/keys", { method: "POST", ...auth() }),
  rotateKey: (id: string) =>
    apiRequest<{ key: WebhookKey; secret: string; previousKey: WebhookKey }>(`/referral/keys/${id}/rotate`, {
      method: "POST",
      ...auth(),
    }),
  revokeKey: (id: string) => apiRequest<WebhookKey>(`/referral/keys/${id}`, { method: "DELETE", ...auth() }),
  sendTestEvent: (code: string | undefined, type: TestRequestType) =>
    apiRequest<TestEventResult>("/referral/test-event", {
      method: "POST",
      body: JSON.stringify({ type, ...(code ? { code } : {}) }),
      ...auth(),
    }),
  events: () => apiRequest<WebhookDeliveryLog[]>("/referral/events", auth()),
  updateSettings: (campaignId: string, changes: SettingsChanges) =>
    apiRequest<{ referral: ReferralSettings; codesCreated: number }>(`/campaigns/${campaignId}/referral`, {
      method: "PATCH",
      body: JSON.stringify(changes),
      ...auth(),
    }),
  listCodes: (campaignId: string) => apiRequest<ReferralCodesPayload>(`/campaigns/${campaignId}/referral-codes`, auth()),
  markLoaded: (campaignId: string, codeIds?: string[]) =>
    apiRequest<{ updated: number }>(`/campaigns/${campaignId}/referral-codes/mark-loaded`, {
      method: "POST",
      body: JSON.stringify(codeIds ? { codeIds } : {}),
      ...auth(),
    }),
  setCode: (campaignId: string, slotId: string, code: string) =>
    apiRequest<{ codeId: string; slotId: string; code: string; status: string }>(
      `/campaigns/${campaignId}/referral-codes/${slotId}`,
      { method: "PUT", body: JSON.stringify({ code }), ...auth() }
    ),
  importCodes: (campaignId: string, csv: string) =>
    apiRequest<ReferralImportResult>(`/campaigns/${campaignId}/referral-codes/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
      ...auth(),
    }),
};

// apiRequest always parses JSON, so the CSV export is fetched directly and saved as a file.
export async function downloadReferralCodesCsv(campaignId: string) {
  const res = await fetch(`${API_URL}/campaigns/${campaignId}/referral-codes.csv`, {
    headers: { Authorization: `Bearer ${getToken() || ""}` },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Download failed" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `referral-codes-${campaignId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
