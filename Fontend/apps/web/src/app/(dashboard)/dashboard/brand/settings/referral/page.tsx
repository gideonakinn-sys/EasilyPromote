"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Skeleton } from "../../../../../../components/ui/skeleton";
import { getUser, isAuthenticated } from "../../../../../../lib/api";
import {
  DEVELOPER_DOCS_URL,
  formatWhen,
  referralApi,
  type ReferralStatus,
  type TestEventResult,
  type TestRequestType,
  type WebhookDeliveryLog,
  type WebhookKey,
} from "../../../../../../lib/referral";

type SnippetLanguage = "node" | "python" | "php";

const MAX_KEYS = 3;

const SNIPPET_LABELS: Record<SnippetLanguage, string> = {
  node: "Node.js",
  python: "Python",
  php: "PHP",
};

function buildSnippet(language: SnippetLanguage, url: string): string {
  if (language === "python") {
    return [
      "import hashlib, hmac, json, os, time",
      "from datetime import datetime, timezone",
      "import requests",
      "",
      'def send_conversion(code, event_id, event="signup", test=False):',
      "    payload = {",
      '        "event_id": event_id,',
      '        "code": code,',
      '        "event": event,',
      '        "timestamp": datetime.now(timezone.utc).isoformat(),',
      "    }",
      "    if test:",
      '        payload["test"] = True',
      '    body = json.dumps(payload, separators=(",", ":"))',
      "    t = str(int(time.time()))",
      "    v1 = hmac.new(",
      '        os.environ["EP_WEBHOOK_SECRET"].encode(),',
      '        f"{t}.{body}".encode(),',
      "        hashlib.sha256,",
      "    ).hexdigest()",
      "",
      "    res = requests.post(",
      `        "${url}",`,
      "        data=body,",
      "        headers={",
      '            "Content-Type": "application/json",',
      '            "X-EP-Key-Id": os.environ["EP_KEY_ID"],',
      '            "X-EP-Signature": f"t={t},v1={v1}",',
      "        },",
      "    )",
      "    return res.json()",
    ].join("\n");
  }

  if (language === "php") {
    return [
      "<?php",
      "function send_conversion(string $code, string $eventId, string $event = 'signup', bool $test = false): array {",
      "    $payload = [",
      "        'event_id' => $eventId,",
      "        'code' => $code,",
      "        'event' => $event,",
      "        'timestamp' => gmdate('Y-m-d\\TH:i:s\\Z'),",
      "    ];",
      "    if ($test) {",
      "        $payload['test'] = true;",
      "    }",
      "    $body = json_encode($payload);",
      "    $t = time();",
      "    $v1 = hash_hmac('sha256', $t . '.' . $body, getenv('EP_WEBHOOK_SECRET'));",
      "",
      `    $ch = curl_init('${url}');`,
      "    curl_setopt_array($ch, [",
      "        CURLOPT_POST => true,",
      "        CURLOPT_POSTFIELDS => $body,",
      "        CURLOPT_RETURNTRANSFER => true,",
      "        CURLOPT_HTTPHEADER => [",
      "            'Content-Type: application/json',",
      "            'X-EP-Key-Id: ' . getenv('EP_KEY_ID'),",
      '            "X-EP-Signature: t={$t},v1={$v1}",',
      "        ],",
      "    ]);",
      "    $response = curl_exec($ch);",
      "    curl_close($ch);",
      "    return json_decode($response, true);",
      "}",
    ].join("\n");
  }

  return [
    'const crypto = require("crypto");',
    "",
    'async function sendConversion({ code, eventId, event = "signup", test = false }) {',
    "  const body = JSON.stringify({",
    "    event_id: eventId,",
    "    code,",
    "    event,",
    "    timestamp: new Date().toISOString(),",
    "    ...(test ? { test: true } : {}),",
    "  });",
    "  const t = Math.floor(Date.now() / 1000);",
    "  const v1 = crypto",
    '    .createHmac("sha256", process.env.EP_WEBHOOK_SECRET)',
    "    .update(`${t}.${body}`)",
    '    .digest("hex");',
    "",
    `  const res = await fetch("${url}", {`,
    '    method: "POST",',
    "    headers: {",
    '      "Content-Type": "application/json",',
    '      "X-EP-Key-Id": process.env.EP_KEY_ID,',
    '      "X-EP-Signature": `t=${t},v1=${v1}`,',
    "    },",
    "    body,",
    "  });",
    "  return res.json();",
    "}",
  ].join("\n");
}

const RESPONSES: { status: string; meaning: string }[] = [
  { status: "200 recorded", meaning: "Conversion saved and credited to the creator." },
  { status: "200 ignored", meaning: "This event_id was already recorded. Safe to stop retrying." },
  { status: "200 test_ok", meaning: "Test event verified. Nothing was counted." },
  { status: "400", meaning: "The body is missing a field or has an invalid value. Check the details array." },
  { status: "401", meaning: "Unknown or revoked key, bad signature, or a timestamp more than 5 minutes off." },
  { status: "404", meaning: "No referral code with that value in your account." },
  { status: "409", meaning: "The campaign for that code has ended or the code is disabled." },
  { status: "429", meaning: "Too many requests for this key. Retry with backoff." },
];

const DELIVERY_CHIPS: Record<WebhookDeliveryLog["result"], { label: string; className: string }> = {
  recorded: { label: "Recorded", className: "bg-[#CBF5E5] text-[#176448]" },
  test_ok: { label: "Test passed", className: "bg-[#EBF3FF] text-blue-800" },
  valid: { label: "Valid code", className: "bg-[#CBF5E5] text-[#176448]" },
  invalid: { label: "Invalid code", className: "bg-amber-50 text-amber-800" },
  ignored: { label: "Duplicate", className: "bg-stone-100 text-stone-600" },
  rejected: { label: "Rejected", className: "bg-red-50 text-red-700" },
};

const INVALID_REASONS: Record<string, string> = {
  not_found: "no creator in your account has it",
  disabled: "the code is turned off",
  campaign_not_accepting: "its campaign isn't accepting conversions",
};

function describeTestResult(result: TestEventResult): { ok: boolean; message: string } {
  const { status, body } = result.response;
  if (status !== 200) {
    return { ok: false, message: `${status}: ${body.error || "The test request was rejected."}` };
  }
  if (result.type === "validate") {
    const value = typeof body.code === "string" ? body.code : "";
    return body.valid
      ? { ok: true, message: `${value} is valid. Your app should accept it.` }
      : {
          ok: false,
          message: `${value} isn't valid: ${INVALID_REASONS[body.reason || ""] || body.reason}. Your app should reject it.`,
        };
  }
  const code = typeof body.code === "object" ? body.code : undefined;
  if (!code || code.value === "TEST-CODE") {
    return { ok: true, message: "Signature verified. Your key works and you're connected." };
  }
  if (!code.found) {
    return { ok: true, message: `Signature verified. ${code.value} isn't assigned to a creator in your account yet, so a real event with it would get a 404.` };
  }
  const accepting = code.campaignAcceptingConversions
    ? "its campaign is accepting conversions"
    : "its campaign isn't accepting conversions right now, so a real event would get a 409";
  return { ok: true, message: `Signature verified. ${code.value} is set up (${code.status?.replace("_", " ")}) and ${accepting}.` };
}

function formatExchange(result: TestEventResult): string {
  const headerLines = Object.entries(result.request.headers).map(([name, value]) => `${name}: ${value}`);
  return [
    `${result.request.method} ${result.request.url}`,
    ...headerLines,
    "",
    JSON.stringify(result.request.body, null, 2),
    "",
    `← ${result.response.status}`,
    JSON.stringify(result.response.body, null, 2),
  ].join("\n");
}

const KEY_STATUS_CHIPS: Record<WebhookKey["status"], string> = {
  active: "bg-[#CBF5E5] text-[#176448]",
  expiring: "bg-amber-50 text-amber-800",
  revoked: "bg-red-50 text-red-700",
  expired: "bg-stone-100 text-stone-500",
};

function ReferralSettingsContent() {
  const router = useRouter();
  const { toast } = useToast();

  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [keys, setKeys] = useState<WebhookKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ keyId: string; secret: string; rotated: boolean } | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [language, setLanguage] = useState<SnippetLanguage>("node");
  const [events, setEvents] = useState<WebhookDeliveryLog[]>([]);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [testCode, setTestCode] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<TestEventResult | null>(null);
  const [testType, setTestType] = useState<TestRequestType>("validate");

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextStatus, nextKeys, nextEvents] = await Promise.all([
        referralApi.status(),
        referralApi.listKeys(),
        referralApi.events(),
      ]);
      setStatus(nextStatus);
      setKeys(nextKeys);
      setEvents(nextEvents);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load referral settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
      return;
    }
    if (getUser()?.role !== "business") {
      router.push("/dashboard/creator");
      return;
    }
    load();
  }, [router, load]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`, "success");
    } catch {
      toast("Couldn't copy. Select the text and copy it manually.", "error");
    }
  };

  const reveal = (keyId: string, secret: string, rotated: boolean) => {
    setSavedConfirmed(false);
    setRevealed({ keyId, secret, rotated });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await referralApi.createKey();
      reveal(result.key.keyId, result.secret, false);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not generate a key", "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleRotate = async (key: WebhookKey) => {
    if (!window.confirm(`Rotate ${key.keyId}? The current key keeps working for 24 hours while you swap in the new one.`)) return;
    setBusyKeyId(key.id);
    try {
      const result = await referralApi.rotateKey(key.id);
      reveal(result.key.keyId, result.secret, true);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not rotate the key", "error");
    } finally {
      setBusyKeyId(null);
    }
  };

  const handleRevoke = async (key: WebhookKey) => {
    if (!window.confirm(`Revoke ${key.keyId}? Requests signed with it will be rejected immediately.`)) return;
    setBusyKeyId(key.id);
    try {
      await referralApi.revokeKey(key.id);
      toast("Key revoked", "success");
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not revoke the key", "error");
    } finally {
      setBusyKeyId(null);
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleRefreshEvents = async () => {
    setRefreshingEvents(true);
    try {
      setEvents(await referralApi.events());
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not load recent requests", "error");
    } finally {
      setRefreshingEvents(false);
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingTest(true);
    try {
      setTestResult(await referralApi.sendTestEvent(testCode.trim() || undefined, testType));
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not send the test event", "error");
    } finally {
      setSendingTest(false);
    }
  };

  const webhookUrl = status?.webhookUrl || "";
  const sampleKeyId = keys.find((key) => key.status === "active")?.keyId || "key_…";
  const sampleValidate = [
    `POST ${status?.validateUrl || ""}`,
    "Content-Type: application/json",
    `X-EP-Key-Id: ${sampleKeyId}`,
    "X-EP-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of \"t.body\">",
    "",
    '{ "code": "KUDA-TUNDE" }',
    "",
    '← 200 { "valid": true, "code": "KUDA-TUNDE", "campaign_id": "…", "event": "signup" }',
  ].join("\n");
  const sampleRequest = [
    `POST ${webhookUrl}`,
    "Content-Type: application/json",
    `X-EP-Key-Id: ${sampleKeyId}`,
    "X-EP-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of \"t.body\">",
    "",
    "{",
    '  "event_id": "your-unique-id-123",',
    '  "code": "ACME-TUNDE",',
    '  "event": "signup",',
    '  "timestamp": "2026-09-14T15:04:00Z"',
    "}",
  ].join("\n");

  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900 font-rethink">
      <header className="flex items-center gap-3 px-5 h-14 border-b border-stone-200 bg-stone-50">
        <Link
          href="/dashboard/brand"
          aria-label="Back to dashboard"
          className="flex items-center justify-center w-8 h-8 rounded-full bg-stone-200 shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </Link>
        <span className="font-medium text-sm text-stone-900">Referral tracking</span>
      </header>

      <main className="w-full max-w-[640px] mx-auto px-5 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="font-semibold tracking-tighter text-2xl text-stone-900">Referral tracking</h1>
          <p className="text-sm text-stone-500 font-medium leading-relaxed max-w-[60ch]">
            When someone converts with a creator&apos;s code, your server sends us one signed request. Set it up once
            and it works for every campaign. Send only the code, event and time — never names, emails or phone numbers.
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : error ? (
          <div className="bg-white border border-stone-200 rounded-2xl p-6 space-y-3 text-center">
            <p className="font-medium text-sm text-stone-900">Referral settings didn&apos;t load</p>
            <p className="text-xs text-stone-500 font-medium">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-full"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* Connection */}
            <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" aria-labelledby="connection-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="connection-heading" className="font-semibold text-sm text-stone-900">Connection</h2>
                <span
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5",
                    status?.connected ? "bg-[#CBF5E5] text-[#176448]" : "bg-stone-100 text-stone-600"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", status?.connected ? "bg-[#176448]" : "bg-stone-400")} />
                  {status?.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              <p className="text-xs text-stone-500 font-medium leading-relaxed">
                {status?.connected
                  ? `Last signed request ${formatWhen(status.lastEventAt).toLowerCase()}.`
                  : "Generate a key, then send a test event. You'll show as connected once it arrives."}
              </p>

              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">Webhook URL</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-stone-900 bg-stone-100 px-3 py-2 rounded-lg break-all">
                    {webhookUrl}
                  </code>
                  <button
                    onClick={() => copy(webhookUrl, "Webhook URL")}
                    className="shrink-0 px-3 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="text-xs font-semibold text-stone-900 underline underline-offset-2 disabled:opacity-50"
              >
                {refreshing ? "Checking…" : "Check connection again"}
              </button>
            </section>

            {/* Keys */}
            <section className="space-y-4" aria-labelledby="keys-heading">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 id="keys-heading" className="font-semibold text-sm text-stone-900">Signing keys</h2>
                  <p className="text-xs text-stone-500 font-medium">Up to {MAX_KEYS} at a time. Each request is signed with one.</p>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating || keys.length >= MAX_KEYS}
                  className="shrink-0 px-4 py-2 bg-[#FEB604] text-[#1C1917] rounded-full text-xs font-semibold border border-stone-100 disabled:bg-stone-200 disabled:text-stone-400"
                >
                  {generating ? "Generating…" : "Generate key"}
                </button>
              </div>

              {keys.length === 0 ? (
                <div className="border border-dashed border-stone-300 rounded-2xl p-6 text-center">
                  <p className="text-sm font-medium text-stone-900">No keys yet</p>
                  <p className="text-xs text-stone-500 font-medium mt-1">Generate one to start sending conversions.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {keys.map((key) => (
                    <li key={key.id} className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-mono text-sm text-stone-900 break-all">{key.keyId}</p>
                          <p className="text-xs text-stone-500 font-medium">Secret ending …{key.last4}</p>
                        </div>
                        <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize", KEY_STATUS_CHIPS[key.status])}>
                          {key.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-stone-500">
                        <span>
                          Last used {formatWhen(key.lastUsedAt).toLowerCase()}
                          {key.status === "expiring" && key.expiresAt && ` · stops working ${formatWhen(key.expiresAt)}`}
                        </span>
                        <div className="flex gap-2">
                          {key.status === "active" && (
                            <button
                              onClick={() => handleRotate(key)}
                              disabled={busyKeyId === key.id || keys.length >= MAX_KEYS}
                              className="px-3 py-1.5 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900 disabled:opacity-50"
                            >
                              Rotate
                            </button>
                          )}
                          <button
                            onClick={() => handleRevoke(key)}
                            disabled={busyKeyId === key.id}
                            className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-full text-xs font-semibold text-red-600 disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Test sender */}
            <section className="bg-white border border-stone-200 rounded-2xl p-5 space-y-4" aria-labelledby="test-heading">
              <div className="space-y-1">
                <h2 id="test-heading" className="font-semibold text-sm text-stone-900">Try a request</h2>
                <p className="text-xs text-stone-500 font-medium leading-relaxed">
                  We sign a request with your newest key and run it through the real checks. Nothing is recorded.
                </p>
              </div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Request type">
                {([
                  ["validate", "Check a code"],
                  ["conversion", "Test conversion"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={testType === value}
                    onClick={() => {
                      setTestType(value);
                      setTestResult(null);
                    }}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                      testType === value ? "bg-stone-900 text-white" : "bg-white text-stone-600 border border-stone-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-500 font-medium leading-relaxed">
                {testType === "validate"
                  ? "What your sign-up flow calls when a user enters a code."
                  : "A signed conversion marked as a test. Add a code to see whether it would match."}
              </p>
              <form onSubmit={handleSendTest} className="flex flex-wrap gap-2">
                <label htmlFor="test-code" className="sr-only">
                  Referral code to check (optional)
                </label>
                <input
                  id="test-code"
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value.toUpperCase())}
                  placeholder={testType === "validate" ? "Code to check, e.g. KUDA-TUNDE" : "Code to check (optional)"}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-[180px] px-4 py-2.5 bg-white border border-stone-200 rounded-full text-sm font-mono text-stone-900 placeholder-stone-300 focus:outline-none focus:border-stone-400"
                />
                <button
                  type="submit"
                  disabled={sendingTest || keys.length === 0 || (testType === "validate" && !testCode.trim())}
                  className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-xs font-semibold disabled:bg-stone-200 disabled:text-stone-400"
                >
                  {sendingTest ? "Sending…" : testType === "validate" ? "Check code" : "Send test event"}
                </button>
              </form>
              {keys.length === 0 && (
                <p className="text-xs text-stone-500 font-medium">Generate a key first — test events are signed with it.</p>
              )}
              {testResult && (() => {
                const outcome = describeTestResult(testResult);
                return (
                  <div className="space-y-3">
                    <p
                      role="status"
                      className={cn(
                        "rounded-xl px-4 py-3 text-xs font-medium leading-relaxed",
                        outcome.ok ? "bg-[#CBF5E5] text-[#176448]" : "bg-red-50 text-red-700"
                      )}
                    >
                      {outcome.message}
                    </p>
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-stone-900">
                        Show the request and response
                      </summary>
                      <div className="mt-2 overflow-x-auto bg-stone-900 rounded-2xl">
                        <pre className="p-4 text-xs leading-relaxed text-stone-100 font-mono">{formatExchange(testResult)}</pre>
                      </div>
                    </details>
                  </div>
                );
              })()}
            </section>

            {/* Recent requests */}
            <section className="space-y-4" aria-labelledby="events-heading">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 id="events-heading" className="font-semibold text-sm text-stone-900">Recent requests</h2>
                  <p className="text-xs text-stone-500 font-medium">Every signed request we received in the last 30 days.</p>
                </div>
                <button
                  onClick={handleRefreshEvents}
                  disabled={refreshingEvents}
                  className="shrink-0 px-4 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900 disabled:opacity-50"
                >
                  {refreshingEvents ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {events.length === 0 ? (
                <div className="border border-dashed border-stone-300 rounded-2xl p-6 text-center">
                  <p className="text-sm font-medium text-stone-900">No requests yet</p>
                  <p className="text-xs text-stone-500 font-medium mt-1">
                    Test events and real conversions will appear here.
                  </p>
                </div>
              ) : (
                <ul className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
                  {events.map((event) => {
                    const chip = DELIVERY_CHIPS[event.result] || DELIVERY_CHIPS.rejected;
                    return (
                      <li key={event.id} className="px-4 py-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium", chip.className)}>
                              {event.statusCode} · {chip.label}
                            </span>
                            {event.code && <code className="min-w-0 truncate font-mono text-xs text-stone-900">{event.code}</code>}
                          </div>
                          <span className="shrink-0 text-xs font-medium text-stone-500">{formatWhen(event.createdAt)}</span>
                        </div>
                        <p className="text-xs font-medium text-stone-500 break-words">
                          {event.source === "dashboard_test"
                            ? "Dashboard test"
                            : event.source === "code_check"
                              ? "Code check from your server"
                              : "Conversion from your server"}
                          {event.eventType && ` · ${event.eventType}`}
                          {event.isTest && event.source !== "dashboard_test" && " · test"}
                          {event.result === "recorded" && !event.counted && " · stored, not counted (different event type)"}
                          {event.eventId && ` · ${event.eventId}`}
                        </p>
                        {event.error && <p className="text-xs font-medium text-red-700 break-words">{event.error}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Integration guide */}
            <section className="space-y-6" aria-labelledby="guide-heading">
              <div className="space-y-1">
                <h2 id="guide-heading" className="font-semibold text-sm text-stone-900">Send a conversion</h2>
                <p className="text-xs text-stone-500 font-medium leading-relaxed max-w-[60ch]">
                  Call this from your server whenever someone converts with a partner code. Store the key ID and secret
                  as environment variables, never in your app or website code.
                </p>
                <a
                  href={DEVELOPER_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-semibold text-stone-900 underline underline-offset-2"
                >
                  Read the full developer docs
                </a>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">Request</span>
                <div className="overflow-x-auto bg-stone-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-stone-100 font-mono">{sampleRequest}</pre>
                </div>
                <p className="text-xs text-stone-500 font-medium leading-relaxed">
                  <code className="font-mono text-stone-900">event</code> is one of install, signup, purchase, deposit or
                  custom. <code className="font-mono text-stone-900">event_id</code> must be unique per conversion — resending
                  it is safe and never counts twice.
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">Check a code at sign-up</span>
                <div className="overflow-x-auto bg-stone-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-stone-100 font-mono">{sampleValidate}</pre>
                </div>
                <p className="text-xs text-stone-500 font-medium leading-relaxed">
                  Call this when a user enters a referral code, signed the same way. Accept the code when the answer is{" "}
                  <code className="font-mono text-stone-900">{'"valid": true'}</code>. There&apos;s nothing to load or
                  sync — new creators&apos; codes work as soon as they join.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Code example language">
                  {(Object.keys(SNIPPET_LABELS) as SnippetLanguage[]).map((lang) => (
                    <button
                      key={lang}
                      role="tab"
                      aria-selected={language === lang}
                      onClick={() => setLanguage(lang)}
                      className={cn(
                        "px-4 py-1.5 rounded-full text-xs font-medium transition-colors",
                        language === lang ? "bg-stone-900 text-white" : "bg-white text-stone-600 border border-stone-200"
                      )}
                    >
                      {SNIPPET_LABELS[lang]}
                    </button>
                  ))}
                  <button
                    onClick={() => copy(buildSnippet(language, webhookUrl), "Code")}
                    className="ml-auto px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-stone-900 border border-stone-200"
                  >
                    Copy code
                  </button>
                </div>
                <div className="overflow-x-auto bg-stone-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-stone-100 font-mono">{buildSnippet(language, webhookUrl)}</pre>
                </div>
              </div>

              <div className="bg-[#EBF3FF] border border-dashed border-blue-200 rounded-2xl p-4 space-y-1">
                <p className="text-sm font-medium text-blue-900">Test before going live</p>
                <p className="text-xs text-blue-900/80 font-medium leading-relaxed">
                  Send any event with <code className="font-mono">&quot;test&quot;: true</code>. We check the key and
                  signature and mark you connected, without counting a conversion. The code doesn&apos;t need to exist yet.
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">Responses</span>
                <div className="bg-white border border-stone-200 rounded-2xl divide-y divide-stone-100">
                  {RESPONSES.map((row) => (
                    <div key={row.status} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
                      <code className="shrink-0 sm:w-28 font-mono text-xs text-stone-900">{row.status}</code>
                      <span className="text-xs text-stone-500 font-medium leading-relaxed">{row.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {revealed && (
        <div
          className="fixed inset-0 z-[100] bg-stone-900/40 backdrop-blur-sm flex items-center justify-center px-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="secret-heading"
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="space-y-1">
              <h2 id="secret-heading" className="font-semibold text-base text-stone-900 tracking-tight">
                Copy your secret key
              </h2>
              <p className="text-xs text-stone-500 font-medium leading-relaxed">
                This is the only time you&apos;ll see it. Store it in your server&apos;s environment variables.
                {revealed.rotated && " Your previous key keeps working for 24 hours."}
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">EP_KEY_ID</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-stone-900 bg-stone-100 px-3 py-2 rounded-lg break-all">
                    {revealed.keyId}
                  </code>
                  <button
                    onClick={() => copy(revealed.keyId, "Key ID")}
                    className="shrink-0 px-3 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-stone-500 block uppercase tracking-wider">EP_WEBHOOK_SECRET</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-stone-900 bg-stone-100 px-3 py-2 rounded-lg break-all">
                    {revealed.secret}
                  </code>
                  <button
                    onClick={() => copy(revealed.secret, "Secret")}
                    className="shrink-0 px-3 py-2 bg-white border border-stone-200 rounded-full text-xs font-semibold text-stone-900"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <label htmlFor="secret-saved" className="flex items-center gap-2 text-xs font-medium text-stone-700">
              <input
                id="secret-saved"
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
                className="w-4 h-4 accent-stone-900"
              />
              I&apos;ve stored this secret somewhere safe
            </label>

            <button
              onClick={() => setRevealed(null)}
              disabled={!savedConfirmed}
              className="w-full py-3 bg-stone-900 text-white font-semibold text-sm rounded-full disabled:bg-stone-200 disabled:text-stone-400"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReferralSettingsPage() {
  return <ReferralSettingsContent />;
}
