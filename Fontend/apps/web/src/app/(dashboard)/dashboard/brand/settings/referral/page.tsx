"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@ep/ui/lib/utils";
import { useToast } from "@ep/ui/components/toast";
import { Skeleton } from "../../../../../../components/ui/skeleton";
import { getUser, isAuthenticated } from "../../../../../../lib/api";
import { ConnectAppChecklist } from "../../../../../../components/connect-app-checklist";
import {
  DEVELOPER_DOCS_URL,
  MAX_KEY_NAME,
  REFERRAL_HOW_IT_WORKS,
  codeFormatText,
  buildDeveloperMessage,
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
  ignored: { label: "Duplicate", className: "bg-neutral-100 text-neutral-600" },
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
  expired: "bg-neutral-100 text-neutral-500",
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
  const [revealed, setRevealed] = useState<{ keyId: string; name: string; secret: string; rotated: boolean } | null>(null);
  // Naming a new key, or renaming an existing one.
  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "rename"; key: WebhookKey } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: "rotate" | "revoke"; key: WebhookKey } | null>(null);
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
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

  // Until the app is connected, check every 10 seconds so the checklist ticks by itself.
  const verified = Boolean(status?.verified);
  useEffect(() => {
    if (loading || error || verified) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await referralApi.status();
        setStatus(next);
        if (next.verified) toast("Your app is connected", "success");
      } catch {
        // The next check tries again.
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [loading, error, verified, toast]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} copied`, "success");
    } catch {
      toast("Couldn't copy. Select the text and copy it manually.", "error");
    }
  };

  const reveal = (key: WebhookKey, secret: string, rotated: boolean) => {
    setSavedConfirmed(false);
    setRevealed({ keyId: key.keyId, name: key.name, secret, rotated });
  };

  const openNameDialog = (dialog: { mode: "create" } | { mode: "rename"; key: WebhookKey }) => {
    setNameInput(dialog.mode === "rename" ? dialog.key.name : "");
    setNameDialog(dialog);
  };

  const handleGenerate = async (name: string) => {
    setGenerating(true);
    try {
      const result = await referralApi.createKey(name);
      reveal(result.key, result.secret, false);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not generate a key", "error");
    } finally {
      setGenerating(false);
    }
  };

  // Focus Cancel when the confirmation opens, and let Escape close it.
  useEffect(() => {
    if (!confirmAction) return;
    cancelConfirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmAction(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmAction]);

  const handleRotate = async (key: WebhookKey) => {
    setBusyKeyId(key.id);
    try {
      const result = await referralApi.rotateKey(key.id);
      reveal(result.key, result.secret, true);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not rotate the key", "error");
    } finally {
      setBusyKeyId(null);
    }
  };

  const handleRevoke = async (key: WebhookKey) => {
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

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDialog) return;
    const name = nameInput.trim();
    if (nameDialog.mode === "create") {
      setNameDialog(null);
      await handleGenerate(name);
      return;
    }
    setSavingName(true);
    try {
      await referralApi.renameKey(nameDialog.key.id, name);
      toast(name ? "Key renamed" : "Key name removed", "success");
      setNameDialog(null);
      await load();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Could not rename the key", "error");
    } finally {
      setSavingName(false);
    }
  };

  // Escape closes the name dialog.
  useEffect(() => {
    if (!nameDialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !savingName) setNameDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nameDialog, savingName]);

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, key } = confirmAction;
    setConfirmAction(null);
    if (type === "rotate") await handleRotate(key);
    else await handleRevoke(key);
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
  const sampleKey = keys.find((key) => key.status === "active");
  const sampleKeyId = sampleKey?.keyId || "key_…";
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

  const hasKey = keys.some((key) => key.status === "active" || key.status === "expiring");
  const verification = status?.verification;

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 font-rethink">
      <header className="flex items-center gap-3 px-5 h-14 border-b border-neutral-200 bg-neutral-50">
        <Link
          href="/dashboard/brand"
          aria-label="Back to dashboard"
          className="flex items-center justify-center w-8 h-8 rounded-full bg-neutral-200 shrink-0"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </Link>
        <span className="font-medium text-sm text-neutral-900">Referral tracking</span>
      </header>

      <main className="w-full max-w-[640px] mx-auto px-5 py-10 space-y-10">
        <div className="space-y-2">
          <h1 className="font-semibold tracking-tighter text-2xl text-neutral-900">Referral tracking</h1>
          <p className="text-sm text-neutral-500 font-medium leading-relaxed max-w-[60ch]">
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
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 space-y-3 text-center">
            <p className="font-medium text-sm text-neutral-900">Referral settings didn&apos;t load</p>
            <p className="text-xs text-neutral-500 font-medium">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                load();
              }}
              className="px-6 py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-full"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* How it works */}
            <section className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4" aria-labelledby="how-heading">
              <h2 id="how-heading" className="font-semibold text-sm text-neutral-900">How referral tracking works</h2>
              {status && (
                <p className="bg-neutral-50 rounded-xl px-3 py-2 text-xs text-neutral-600 font-medium leading-relaxed">
                  {codeFormatText(status.codePrefix)}
                </p>
              )}
              <ol className="space-y-3">
                {REFERRAL_HOW_IT_WORKS.map((item, index) => (
                  <li key={item.title} className="flex gap-3">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full bg-[#FEB604] text-[#171717] text-xs font-semibold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-neutral-900">{item.title}</p>
                      <p className="text-xs text-neutral-500 font-medium leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="bg-neutral-50 rounded-xl p-3 space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900">What you need</p>
                  <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                    A developer adds two small requests to your app. &quot;Send to your developer&quot; below gives them everything.
                  </p>
                </div>
                <div className="bg-neutral-50 rounded-xl p-3 space-y-0.5">
                  <p className="text-xs font-semibold text-neutral-900">What we never see</p>
                  <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                    Names, emails or phone numbers. Only the code and what happened.
                  </p>
                </div>
              </div>
            </section>

            {/* Connection */}
            <section className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4" aria-labelledby="connection-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="connection-heading" className="font-semibold text-sm text-neutral-900">Connect your app</h2>
                <span
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium flex items-center gap-1.5",
                    verified ? "bg-[#CBF5E5] text-[#176448]" : "bg-neutral-100 text-neutral-600"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", verified ? "bg-[#176448]" : "bg-neutral-400")} />
                  {verified ? "Connected" : "Not connected yet"}
                </span>
              </div>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                {verified
                  ? `Connected ${formatWhen(verification?.verifiedAt).toLowerCase()}. Last request ${formatWhen(status?.lastEventAt).toLowerCase()}.`
                  : 'Your app counts as connected once both requests below arrive from your server. The "Try a request" button on this page only checks your key.'}
              </p>

              <ConnectAppChecklist status={status} hasKey={hasKey} />

              {!verified && (
                <div className="space-y-1.5">
                  <button
                    onClick={() => copy(buildDeveloperMessage(status, sampleKeyId, sampleKey?.name), "Setup message")}
                    className="px-4 py-2 bg-neutral-900 text-white rounded-full text-xs font-semibold"
                  >
                    Send to your developer
                  </button>
                  <p className="text-[11px] text-neutral-500 font-medium leading-relaxed">
                    Copies the steps, both URLs and your key ID. Share your secret with them privately.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">Webhook URL</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-neutral-900 bg-neutral-100 px-3 py-2 rounded-lg break-all">
                    {webhookUrl}
                  </code>
                  <button
                    onClick={() => copy(webhookUrl, "Webhook URL")}
                    className="shrink-0 px-3 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="text-xs font-semibold text-neutral-900 underline underline-offset-2 disabled:opacity-50"
              >
                {refreshing ? "Checking…" : "Check connection again"}
              </button>
            </section>

            {/* Keys */}
            <section className="space-y-4" aria-labelledby="keys-heading">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 id="keys-heading" className="font-semibold text-sm text-neutral-900">Signing keys</h2>
                  <p className="text-xs text-neutral-500 font-medium">Up to {MAX_KEYS} at a time. Each request is signed with one.</p>
                </div>
                <button
                  onClick={() => openNameDialog({ mode: "create" })}
                  disabled={generating || keys.length >= MAX_KEYS}
                  className="shrink-0 px-4 py-2 bg-[#FEB604] text-[#171717] rounded-full text-xs font-semibold border border-neutral-100 disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {generating ? "Generating…" : "Generate key"}
                </button>
              </div>

              {keys.length === 0 ? (
                <div className="border border-dashed border-neutral-300 rounded-2xl p-6 text-center">
                  <p className="text-sm font-medium text-neutral-900">No keys yet</p>
                  <p className="text-xs text-neutral-500 font-medium mt-1">Generate one to start sending conversions.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {keys.map((key) => (
                    <li key={key.id} className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <p className={cn("text-sm font-medium break-words", key.name ? "text-neutral-900" : "text-neutral-400")}>
                            {key.name || "Unnamed key"}
                          </p>
                          <p className="font-mono text-xs text-neutral-700 break-all">{key.keyId}</p>
                          <p className="text-xs text-neutral-500 font-medium">Secret ending …{key.last4}</p>
                        </div>
                        <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize", KEY_STATUS_CHIPS[key.status])}>
                          {key.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium text-neutral-500">
                        <span>
                          Last used {formatWhen(key.lastUsedAt).toLowerCase()}
                          {key.status === "expiring" && key.expiresAt && ` · stops working ${formatWhen(key.expiresAt)}`}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openNameDialog({ mode: "rename", key })}
                            disabled={busyKeyId === key.id}
                            className="px-3 py-1.5 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 disabled:opacity-50"
                          >
                            Rename
                          </button>
                          {key.status === "active" && (
                            <button
                              onClick={() => setConfirmAction({ type: "rotate", key })}
                              disabled={busyKeyId === key.id || keys.length >= MAX_KEYS}
                              className="px-3 py-1.5 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 disabled:opacity-50"
                            >
                              Rotate
                            </button>
                          )}
                          <button
                            onClick={() => setConfirmAction({ type: "revoke", key })}
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
            <section className="bg-white border border-neutral-200 rounded-2xl p-5 space-y-4" aria-labelledby="test-heading">
              <div className="space-y-1">
                <h2 id="test-heading" className="font-semibold text-sm text-neutral-900">Try a request</h2>
                <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                  We sign a request with your newest key and run it through the real checks. Nothing is recorded, and it
                  doesn&apos;t connect your app: that needs requests from your own server.
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
                      testType === value ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
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
                  placeholder={testType === "validate" ? `Code to check, e.g. ${status?.codePrefix || "KUDA"}-TUNDE` : "Code to check (optional)"}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-[180px] px-4 py-2.5 bg-white border border-neutral-200 rounded-full text-sm font-mono text-neutral-900 placeholder-neutral-300 focus:outline-none focus:border-neutral-400"
                />
                <button
                  type="submit"
                  disabled={sendingTest || keys.length === 0 || (testType === "validate" && !testCode.trim())}
                  className="px-5 py-2.5 bg-neutral-900 text-white rounded-full text-xs font-semibold disabled:bg-neutral-200 disabled:text-neutral-400"
                >
                  {sendingTest ? "Sending…" : testType === "validate" ? "Check code" : "Send test event"}
                </button>
              </form>
              {keys.length === 0 && (
                <p className="text-xs text-neutral-500 font-medium">Generate a key first — test events are signed with it.</p>
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
                      <summary className="cursor-pointer text-xs font-semibold text-neutral-900">
                        Show the request and response
                      </summary>
                      <div className="mt-2 overflow-x-auto bg-neutral-900 rounded-2xl">
                        <pre className="p-4 text-xs leading-relaxed text-neutral-100 font-mono">{formatExchange(testResult)}</pre>
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
                  <h2 id="events-heading" className="font-semibold text-sm text-neutral-900">Recent requests</h2>
                  <p className="text-xs text-neutral-500 font-medium">Every signed request we received in the last 30 days.</p>
                </div>
                <button
                  onClick={handleRefreshEvents}
                  disabled={refreshingEvents}
                  className="shrink-0 px-4 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900 disabled:opacity-50"
                >
                  {refreshingEvents ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {events.length === 0 ? (
                <div className="border border-dashed border-neutral-300 rounded-2xl p-6 text-center">
                  <p className="text-sm font-medium text-neutral-900">No requests yet</p>
                  <p className="text-xs text-neutral-500 font-medium mt-1">
                    Test events and real conversions will appear here.
                  </p>
                </div>
              ) : (
                <ul className="bg-white border border-neutral-200 rounded-2xl divide-y divide-neutral-100">
                  {events.map((event) => {
                    const chip = DELIVERY_CHIPS[event.result] || DELIVERY_CHIPS.rejected;
                    return (
                      <li key={event.id} className="px-4 py-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium", chip.className)}>
                              {event.statusCode} · {chip.label}
                            </span>
                            {event.code && <code className="min-w-0 truncate font-mono text-xs text-neutral-900">{event.code}</code>}
                          </div>
                          <span className="shrink-0 text-xs font-medium text-neutral-500">{formatWhen(event.createdAt)}</span>
                        </div>
                        <p className="text-xs font-medium text-neutral-500 break-words">
                          {event.source === "dashboard_test"
                            ? "Dashboard test"
                            : event.source === "code_check"
                              ? "Code check from your server"
                              : "Conversion from your server"}
                          {event.eventType && ` · ${event.eventType}`}
                          {event.isTest && event.source !== "dashboard_test" && " · test"}
                          {event.result === "recorded" && !event.counted && " · stored, not counted (different event type)"}
                          {event.keyName && ` · key: ${event.keyName}`}
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
                <h2 id="guide-heading" className="font-semibold text-sm text-neutral-900">Send a conversion</h2>
                <p className="text-xs text-neutral-500 font-medium leading-relaxed max-w-[60ch]">
                  Call this from your server whenever someone converts with a partner code. Store the key ID and secret
                  as environment variables, never in your app or website code.
                </p>
                <a
                  href={DEVELOPER_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-semibold text-neutral-900 underline underline-offset-2"
                >
                  Read the full developer docs
                </a>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">Request</span>
                <div className="overflow-x-auto bg-neutral-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-neutral-100 font-mono">{sampleRequest}</pre>
                </div>
                <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                  <code className="font-mono text-neutral-900">event</code> is one of install, signup, lead, purchase, deposit or
                  custom. <code className="font-mono text-neutral-900">event_id</code> must be unique per conversion — resending
                  it is safe and never counts twice.
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">Check a code at sign-up</span>
                <div className="overflow-x-auto bg-neutral-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-neutral-100 font-mono">{sampleValidate}</pre>
                </div>
                <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                  Call this when a user enters a referral code, signed the same way. Accept the code when the answer is{" "}
                  <code className="font-mono text-neutral-900">{'"valid": true'}</code>. There&apos;s nothing to load or
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
                        language === lang ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 border border-neutral-200"
                      )}
                    >
                      {SNIPPET_LABELS[lang]}
                    </button>
                  ))}
                  <button
                    onClick={() => copy(buildSnippet(language, webhookUrl), "Code")}
                    className="ml-auto px-4 py-1.5 rounded-full text-xs font-semibold bg-white text-neutral-900 border border-neutral-200"
                  >
                    Copy code
                  </button>
                </div>
                <div className="overflow-x-auto bg-neutral-900 rounded-2xl">
                  <pre className="p-4 text-xs leading-relaxed text-neutral-100 font-mono">{buildSnippet(language, webhookUrl)}</pre>
                </div>
              </div>

              <div className="bg-[#EBF3FF] border border-dashed border-blue-200 rounded-2xl p-4 space-y-1">
                <p className="text-sm font-medium text-blue-900">Test before going live</p>
                <p className="text-xs text-blue-900/80 font-medium leading-relaxed">
                  Send any event with <code className="font-mono">&quot;test&quot;: true</code> from your server. We check
                  the key and signature without counting a conversion, and it ticks the test conversion step above. The code
                  doesn&apos;t need to exist yet.
                </p>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">Responses</span>
                <div className="bg-white border border-neutral-200 rounded-2xl divide-y divide-neutral-100">
                  {RESPONSES.map((row) => (
                    <div key={row.status} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 px-4 py-3">
                      <code className="shrink-0 sm:w-28 font-mono text-xs text-neutral-900">{row.status}</code>
                      <span className="text-xs text-neutral-500 font-medium leading-relaxed">{row.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {nameDialog && (
        <div
          className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-5"
          onClick={() => !savingName && setNameDialog(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="key-name-heading"
            className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleNameSubmit}
          >
            <div className="space-y-1">
              <h2 id="key-name-heading" className="font-semibold text-base text-neutral-900 tracking-tight">
                {nameDialog.mode === "create" ? "Name your key" : "Rename key"}
              </h2>
              <p className={cn("text-xs text-neutral-500 font-medium leading-relaxed", nameDialog.mode === "rename" && "font-mono break-all")}>
                {nameDialog.mode === "create"
                  ? "Optional. A name helps you tell keys apart, like Live app or Staging. Every key works for all your campaigns."
                  : nameDialog.key.keyId}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="key-name" className="text-xs font-medium text-neutral-500 block">
                Key name
              </label>
              <input
                id="key-name"
                autoFocus
                value={nameInput}
                maxLength={MAX_KEY_NAME}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Live app"
                className="w-full px-4 py-2.5 bg-white border border-neutral-200 rounded-full text-sm text-neutral-900 placeholder-neutral-300 focus:outline-none focus:border-neutral-400"
              />
              <p className="text-[11px] text-neutral-400 font-medium text-right tabular-nums">
                {nameInput.length}/{MAX_KEY_NAME}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNameDialog(null)}
                disabled={savingName}
                className="flex-1 py-3 bg-white border border-neutral-200 text-neutral-900 font-semibold text-sm rounded-full disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingName}
                className="flex-1 py-3 bg-neutral-900 text-white font-semibold text-sm rounded-full disabled:opacity-50"
              >
                {nameDialog.mode === "create" ? "Generate key" : savingName ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmAction && (
        <div
          className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-5"
          onClick={() => setConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-key-heading"
            aria-describedby="confirm-key-body"
            className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="confirm-key-heading" className="font-semibold text-base text-neutral-900 tracking-tight">
                {confirmAction.type === "rotate" ? "Rotate this key?" : "Revoke this key?"}
              </h2>
              <p id="confirm-key-body" className="text-xs text-neutral-500 font-medium leading-relaxed">
                {confirmAction.type === "rotate"
                  ? "We'll create a new key and secret. The current key keeps working for 24 hours while you swap in the new one."
                  : "Requests signed with this key will be rejected immediately. This can't be undone."}
              </p>
            </div>

            <div className="bg-neutral-100 px-3 py-2 rounded-lg space-y-0.5">
              {confirmAction.key.name && <p className="text-xs font-medium text-neutral-900 break-words">{confirmAction.key.name}</p>}
              <code className="block font-mono text-xs text-neutral-900 break-all">{confirmAction.key.keyId}</code>
            </div>
            {confirmAction.type === "rotate" && confirmAction.key.name && (
              <p className="text-xs text-neutral-500 font-medium">The new key keeps the name &ldquo;{confirmAction.key.name}&rdquo;.</p>
            )}

            <div className="flex gap-2">
              <button
                ref={cancelConfirmRef}
                type="button"
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-3 bg-white border border-neutral-200 text-neutral-900 font-semibold text-sm rounded-full"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className={cn(
                  "flex-1 py-3 font-semibold text-sm rounded-full text-white",
                  confirmAction.type === "rotate" ? "bg-neutral-900" : "bg-red-600"
                )}
              >
                {confirmAction.type === "rotate" ? "Rotate key" : "Revoke key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealed && (
        <div
          className="fixed inset-0 z-[100] bg-neutral-900/40 backdrop-blur-sm flex items-center justify-center px-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="secret-heading"
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="space-y-1">
              <h2 id="secret-heading" className="font-semibold text-base text-neutral-900 tracking-tight">
                Copy your secret key
              </h2>
              <p className="text-xs text-neutral-500 font-medium leading-relaxed">
                {revealed.name && <span className="block font-medium text-neutral-900 mb-1">{revealed.name}</span>}
                This is the only time you&apos;ll see it. Store it in your server&apos;s environment variables.
                {revealed.rotated && " Your previous key keeps working for 24 hours."}
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">EP_KEY_ID</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-neutral-900 bg-neutral-100 px-3 py-2 rounded-lg break-all">
                    {revealed.keyId}
                  </code>
                  <button
                    onClick={() => copy(revealed.keyId, "Key ID")}
                    className="shrink-0 px-3 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-medium text-neutral-500 block uppercase tracking-wider">EP_WEBHOOK_SECRET</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 font-mono text-xs text-neutral-900 bg-neutral-100 px-3 py-2 rounded-lg break-all">
                    {revealed.secret}
                  </code>
                  <button
                    onClick={() => copy(revealed.secret, "Secret")}
                    className="shrink-0 px-3 py-2 bg-white border border-neutral-200 rounded-full text-xs font-semibold text-neutral-900"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <label htmlFor="secret-saved" className="flex items-center gap-2 text-xs font-medium text-neutral-700">
              <input
                id="secret-saved"
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => setSavedConfirmed(e.target.checked)}
                className="w-4 h-4 accent-neutral-900"
              />
              I&apos;ve stored this secret somewhere safe
            </label>

            <button
              onClick={() => setRevealed(null)}
              disabled={!savedConfirmed}
              className="w-full py-3 bg-neutral-900 text-white font-semibold text-sm rounded-full disabled:bg-neutral-200 disabled:text-neutral-400"
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
