# Referral Tracking — Implementation Plan

Status: **in progress** · Branch: `feature/referral-tracking` · Last updated: 2026-09-14

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

- [ ] `routes/referral.js`, mounted in `app.js` at `/api/referral` (after `express.json`); all routes `protect, authorizeRoles("business")`
- [ ] `POST /keys` — generate `keyId` + secret (`whsec_` + 32 random bytes base64url), store encrypted, return `{ keyId, secret, last4 }` **once**
- [ ] `GET /keys` — list `{ id, keyId, last4, status, expiresAt, lastUsedAt, createdAt }`; never the secret
- [ ] `POST /keys/:id/rotate` — create new active key; set old key `status: "expiring"`, `expiresAt: now + 24h`; return new secret once
- [ ] `DELETE /keys/:id` — set `status: "revoked"` immediately
- [ ] `GET /status` — `{ connected: Boolean(referralConnectedAt), connectedAt, lastEventAt, activeKeys }`
- [ ] Limit: max 3 non-revoked keys per business
- [ ] All routes scoped to `req.user._id` (a business can never see/modify another business's keys)

## Phase 3 — Webhook receiver

- [ ] `services/conversions.js` with:
  - `verifyConversionSignature({ keyDoc, header, rawBody })` — parse `t=…,v1=…`, reject if `|now - t| > 300s`, HMAC-SHA256 of `${t}.${rawBody}`, compare with `crypto.timingSafeEqual` (guard length mismatch)
  - `recordConversion({ businessId, payload })` — the steps below
- [ ] `routes/webhooks.js` — `router.post("/conversions", express.raw({ type: "application/json", limit: "16kb" }), …)`
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
- [ ] Simple in-memory rate limiter per `keyId` (e.g. 50 req/s, `429` over limit) — `utils/rateLimit.js`
- [ ] `Backend/scripts/sendTestConversion.js` — CLI: `node scripts/sendTestConversion.js --url … --key-id … --secret … --code … [--event signup] [--test]`; signs and sends, prints response
- [ ] Verify manually with the script: valid, bad signature, stale timestamp, duplicate `event_id`, unknown code, other business's code, test event

## Phase 4 — Codes

- [ ] `utils/referralCodes.js`
  - `buildDisplayCode(brandName, creatorHandle)` → `ACME-TUNDE` (uppercase, A–Z0–9 only, each part ≤ 12 chars)
  - `createReferralCode({ slot, campaign, creatorId })` — insert; on `11000` append `-` + 3 random chars and retry (max 5 tries)
  - `backfillReferralCodes(campaign)` — create codes for claimed slots that don't have one
- [ ] `routes/slots.js` claim — after `slot.save()`, if `campaign.referral.enabled && campaign.referral.codeSource === "easilypromote"` create the code; include `referralCode` in the response. Code creation failure must **not** fail the claim (log it; backfill can repair).
  - Status: `awaiting_business` until the business marks codes loaded or the first conversion arrives
- [ ] Campaign create/update (`routes/campaigns.js`) — accept `referral.enabled`, `referral.eventType`, `referral.codeSource`; when enabled on a live campaign, run `backfillReferralCodes`
- [ ] Business code routes (owner of campaign only):
  - [ ] `GET /api/campaigns/:id/referral-codes` — rows: creator name/handle, code, source, status, conversions, loadedAt
  - [ ] `GET /api/campaigns/:id/referral-codes.csv` — `creator_handle,code,status`
  - [ ] `POST /api/campaigns/:id/referral-codes/mark-loaded` — body `{ codeIds?: [] }` (all if omitted) → `active`, `loadedAt`
  - [ ] `PUT /api/campaigns/:id/referral-codes/:slotId` — business-made code `{ code }`; validate format and uniqueness within business; `source: "business"`, `status: "active"`
  - [ ] `POST /api/campaigns/:id/referral-codes/import` — CSV/JSON `[{ creator_handle, code }]`; return per-row results
- [ ] Creator payload — `services/creatorDashboard.js` (and the creator campaign detail endpoint): include `referral: { code, status, conversions }` when present; creators see `awaiting_business` as "Code being activated by the brand"

## Phase 5 — Frontend (`Fontend/apps/web`)

- [ ] API client functions in `apps/web/src/lib/api.ts` for all Phase 2 and Phase 4 endpoints
- [ ] Business: **Referral tracking settings** page — `dashboard/brand/settings/referral/page.tsx` + nav link
  - Connection badge (Connected / Not connected) + last event time
  - Keys list with last4, status, last used; Generate / Rotate / Revoke (revoke has a confirm)
  - "Copy your secret now — you won't see it again" dialog, requires confirm checkbox before closing
  - Integration guide: webhook URL, headers, body, response table, copyable signing snippets (Node, PHP, Python) and a test `curl`/script command
- [ ] Business: `create-campaign/page.tsx` — "Track signups with referral codes" toggle, event type select, code source radio (Easily Promote codes / Our own codes)
- [ ] Business: `campaign-details.tsx` — **Referrals** section
  - Summary: total conversions, codes active vs awaiting
  - Table: creator, code, status chip, conversions
  - Actions: Export CSV, Mark all as loaded, per-row "Set code" when source is business, Import codes
  - Live updates on `referral-conversion` socket event
- [ ] Creator: "Your referral code" card on creator campaign page + `campaign-details-drawer.tsx` — code, copy button, status, live conversions count
- [ ] Empty/error states and phone-width layout checked for every new UI

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
