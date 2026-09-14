# Referral Tracking — Implementation Plan

Status: **Phases 1–5 complete** (Phase 6 blocked on payout decision, Phase 7 later) · Branch: `feature/referral-tracking` · Last updated: 2026-09-14

## Goal

Let businesses track signups (or other conversions) that come from each creator's referral code.

- Easily Promote generates a unique code per creator per campaign.
- The business loads that code into its own app (or gives us its own codes).
- When a user converts with a code, the **business's server sends us a signed webhook**.
- We match the code to the creator and credit them.

## Non-negotiable rules

1. **Creators never sign up on, or touch, the business's platform.** Codes are exchanged between Easily Promote and the business only.
2. **No PII.** Webhooks carry only `event_id`, `code`, `event`, `timestamp` (and optional `test`). Never names, emails, phones, amounts.
3. **Referral tracking never blocks a campaign going live.** Campaigns still go live on payment and earn on views as today; referral tracking runs alongside.
4. **The business defines what a conversion is.** We never encode their business logic.
5. **We issue the webhook URL and keys.** Businesses self-generate keys in their dashboard; they can't choose the key value.

## Webhook contract (what businesses integrate)

```
POST https://api.easilypromote.com/api/webhooks/conversions
Content-Type: application/json
X-EP-Key-Id:    key_4f9a2c
X-EP-Signature: t=1757862240,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` using the whsec_ secret>

{
  "event_id":  "acme-signup-88213",     // business's unique id — idempotency key
  "code":      "ACME-TUNDE",
  "event":     "signup",                // install | signup | purchase | deposit | custom
  "timestamp": "2026-09-14T15:04:00Z",
  "test":      false                    // optional
}
```

Responses:

| Case | Status |
|---|---|
| Missing/unknown/revoked/expired key, bad signature, timestamp outside ±5 min | `401` |
| Invalid body | `400` |
| Code not found for this business | `404` |
| Campaign not live/paused/completed (or past grace window) | `409` |
| Duplicate `event_id` | `200` `{ "status": "ignored" }` |
| Saved | `200` `{ "status": "recorded" }` |

## Codebase context

- Backend: Express + Mongoose (MongoDB). Logic lives in route handlers (`Backend/src/routes/*.js`), shared logic in `services/` and `utils/`, models in `models/`. No controllers folder.
- Webhooks: `routes/webhooks.js` is mounted at `/api/webhooks` **before** `express.json` in `app.js` (line ~65), and uses `express.raw` — copy the Paystack pattern.
- Encryption helper: `utils/crypto.js` (`encrypt`/`decrypt`, AES-256-GCM).
- Validation: `zod` is installed. No rate limiting and no test framework exist yet.
- Auth: `middleware/auth.js` → `protect`, `authorizeRoles("business" | "creator")`.
- Sockets: `emitToUser(userId, event, payload)` from `config/socket.js`.
- Creator joins a campaign via `POST /api/slots/claim` in `routes/slots.js` (slot saved ~line 124).
- Campaign statuses: `draft`, `pending_payment`, `under_review`, `live`, `paused`, `completed`, `cancelled`.
- Businesses are `User` with `role: "business"` + `BusinessProfile`.
- Frontend: implement in `Fontend/apps/web` only (standalone `apps/brand` and `apps/creator` are duplicates — skip for now).
  - Business campaign detail: `apps/web/src/components/campaign-details.tsx`
  - Create campaign: `apps/web/src/app/(dashboard)/dashboard/brand/create-campaign/page.tsx`
  - Creator campaign: `apps/web/src/app/(dashboard)/dashboard/creator/campaign/[id]/page.tsx` + `apps/web/src/components/campaign-details-drawer.tsx`
  - API clients: `apps/web/src/lib/api.ts`

---

## Phase 1 — Data models

- [x] `models/WebhookKey.js`
  - `businessId` (ref User, required), `keyId` (string, `key_` + 12 hex, unique), `secretEncrypted` (via `utils/crypto.js`), `last4`
  - `status`: `active` | `expiring` | `revoked` (default `active`), `expiresAt`, `lastUsedAt`, timestamps
  - Indexes: `{ keyId: 1 }` unique, `{ businessId: 1, status: 1 }`
- [x] `models/ReferralCode.js`
  - `businessId`, `campaignId`, `slotId`, `creatorId`, `code` (uppercase, trimmed)
  - `source`: `easilypromote` | `business`
  - `status`: `awaiting_business` | `active` | `disabled`
  - `conversions` (Number, default 0), `loadedAt`, timestamps
  - Indexes: `{ businessId: 1, code: 1 }` unique, `{ campaignId: 1 }`, `{ creatorId: 1 }`, `{ slotId: 1 }`
- [x] `models/ConversionEvent.js`
  - `businessId`, `campaignId`, `referralCodeId`, `creatorId`, `eventId`, `eventType`, `occurredAt`, `isTest` (default false), timestamps
  - Indexes: `{ businessId: 1, eventId: 1 }` unique, `{ campaignId: 1, occurredAt: -1 }`, `{ creatorId: 1, occurredAt: -1 }`
- [x] `models/Campaign.js` — add
  - `referral: { enabled: Boolean (default false), eventType: enum (default "signup"), codeSource: "easilypromote" | "business" (default "easilypromote"), conversions: Number (default 0) }`
- [x] `models/BusinessProfile.js` — add `referralConnectedAt: Date` (set on first valid test/real event)

## Phase 2 — Key management API

- [x] `routes/referral.js`, mounted in `app.js` at `/api/referral` (after `express.json`); all routes `protect, authorizeRoles("business")`
- [x] `POST /keys` — generate `keyId` + secret (`whsec_` + 32 random bytes base64url), store encrypted, return `{ keyId, secret, last4 }` **once**
- [x] `GET /keys` — list `{ id, keyId, last4, status, expiresAt, lastUsedAt, createdAt }`; never the secret
- [x] `POST /keys/:id/rotate` — create new active key; set old key `status: "expiring"`, `expiresAt: now + 24h`; return new secret once
- [x] `DELETE /keys/:id` — set `status: "revoked"` immediately
- [x] `GET /status` — `{ connected: Boolean(referralConnectedAt), connectedAt, lastEventAt, activeKeys }`
- [x] Limit: max 3 non-revoked keys per business
- [x] All routes scoped to `req.user._id` (a business can never see/modify another business's keys)

## Phase 3 — Webhook receiver

- [x] `services/conversions.js` with:
  - `verifyConversionSignature({ keyDoc, header, rawBody })` — parse `t=…,v1=…`, reject if `|now - t| > 300s`, HMAC-SHA256 of `${t}.${rawBody}`, compare with `crypto.timingSafeEqual` (guard length mismatch)
  - `recordConversion({ businessId, payload })` — the steps below
- [x] `routes/webhooks.js` — `router.post("/conversions", express.raw({ type: "application/json", limit: "16kb" }), …)`
  1. Read `X-EP-Key-Id`; load key; treat `revoked`, or `expiring` past `expiresAt`, as invalid → `401`
  2. Verify signature → `401` on failure
  3. Parse JSON + validate with zod (`event_id` 1–128 chars, `code` 1–64, `event` enum, `timestamp` ISO datetime, `test` optional boolean) → `400`
  4. Find `ReferralCode` by `{ businessId: key.businessId, code: code.toUpperCase() }` → `404`
  5. Load campaign; allow `live` | `paused` | `completed` (completed allowed for 7-day grace after `updatedAt`/`endDate`) → else `409`
  6. If `test: true`: set `BusinessProfile.referralConnectedAt` if unset, update key `lastUsedAt`, return `200 { status: "test_ok" }` — do not save or count
  7. Insert `ConversionEvent`; on Mongo error `11000` return `200 { status: "ignored" }`
  8. `$inc` `ReferralCode.conversions` and `Campaign.referral.conversions`; if code `awaiting_business` → `active`
  9. Set `referralConnectedAt` if unset; update key `lastUsedAt`
  10. `emitToUser(creatorId, "referral-conversion", {...})` and `emitToUser(businessId, "referral-conversion", {...})`
  11. Return `200 { status: "recorded" }`
- [x] Simple in-memory rate limiter per `keyId` (e.g. 50 req/s, `429` over limit) — `utils/rateLimit.js`
- [x] `Backend/scripts/sendTestConversion.js` — CLI: `node scripts/sendTestConversion.js --url … --key-id … --secret … --code … [--event signup] [--test]`; signs and sends, prints response
- [x] Verify manually with the script: valid, bad signature, stale timestamp, duplicate `event_id`, unknown code, other business's code, test event

## Phase 4 — Codes

- [x] `utils/referralCodes.js`
  - `buildDisplayCode(brandName, creatorHandle)` → `ACME-TUNDE` (uppercase, A–Z0–9 only, each part ≤ 12 chars)
  - `createReferralCode({ slot, campaign, creatorId })` — insert; on `11000` append `-` + 3 random chars and retry (max 5 tries)
  - `backfillReferralCodes(campaign)` — create codes for claimed slots that don't have one
- [x] `routes/slots.js` claim — after `slot.save()`, if `campaign.referral.enabled && campaign.referral.codeSource === "easilypromote"` create the code; include `referralCode` in the response. Code creation failure must **not** fail the claim (log it; backfill can repair).
  - Status: `awaiting_business` until the business marks codes loaded or the first conversion arrives
- [x] Campaign create/update (`routes/campaigns.js`) — accept `referral.enabled`, `referral.eventType`, `referral.codeSource`; when enabled on a live campaign, run `backfillReferralCodes`
- [x] Business code routes (owner of campaign only):
  - [x] `GET /api/campaigns/:id/referral-codes` — rows: creator name/handle, code, source, status, conversions, loadedAt
  - [x] `GET /api/campaigns/:id/referral-codes.csv` — `creator_handle,code,status`
  - [x] `POST /api/campaigns/:id/referral-codes/mark-loaded` — body `{ codeIds?: [] }` (all if omitted) → `active`, `loadedAt`
  - [x] `PUT /api/campaigns/:id/referral-codes/:slotId` — business-made code `{ code }`; validate format and uniqueness within business; `source: "business"`, `status: "active"`
  - [x] `POST /api/campaigns/:id/referral-codes/import` — CSV/JSON `[{ creator_handle, code }]`; return per-row results
- [x] Creator payload — `services/creatorDashboard.js` (and the creator campaign detail endpoint): include `referral: { code, status, conversions }` when present; creators see `awaiting_business` as "Code being activated by the brand"

## Phase 5 — Frontend (`Fontend/apps/web`)

- [x] API client functions in `apps/web/src/lib/api.ts` for all Phase 2 and Phase 4 endpoints
- [x] Business: **Referral tracking settings** page — `dashboard/brand/settings/referral/page.tsx` + nav link
  - Connection badge (Connected / Not connected) + last event time
  - Keys list with last4, status, last used; Generate / Rotate / Revoke (revoke has a confirm)
  - "Copy your secret now — you won't see it again" dialog, requires confirm checkbox before closing
  - Integration guide: webhook URL, headers, body, response table, copyable signing snippets (Node, PHP, Python) and a test `curl`/script command
- [x] Business: `create-campaign/page.tsx` — "Track signups with referral codes" toggle, event type select, code source radio (Easily Promote codes / Our own codes)
- [x] Business: `campaign-details.tsx` — **Referrals** section
  - Summary: total conversions, codes active vs awaiting
  - Table: creator, code, status chip, conversions
  - Actions: Export CSV, Mark all as loaded, per-row "Set code" when source is business, Import codes
  - Live updates on `referral-conversion` socket event
- [x] Creator: "Your referral code" card on creator campaign page + `campaign-details-drawer.tsx` — code, copy button, status, live conversions count
- [x] Empty/error states and phone-width layout checked for every new UI

## Phase 5b — Developer docs and self-serve testing

- [x] Backend: `models/WebhookDelivery.js` — per-request log (status, result, error, event_id, code, event type, source), no PII, 30-day TTL
- [x] Backend: every webhook outcome is logged once the key identifies the business (unknown keys and rate-limited requests are not logged)
- [x] Backend: `POST /api/referral/test-event` — signs a test event with the brand's newest active key and runs it through the real handler; optional `code` is checked (found, status, campaign accepting)
- [x] Backend: `GET /api/referral/events?limit=` — newest first, max 100, business-scoped
- [x] App: settings page "Send a test event" (optional code), result message + request/response viewer, "Recent requests" log, link to public docs
- [x] Website (`Easilypromote-website`, branch `docs/referral-webhooks`): public `/developers` page — how it works, quickstart, signing + test vector, request fields, responses, retries, Node/Python/PHP/cURL examples, testing, FAQ; prerendered; footer link

## Phase 5c — Live code validation (no manual code loading)

Problem: brands had to load Easily Promote codes into their own systems (CSV + "mark active") every time creators joined, and creators waited on "Activating".

- [x] Backend: `POST /api/webhooks/codes/validate` — signed like a conversion; body `{ "code": "..." }`; answers `200 { valid: true, code, campaign_id, event }` or `200 { valid: false, code, reason }` with `reason` in `not_found | disabled | campaign_not_accepting`; 400/401/429 as for conversions; records nothing
- [x] Backend: shared `authenticateSignedRequest` + `evaluateCode` so code checks, test events and conversions can never disagree
- [x] Backend: codes generated on claim are `active` immediately; legacy `awaiting_business` codes activate on their first signed check or conversion
- [x] Backend: code checks logged in the request log (`source: code_check`, results `valid | invalid | rejected` with readable reasons)
- [x] Backend: `POST /api/referral/test-event` accepts `type: "validate"`; `/api/referral/status` returns `validateUrl`
- [x] App: settings page "Try a request" switch (Check a code / Test conversion), code-check example in the guide, new log labels; Referrals tab no longer asks brands to load codes
- [x] Website: `/developers` "Checking a code" section (request, responses, reasons, fail-open guidance), flow + quickstart rewritten, examples switch between Check a code / Report a conversion in all four languages, two new FAQs

## Phase 5d — Admin referral console and activity log

- [x] Backend: `models/AdminActivity.js` + `services/adminActivity.js` — append-only record of admin actions (actor, role, action, target, brand, note, from/to metadata); logging never blocks the action
- [x] Backend: existing admin actions now logged — campaign status changes, user activate/deactivate, withdrawal approve/reject
- [x] Backend: `routes/adminReferrals.js` at `/api/admin/referrals` — `stats`, `flags`, `brands`, `brands/:id`, `campaigns`, `campaigns/:id/codes`, `conversions`, `conversions.csv`, `PATCH codes/:id/status`, `POST keys/:id/revoke`
- [x] Backend: `routes/adminActivity.js` at `/api/admin/activity` — filter by target type, action, admin, brand, target, date; search admin/target/note
- [x] Flags: campaigns with views but no conversions (tracking on 3+ days), brands with ≥10 requests in 7 days and ≥50% rejected (dashboard tests excluded), active keys unused for 30+ days
- [x] Access: all admin roles can view; only `admin` and `super_admin` can disable/enable codes or revoke keys; every action needs a note, notifies the brand and is logged
- [x] Admin app: sidebar items; `/referrals` (Overview & flags, Brands, Campaigns, Conversions with CSV export; brand panel with keys/campaigns/recent requests; codes panel; note dialog); `/activity` log page

## Phase 6 — Payouts ⛔ BLOCKED (needs product decision)

Do **not** start until the payout rules below are decided.

- [ ] Decide: amount per conversion; paid from campaign escrow or business `walletBalance`; cap per creator
- [ ] Unify the three inconsistent earnings formulas into `utils/earnings.js`:
  - `routes/creators.js` ~line 349 (`min(views * costPerView, slot.reward)`)
  - `services/creatorDashboard.js` ~line 395 (`views * costPerView`)
  - `routes/submissions.js` ~line 457 (share of `creatorPool` by views)
- [ ] Add `referral.payoutPerConversion` to Campaign; include conversion earnings in withdrawals and creator dashboard

## Phase 7 — Later (not in this build)

- [ ] Push codes to the business's API automatically (business stores its endpoint + key with us; retries + delivery log)
- [ ] Tracked short link per creator (`ep.link/K7QX2M`) with click counts
- [ ] Aggregate endpoint for daily counts per code (upsert, not additive) for less technical businesses
- [ ] Admin fraud view: codes with high clicks and zero/low conversions

---

## PR breakdown

1. Phases 1–3 — models, key API, webhook receiver, test script
2. Phase 4 — code generation, backfill, business code routes, creator payload
3. Phase 5 — business settings page + campaign referrals section + create-campaign toggle
4. Phase 5 — creator code card
5. Phase 6 — payouts (after decision)

## Working rules for the AI implementing this

- Work on branch `feature/referral-tracking`.
- Do phases in order. **Do not stop between phases** — when one is done, tick its boxes here and start the next.
- After each phase: make sure the backend starts cleanly, exercise what you built, commit with a clear message.
- Match existing code style (route-handler logic, `next(error)`, existing naming).
- Small decisions: choose the sensible option and record it under **Decisions made** below.
- Stop only if truly blocked: missing credentials, a change that could break production data, or a product decision only the owner can make. Skip Phase 6 and 7.
- Finish with one summary: what was built, decisions made, anything the owner must do (env vars, deploy steps).

## Decisions made

- 2026-09-14 — Lightweight webhook model chosen over embedding an SDK in business apps.
- 2026-09-14 — Creators never interact with the business platform; codes flow Easily Promote ↔ business only.
- 2026-09-14 — Single webhook URL; business identified by `X-EP-Key-Id`; signature includes timestamp (±5 min) to block replays.
- 2026-09-14 — Secrets stored encrypted (not hashed) because HMAC verification needs the plaintext.
- 2026-09-14 — One event per conversion with `event_id` idempotency, rather than running totals.
- 2026-09-14 — Test events (`test: true`) skip the code lookup, so a brand can connect before its first campaign has codes.
- 2026-09-14 — Every event type is stored, but only the campaign's chosen `referral.eventType` increments the conversion counters.
- 2026-09-14 — Webhook route accepts any Content-Type as raw bytes, so a missing header can't break signature checks. Body limit 16kb.
- 2026-09-14 — Webhook URL shown to brands comes from `API_PUBLIC_URL` env var, falling back to the request host.
- 2026-09-14 — Completed campaigns accept conversions for 7 days after `endDate` (or `updatedAt` when no end date).
- 2026-09-14 — Phase 3 verified against a throwaway local MongoDB (not the `.env` database): 33 end-to-end checks passed.
- 2026-09-14 — Generated codes are `BRAND-USERNAME` from `BusinessProfile.companyName` and `CreatorProfile.username` (12 chars max each, A–Z0–9); on collision a 3-char suffix is added (`ACMEINC-TUNDE-K7Q`).
- 2026-09-14 — Business code routes live in `routes/referralCodes.js`, mounted at `/api/campaigns` before the main campaign router, with auth per route so `/pricing` stays public.
- 2026-09-14 — Referral settings on live campaigns change via `PATCH /api/campaigns/:id/referral` (the existing `PATCH /:id` only allows drafts). Switching to Easily Promote codes on a live/paused/completed campaign backfills missing codes.
- 2026-09-14 — Business-supplied codes are marked `active` immediately (the business created them in its own system). CSV import matches rows by creator username.
- 2026-09-14 — Creator dashboard `referral` block is `null` when tracking is off; `status: "awaiting_code"` with `code: null` when the brand supplies codes and hasn't set one yet.
- 2026-09-14 — Phase 4 verified end to end on local MongoDB: 27 checks passed, Phase 3 suite re-run clean.
- 2026-09-14 — Frontend referral API client lives in its own `apps/web/src/lib/referral.ts` (built on `apiRequest`) rather than growing `api.ts`; CSV export uses a direct `fetch` because `apiRequest` always parses JSON.
- 2026-09-14 — The settings page is linked from each campaign's Referrals tab, not the shared `@ep/ui` NavBar, to avoid changing the navigation of the other apps.
- 2026-09-14 — The create-campaign toggle lives in the wizard's Brief step (`campaign-wizard.tsx`, since `create-campaign/page.tsx` only hosts the wizard) and shows on the Review step. `ReferralSettingsFields` is shared with the campaign Referrals tab.
- 2026-09-14 — Live counts apply the change in a code's absolute `conversions` rather than +1 per socket event, because the backend's `emitToUser` currently delivers each event twice (room + socket id). Follow-up task raised for the backend duplicate.
- 2026-09-14 — Developer docs are public on the landing site (`/developers`) so a brand can send the link to engineers without accounts; keys, the test sender and the request log stay in the app because they need authentication. No public "paste your secret" tool — the docs ship a fixed test vector instead.
- 2026-09-14 — The docs test vector is checked against `signPayload` in the backend test suite; regenerate it if signing ever changes.
- 2026-09-14 — Test events now report whether the sent code would match (`code.found`, `status`, `campaignAcceptingConversions`) but still return 200 and record nothing.
- 2026-09-14 — Admin referral data is visible to every admin role (matching existing admin pages); disabling codes and revoking keys is limited to `admin`/`super_admin` because both break a brand's live integration.
- 2026-09-14 — The activity log records the new referral actions plus the existing campaign status, user status and withdrawal review actions, so it is useful from day one. It has no TTL — it is the audit trail.
- 2026-09-14 — Admin search input is escaped before being used as a regex (existing admin list routes use raw input; not changed here).
- 2026-09-14 — Live validation (Option A) chosen over pulling code lists (B) or pushing codes to brands (C): one extra signed call, nothing to sync. CSV export stays for brands whose systems must pre-store codes.
- 2026-09-14 — Code checks use POST with a signed JSON body rather than GET, so they reuse the exact conversion signing code and the signature covers the code being checked.
- 2026-09-14 — An invalid code is a normal answer (`200 { valid: false }`), not an HTTP error, so brands only treat 4xx/5xx as integration problems. Docs tell brands to fail open on errors/timeouts; the conversion webhook still rejects codes that were never valid.
- 2026-09-14 — Phase 5c verified: 22 new backend checks pass; Phase 3, 4 and 5b suites re-run clean; web typecheck clean; website build prerenders `/developers`.
- 2026-09-14 — Phase 5b verified: 17 new backend checks pass, Phase 3/4 suites re-run clean, web typecheck clean, website `npm run build` prerenders `/developers`, and the app test sender + request log were exercised in the browser.
- 2026-09-14 — Phase 5 verified in the browser against the local API + throwaway DB: web typecheck clean; settings page (connect status, generate key + one-time secret modal, rotate/revoke controls, max-3 limit), campaign Referrals tab (totals, codes, mark all active, live conversion over socket), wizard toggle round-trip, and phone width (no horizontal overflow).
