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

// A campaign can count several types; the specific noun only reads right when there's one.
export function conversionNounFor(eventTypes: string[] | undefined, count: number): string {
  return conversionNoun(eventTypes && eventTypes.length === 1 ? eventTypes[0] : "custom", count);
}

export function eventTypeLabels(eventTypes: string[] | undefined): string {
  return (eventTypes || [])
    .map((type) => REFERRAL_EVENT_TYPES.find((option) => option.value === type)?.label || type)
    .join(", ");
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

// Plain-language explanation for brands, shown in the campaign wizard and on the referral screen.
export const REFERRAL_HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "Every creator gets their own code",
    body: "We create it when they join your campaign, for example KUDA-TUNDE. They share it in their videos.",
  },
  {
    title: "People join your app with the code",
    body: "They type it in when they sign up, download your app or buy something.",
  },
  {
    title: "Your app checks the code with us",
    body: "We answer yes or no instantly. When the sign-up is done, your app tells us.",
  },
  {
    title: "You see results per creator",
    body: "Sign-ups show up per creator as they happen, and creators are paid per real sign-up from your referral budget.",
  },
];

// Everything a developer needs to connect the brand's app, except the secret, which is shared privately.
export function buildDeveloperMessage(status: { webhookUrl?: string; validateUrl?: string } | null, keyId: string): string {
  return [
    "Please connect our app to Easily Promote referral tracking.",
    "",
    `Key ID (EP_KEY_ID): ${keyId}`,
    "Secret (EP_WEBHOOK_SECRET): I'll share it privately.",
    "",
    `1. When a user enters a referral code, POST { "code": "..." } to ${status?.validateUrl || ""} and accept it only if the answer has "valid": true.`,
    `2. When they finish signing up, POST the conversion to ${status?.webhookUrl || ""}.`,
    '3. Sign every request with the X-EP-Key-Id and X-EP-Signature headers (HMAC-SHA256 of "timestamp.body").',
    "",
    'To finish setup, send one code check and one conversion with "test": true from our server.',
    `Docs and code samples: ${DEVELOPER_DOCS_URL}`,
  ].join("\n");
}

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

export const MIN_REFERRAL_BUDGET = 1000;

export function formatNaira(value: number | null | undefined): string {
  return `₦${(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export interface ReferralSettings {
  enabled: boolean;
  eventType: ReferralEventType;
  eventTypes: ReferralEventType[];
  codeSource: ReferralCodeSource;
  conversions: number;
  // What a creator earns per counted conversion, set by Easily Promote (0 until it's set),
  // and the separately funded budget that pays it.
  rewardPerConversion: number;
  requestedBudget?: number;
  budget: number;
  platformFee: number;
  platformFeePercent?: number;
  pool: number;
  poolRemaining: number;
  earned: number;
  budgetExhausted?: boolean;
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
  // True once a code check and a conversion have arrived from the brand's own server.
  verified: boolean;
  verification: { codeCheckAt: string | null; conversionAt: string | null; verifiedAt: string | null };
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
  earned: number;
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

// Brands can't set the reward per conversion; Easily Promote does.
export type SettingsChanges = Partial<Pick<ReferralSettings, "enabled" | "eventTypes" | "codeSource">>;

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
  startReferralBudget: (campaignId: string, amount: number) =>
    apiRequest<{ authorization_url: string; reference: string }>(`/campaigns/${campaignId}/referral-budget/init`, {
      method: "POST",
      body: JSON.stringify({ amount }),
      ...auth(),
    }),
  confirmReferralBudget: (campaignId: string, paystackReference: string) =>
    apiRequest<{ referral: ReferralSettings; amount: number; credited: boolean; alreadyCredited: boolean }>(
      `/campaigns/${campaignId}/referral-budget`,
      { method: "PATCH", body: JSON.stringify({ paystackReference }), ...auth() }
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
