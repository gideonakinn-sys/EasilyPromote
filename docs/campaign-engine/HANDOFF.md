# Campaign Engine — Handoff: what's left and exactly how to finish it

Written 17 Sep 2026 when work paused at the usage budget. This is the single source of truth for the next engineer or AI agent. Read all of it before changing anything. Every section is written so it can be followed literally.

---

## 0. Situation in one screen

| Item | State |
|---|---|
| Production (`origin/main`) | `8de15f5` — campaign engine M0–M7 (tickets 00–09). **Deployed.** Migration applied to production (5 campaigns). |
| Local `main` | `f34227e` — **36 commits ahead of `origin/main`, NOT pushed.** Contains M7b (tickets 10, 11) and part of M8. Working tree clean. |
| Tests at `f34227e` | `cd Backend && npm test` → 98 unit + 216 end-to-end, 0 failures. Web/admin typecheck last verified clean at `151a58c` (no frontend files changed after that). |
| Deploy review of the 36 commits | **Only partly done.** No blockers found in what was read (see §4). Must be finished before pushing. |
| Pushing | **Pushing `main` auto-deploys production** (Render API + web + admin hosts all auto-deploy from GitHub `main`). Treat `git push` as a production deploy. |

### What's in the 36 unpushed commits (all tested)

**M7b / ticket 10 — Hybrid pay** (`9e3cae2`, `d18f1b0`, `a940531`, `4fa48a7`, `8ea466c`, `c3e5874`, `610f0f7`)
- Content campaigns can pay base per deliverable + a bonus pool (views bonus at price-table first tier less fee, per 1,000 verified views; or sign-up/download bonus at admin-set reward), per-creator cap. Fee 30% on top of base and on top of pool. Bonus pot `bonus`, ledger rows `bonus_credit`, atomic conditional reservation. Wallet shows base and bonus separately. Admin refund of unused bonus `POST /api/admin/campaigns/:id/refund-unused-bonus`. SPEC rows D2/D4/D5 (hybrid).

**M7b / ticket 11 — money follow-ups** (`da9ae9c`, `810adbb`, `99c44dc`, `b293ccd`, `74834a5`, `3e498cb`, `e9f90da`, `9880cb0`, `256936c`)
- Automatic unused-budget refunds (`Backend/src/services/autoRefunds.js`), hourly, **OFF unless `AUTO_REFUNDS_ENABLED=true`** (`Backend/src/utils/autoRefundSwitch.js`).
- Refund retries with a 5-minute send lock + Paystack existing-refund adoption (`Backend/src/utils/refunds.js`); admin **Refunds** page; `POST /api/admin/refunds/:refundId/retry`.
- Brand payment statement `GET /api/payouts/statement` (+ CSV) (`Backend/src/services/brandStatement.js`), web Statement page and campaign Payouts card.
- Payout appeals + one admin appeals inbox (`Backend/src/services/payoutAppeals.js`, `appealsInbox.js`, admin `/appeals`). Grant = finance_admin/super_admin only.
- Hybrid sign-up-bonus void is crash-safe (ops job finishes interrupted give-backs).

**M7b / ticket 11 — marketplace, wizard, admin** (`3de36ed`, `0ae8188`, `4767feb`, `ae01f39`, `a5ebdc7`)
- Trending section (v1, later replaced by v2 below), live "about N creators match" count `POST /api/campaigns/match-count` (`services/creatorMatchCount.js`), admin per-view **Price Table** screen (`routes/adminPricing.js`, `models/PriceTable.js`, admin `/pricing`), **Leads** (`lead` webhook event) and **Sales** (`purchase`) objectives opened. Engagement and Other stay "Coming soon" (reasons in SPEC).

**M7b / ticket 11 — dropped + load test** (`fecbe57`, `2322e81`, `3e1bb1a`, `8b766ca`, `2edbe75`, `2b5e019`)
- 500 MB brand-page file upload **dropped** (storage is Cloudinary, 100 MB max). Delivery stays a download link. Do not re-add S3 upload work.
- Load test `npm run load-test` (`Backend/scripts/loadTest/index.js`, refuses non-local targets). Fixed: placement limit race (3 active placements), marketplace projection/cache, JWT HMAC key built once. Results `docs/campaign-engine/LOAD_TEST.md`.

**M8 — ratings and badges** (`6033c4a`, `91d977f`, `8233b6b`, `e162c19`, `151a58c`)
- Post-campaign brand ratings (SPEC D24, `services/creatorRatings.js`, collection `creatorratings`), automated badges with minimum samples + hysteresis + admin overrides (D25, `services/badgeRules.js`, `services/creatorBadges.js`, admin `creator-badges-dialog.tsx`). Pre-existing badges kept as grant overrides "kept from before automatic badges".

**M8 — Recommended v2, Trending v2, marketplace sections API** (`31607c5`, `5d77c56`, `e42e79e`, `f34227e`)
- Backend only. SPEC D26 (Recommended v2), D27 (Trending v2 by fill speed), D28 (sections + cursor paging). New files `Backend/src/services/marketplace.js`, `creatorHistory.js`; changed `recommendations.js`, `trending.js`, `creatorDashboard.js`. Endpoints `GET /api/creators/marketplace/sections?tab=all|fixed|performance|hybrid&limit=12` and `GET /api/creators/marketplace/sections/:section?cursor=`. Old `GET /api/creators/marketplace` and dashboard whole-list still work (backward compatible). `GET /api/creators/dashboard?marketplace=none` omits the list. New index `campaigns {status:1, updatedAt:-1}`.
- Note: commit `31607c5` alone doesn't run (its caller fix is in `5d77c56`). Never cherry-pick one without the other.

---

## 1. Ground rules (break none of these)

1. **Never connect to the production database, and never use production keys.** `Backend/.env` and `Fontend/apps/web/.env.local` point at PRODUCTION. Don't read, print, copy or run anything with them loaded. The only exceptions are the explicit production steps in §5, run by the human owner.
2. **`dotenv` trap:** `Backend/src/server.js` calls `dotenv`, which loads `Backend/.env` when the process's working directory is `Backend/`. Even if you set `MONGODB_URI` yourself, production Paystack and Brevo keys get loaded. For any local API run, start the server **from a directory with no `.env`** (e.g. a temp folder): `node C:\Users\user\Documents\EasilyPromote\Backend\src\server.js` with cwd = temp dir, and set every needed variable yourself.
3. **Never `git push` without the owner's explicit go.** Push = production deploy.
4. **UI confirmations must be styled in-app modals, never `alert()` or `window.confirm()`.** Existing components to reuse: admin `Fontend/apps/admin/src/components/*-dialog.tsx` (e.g. `delete-user-dialog.tsx`, `complete-campaign-dialog.tsx`), web `Fontend/apps/web/src/components/confirm-delete-modal.tsx`, `content-action-modal.tsx`.
5. **Frontend lives only in `Fontend/apps/web` (brand + creator) and `Fontend/apps/admin`.** `Fontend/apps/brand` and `Fontend/apps/creator` are stale copies — never edit them. (`AGENTS.md` still describes them as live; it's out of date.)
6. **Money roles:** anything that moves money (refunds, voids, paying withdrawals, the payout run, granting a payout appeal, cancelling a paid campaign) must use `moneyGuard` / finance_admin or super_admin only (SPEC D19).
7. **Campaign v2 fields are additive (ADR 0001).** Never rename or remove `objective` or other fields live campaigns and the currently deployed clients read.
8. **Rate authority (ADR 0003):** brands set only content rates (and hybrid base). Views price comes from the price table; referral/lead/sale/bonus rewards are admin-set. Refuse brand-sent rates with code `RATE_NOT_BRAND_SET`.
9. **Creator Approval and Content Approval are separate (ADR 0002).** Neither decides the other.
10. **Backward compatibility for deploys:** API, web and admin auto-deploy at the same time and can go live in any order. New API must keep serving the currently deployed web/admin; new web must degrade if it briefly hits the old API (show a friendly error, not a crash).
11. **Commit style:** small focused conventional commits (`feat(scope): …`, `fix(scope): …`, `docs(scope): …`), each ending with `Co-Authored-By: <your agent identity>` if your tooling uses attribution. Work directly on `main` (owner's instruction). No history rewriting of pushed commits.
12. **Record every product decision** as a new row in `docs/campaign-engine/SPEC.md`'s decision table (next free number is **D29**; amendments use the existing number with a label, e.g. "D8 (amended, M8)").
13. **Match surrounding code:** CommonJS + Express + Mongoose in `Backend`, Zod validation, manual `useState` forms in Next.js 15 / React 19, Tailwind, HugeIcons. Read `CONTEXT.md` for vocabulary (Placement not "slot" in UI copy, Brief, Deliverable, Creator Pool, Hold, Withdrawal, Refund…).
14. **Windows machine.** Git Bash heredocs containing apostrophes break — write files with an editor/Write tool instead. If you create git worktrees and link `node_modules` with junctions, remove junctions **non-recursively** (`[System.IO.Directory]::Delete("<path>", $false)` in PowerShell) — `rm -rf`/`Remove-Item -Recurse` on a junction deletes the real `node_modules`.

---

## 2. Required reading (in this order)

1. `CONTEXT.md` — glossary. Use these words.
2. `docs/adr/0001-*`, `0002-*`, `0003-*`.
3. `docs/campaign-engine/SPEC.md` — especially the decision table D1–D28 and all amendment rows.
4. `docs/campaign-engine/LAUNCH_ROADMAP.md` — § M7b and § M8 checklists.
5. `docs/campaign-engine/tickets/10-hybrid-pay.md`, `11-launch-follow-ups.md` (mirrored in `.scratch/campaign-engine/issues/`; keep both copies in sync when ticking).
6. `docs/campaign-engine/DEPLOY_CHECKLIST.md` — §6 index builds, §10 rollback, §11–§14 per-feature deploy notes.
7. `docs/campaign-engine/ADMIN_RUNBOOK.md` — §0, §1, §2a, §5, §9a–§9c.
8. `docs/campaign-engine/LOAD_TEST.md`.
9. `AGENTS.md` (mind the stale parts noted in §1.5).

---

## 3. How to run things safely

### Backend tests (always green before any commit that touches Backend)
```bash
cd Backend
npm test            # unit then e2e
npm run test:unit   # no database
npm run test:e2e    # throwaway mongod, Paystack stubbed, never reads Backend/.env
```
- Needs local MongoDB server. The harness looks in `C:\Program Files\MongoDB\Server\<version>\bin\mongod.exe`, else `mongod` on PATH, or `MONGOD_PATH`.
- Harness: `Backend/test/e2e/harness.js` (`api`, `registerBrand`, `registerCreator`, `paystack.markPaid`). It clears outside-service env vars, including `AUTO_REFUNDS_ENABLED` (tests that need the job switch it on themselves).
- `views-campaign.test.js` is the regression guard for live views campaigns — keep it passing.
- e2e run with `--test-concurrency=1`; takes several minutes.

### Frontend typecheck (always clean before committing frontend work)
```bash
cd Fontend/apps/web && npx tsc --noEmit
cd Fontend/apps/admin && npx tsc --noEmit
```

### Local browser check (never production)
1. Start a throwaway mongod: `mongod --dbpath <new temp folder> --port 27099 --bind_ip 127.0.0.1`.
2. Start the API **from a temp folder** (see §1.2) with: `MONGODB_URI=mongodb://127.0.0.1:27099/ep_local`, `JWT_SECRET=local-jwt`, `JWT_REFRESH_SECRET=local-refresh`, `TOKEN_ENCRYPTION_KEY=local-enc-key`, `NODE_ENV=development`, `PORT=5000`, and **no** `PAYSTACK_SECRET_KEY`/`BREVO_API_KEY` (or stub Paystack in-process as the harness does). Don't set `AUTO_REFUNDS_ENABLED`.
3. Web: `cd Fontend/apps/web`, `NEXT_PUBLIC_API_URL=http://localhost:5000/api BACKEND_URL=http://localhost:5000 npx next dev --port 3010`. Admin: `cd Fontend/apps/admin`, `NEXT_PUBLIC_API_URL=http://localhost:5000/api npx next dev --port 3003`. (`.claude/launch.json` has `web-local-api` and `admin-local-api` with these; its `api-local-testdb` entry runs from `Backend/` and therefore loads `Backend/.env` — don't use it as is.)
4. Seed data through the local API (register brand/creator/admin, create + pay campaigns with the stub). Log in by fetching tokens from the local API and putting them in localStorage; don't type real passwords.
5. Stop every process and delete the temp database folder afterwards.

### Scripts that may touch a database
All scripts in `Backend/scripts` load `Backend/.env` → **production**. Only the owner runs them against production (§5). For local use, run from a temp dir with `MONGODB_URI` pointing at your throwaway mongod. `npm run load-test` is safe (starts its own mongod, refuses non-local URIs).

---

## 4. Step 1 — Finish the deploy review of the 36 unpushed commits (BLOCKS the push)

Range: `git diff 8de15f5..f34227e`. Read-only review; fix what you find with tests.

### Already reviewed — no blockers
- Hybrid bonus pool reservation, crediting, void give-back, unused-pool refund (`Backend/src/utils/hybridBonus.js`).
- Conversion voids refused after the 7-day hold (`Backend/src/utils/referralEarnings.js` ~line 290).
- Refund retries: send lock, Paystack adoption, legacy rows without `sentAt` (`Backend/src/utils/refunds.js`).
- Completed views refund holds back every placed creator's remaining reward (`refundCompletedViewsEscrow`, `Backend/src/utils/escrow.js`).
- Auto refunds do nothing unless `AUTO_REFUNDS_ENABLED === "true"`; bonus refund skipped while content can be appealed; referral refund skipped while rewards/back-pay pending.
- Payout bonus re-check at payout time (`Backend/src/services/withdrawalPayouts.js` ~134–166).
- Brand statement authz (brand only, 403 on another brand's campaign).
- Route guards: `refund-unused`, `refund-unused-bonus`, both refund retry routes, `void-undelivered` use `moneyGuard` (`Backend/src/routes/admin.js` ~368–536). Payout appeal resolve checks MONEY_ROLES for grant, claims atomically, reinstates a withdrawal only from `rejected` and only if no other pending/processing withdrawal exists (`Backend/src/services/payoutAppeals.js`).

### Findings resolved
1. **Auto refund ignores completed campaigns without `completedAt` (Fixed).** In `refundEndedCampaign` (`Backend/src/services/autoRefunds.js`) the views/referral 7-day wait now falls back to `updatedAt` when `completedAt` is unset. Verified with e2e test in `Backend/test/e2e/auto-refunds.test.js` and documented in `ADMIN_RUNBOOK.md` §5.
2. **Possible double bonus payout with two pending withdrawals on one campaign (Confirmed impossible by design).** Verified: `one_pending_withdrawal` and `one_processing_withdrawal` unique partial indexes prevent multiple pending/processing withdrawals per creator/campaign/kind. Payout claims atomically, and pre-transfer release rows (`status: "escrow_deposit"`) deduct committed releases from `bonusPayableNow`.

### Review completed — no blockers found
1. **Payout appeal grant paths** (`Backend/src/services/payoutAppeals.js`): Verified atomic claim, inFlight check, re-verification of available earnings across all pots, and `canStillEarn`/`openAppealsFilter` guarding against refunds during appeal window.
2. **First-boot effects on production data**: Verified badge migration logic converts pre-existing badges to grant overrides without notification spam (`gainedBetween` empty). Revision locking prevents race conditions. New indexes verified (only unique indexes are on new collections `creatorratings` and `payoutappeals`).
3. **Authz and data leaks on new routes**: Verified brand-only checks, rate limiting, and data masking on match count, creator ratings, admin price table, and marketplace sections.
4. **Load-test fixes**: Verified placement limit race fix in `placements.js` enforces pool ceiling and 3-placement cap on both open joins and brand approvals.
5. **Backward compatibility**: Verified legacy marketplace whole-list and response shapes remain intact.

Deliverable: review completed, findings fixed with e2e test; `npm test` and typechecks verified clean.

---

## 5. Step 2 — Push and production steps (owner performs; agent prepares)

Only after §4 is complete and green.

### Before the push (owner)
1. **Snapshot the production database.**
2. From `Backend/` (local `.env` = production): `node scripts/preDeployChecks.js`. Expected: MongoDB ≥ 4.4 OK, no unique index conflicts, reconciliation OK. Known non-issues: warning `OPS_ALERT_EMAIL isn't set`; warning `AUTO_REFUNDS_ENABLED` off. **Known blocker in the owner's local `.env`: `PAYSTACK_SECRET_KEY isn't a live key`** — this checks the laptop's `.env`, not Render. The owner must confirm on Render that the API's `PAYSTACK_SECRET_KEY` starts with `sk_live_` (open question from 17 Sep, never answered).
3. No migration script is needed for the 36 commits (confirm in §4.2; if the review adds one, run its dry run then `--apply` here).
4. **Do not set `AUTO_REFUNDS_ENABLED`** yet.

### Push
`git push origin main`. Auto-deploy starts on API, web and admin simultaneously.

### After deploy (owner, with agent guidance)
1. Check index builds in `mongosh`: `db.campaigns.getIndexes()` (expect `{status:1, updatedAt:-1}`), `db.creatorratings.getIndexes()` (unique), `db.payoutappeals.getIndexes()` (unique on subject), `db.submissionevents.getIndexes()` (`{type:1, createdAt:1}`), Trending indexes per DEPLOY_CHECKLIST §12, `db.currentOp({"command.createIndexes": {$exists: true}})` until empty.
2. API logs: `[AutoRefunds] Off — AUTO_REFUNDS_ENABLED isn't true` must appear.
3. Smoke tests in DEPLOY_CHECKLIST §8 plus: create a Hybrid content campaign in test mode only if Paystack is in test mode — otherwise just check the wizard shows Hybrid and quotes correctly without paying; creator wallet loads with base/bonus split; admin Refunds, Appeals, Price Table pages load; brand Statement page loads; marketplace shows Trending.
4. `node scripts/reconcileCampaigns.js` — compare with the pre-push baseline; no new failures.
5. Admin: review badges "kept from before automatic badges" (Users & Creators banner).
6. **Rollback rules:** once a Hybrid campaign is paid, a Leads campaign/`lead` conversion exists, or ratings/appeals exist, don't roll the API back past these commits — fix forward (DEPLOY_CHECKLIST §10–§14).

### Later, separate decision: switching on automatic refunds (finance)
Follow DEPLOY_CHECKLIST §11 exactly: reconciliation baseline, run the listing query of campaigns the first run would refund (all completed/cancelled in the last 90 days, including ones that ended before this release), confirm the Paystack balance covers them, get finance sign-off, then set `AUTO_REFUNDS_ENABLED=true` on the Render API service and restart. Watch `[AutoRefunds]` logs for an hour and admin **Refunds → Needs Attention**.

### Other open production items
- `OPS_ALERT_EMAIL` not set on Render (alerts only in admin Overview until it is).
- Public developer docs in the `Easilypromote-website` repo don't list the `lead` webhook event — update before announcing Leads campaigns to brands.

---

## 6. Step 3 — Finish M8 batch 6: creator marketplace UI on sections

Backend is done (D26–D28). What's missing:

### 6.1 Move the creator marketplace screen to the sections API
Files: `Fontend/apps/web/src/components/campaign-marketplace.tsx`, `Fontend/apps/web/src/components/creator-dashboard-context.tsx`, `Fontend/apps/web/src/app/(dashboard)/dashboard/creator/campaign/page.tsx`, API client/types in `Fontend/apps/web/src/lib/` (find with `grep -rn "marketplace" Fontend/apps/web/src/lib`).

Do:
1. Read `Backend/src/services/marketplace.js`, the route in `Backend/src/routes/creators.js`, and `Backend/test/e2e/marketplace-sections.test.js` for the exact response shape (`sections[]` with `key` recommended|trending|new, `items`, `total`, `nextCursor`; each item's "why" lines for Recommended).
2. Add typed client functions `getMarketplaceSections(tab, limit)` and `getMarketplaceSectionPage(section, tab, cursor, limit)`.
3. On tab change (All / Fixed Pay / Performance / Hybrid) fetch the first page of all three sections; keep the per-tab state (loaded items + cursors) in memory so switching back doesn't refetch or lose "Show more" progress; reset on pull-to-refresh / explicit refresh.
4. "Show more" button per section (not infinite scroll unless the existing design uses it), disabled while loading, hidden when `nextCursor` is null. De-duplicate by campaign id when appending.
5. Recommended cards show up to 2 "why" lines; Trending cards show the recent-creator count (never names).
6. Stop loading the whole list: call `GET /api/creators/dashboard?marketplace=none` wherever the dashboard currently pulls the marketplace list, **but** fall back to the old whole-list response if the sections endpoint returns 404 (web can deploy before the API).
7. Keep existing card design, access badges (Open Call / Application Required), economics-first copy (`₦15,000 / approved video`, `₦5,000 + bonus`, `₦X / lead`, `₦X / purchase`), eligibility messages and the join/apply flows unchanged.
8. Empty states per section; error state with retry (styled, no `alert()`).
9. Typecheck clean. Browser check against local stack with ≥ 30 live campaigns (to exercise paging) across all tabs, including Hybrid; confirm no duplicates across pages and tab state survives switching.

### 6.2 Re-run the load test and update `LOAD_TEST.md`
`cd Backend && npm run load-test` on an otherwise idle machine (close other heavy apps; the previous run was noisy). Record a clean final run: old whole-list vs sections first page vs next page at 2,080 live campaigns and 50 concurrent creators (p50/p95/p99, req/s, errors). Target p50 < 1 s for sections. Note the startup rank/badge recalculation overlaps the measured window — either wait for it to finish before measuring or document it.

### 6.3 Docs
- ADMIN_RUNBOOK: add a section on Recommended v2 / Trending v2 (what support tells a creator who asks "why am I seeing this / not seeing that"; the 5 s / 60 s staleness from D28).
- Tick LAUNCH_ROADMAP § M8 "Recommended v2 using past campaign results; Trending weighted by fill speed".
- DEPLOY_CHECKLIST §6 already notes the index; add a §15 for the web switch (deploy API first; web falls back to whole list if sections 404).

---

## 7. Step 4 — M8 batch 7 (not started; nothing written)

Do these as separate commits/features. Each needs unit + e2e tests, typecheck, browser check, SPEC rows, ADMIN_RUNBOOK and DEPLOY_CHECKLIST updates, LAUNCH_ROADMAP tick.

### 7.1 Replace every remaining `alert()` / `window.confirm()` (do this first — quick, owner rule)
Exact call sites found at `f34227e`:
- `Fontend/apps/web/src/components/campaign-referrals.tsx:275` — `window.confirm("Turn off referral tracking? …")` → styled confirm modal.
- `Fontend/apps/admin/src/app/campaigns/page.tsx:212, 216` — reason-required `alert` → inline field validation message.
- `Fontend/apps/admin/src/app/campaigns/page.tsx:230, 300, 343` — error `alert` → inline error / toast in the dialog.
- `Fontend/apps/admin/src/app/campaigns/page.tsx:290` — `window.confirm("Delete …")` → styled confirm dialog.
- `Fontend/apps/admin/src/app/industries/page.tsx:110` — `window.confirm("Delete industry …")` → styled confirm dialog.
- `Fontend/apps/admin/src/app/platforms/page.tsx:85` — `window.confirm("Delete platform …")` → styled confirm dialog.
- `Fontend/apps/admin/src/app/referrals/page.tsx:1200` — export error `alert` → inline error.
- `Fontend/apps/admin/src/app/users/page.tsx:116, 135` — status/rank error `alert` → inline error.
- `Fontend/apps/admin/src/app/verifications/page.tsx:69, 105` — reason-required `alert` → inline validation.
- `Fontend/apps/admin/src/app/verifications/page.tsx:97, 125` — error `alert` → inline error.
- `Fontend/apps/admin/src/app/withdrawals/page.tsx:90` — error `alert` → inline error.
Re-run `grep -rn "alert(\|confirm(" Fontend/apps/web/src Fontend/apps/admin/src` afterwards; must return nothing except unrelated identifiers. Consider a small shared `ConfirmDialog` in admin if none fits; match existing dialog styling (see `delete-user-dialog.tsx`).

### 7.2 Clicks objective via tracked links
Recommended design (from reading the referral code): run a clicks campaign **on the existing referral budget machinery** so money handling is reused.
- **Objective:** add `clicks` to `Backend/src/utils/campaignObjectives.js` as a performance objective with admin-set reward (rate authority "admin"), available: true. Brand provides a destination URL (http/https only, validated with `new URL`, max length, no `javascript:`/data URLs); it can't change after anyone joined.
- **Link:** per placement, reuse the creator's referral code for the campaign (`Backend/src/utils/referralCodes.js`); public redirect route e.g. `GET /r/:code` (mounted outside `/api`, no auth) → 302 to the campaign's stored destination only (never a URL from the query string — no open redirect). Unknown/ended code → friendly 404 page or brand homepage per decision.
- **Counting a valid click:** record internally as a `ConversionEvent` of new internal type `click` (not accepted from the external webhook). Filters: drop known bot/crawler user agents (maintain a list; include link-preview fetchers like WhatsApp, facebookexternalhit, Twitterbot, Slackbot, TelegramBot), drop HEAD requests, dedupe per (code, hashed IP + user-agent) within 24 h, per-IP rate limit. Store only a salted hash of the IP (salt from `TOKEN_ENCRYPTION_KEY`-derived key), with a TTL index (e.g. 30 days).
- **Paying:** each valid click reserves the admin reward from `referral.poolRemaining` exactly like a paid conversion (`Backend/src/services/conversions.js`): atomic reservation, 7-day hold, back-pay oldest first when topped up (D20), refunds (D5 amended, automatic refunds behind the switch), reconciliation and brand statement include clicks automatically if they're conversion rows — verify in `Backend/src/services/campaignReconciliation.js` and `brandStatement.js`.
- **Exception:** sign-up campaigns require the brand's app to be connected (webhook key) before paying ("connect-before-pay"); clicks campaigns must NOT require that. Find that gate in `conversions.js`/campaign setup and skip it for clicks.
- **UI:** wizard objective card "Clicks" with destination URL field and copy explaining admin-set reward; marketplace card `₦X / click`; creator campaign page shows the tracked link with Copy button; brand campaign page shows valid clicks and spend; admin sets reward in the existing referral reward screen.
- **Tests:** redirect safety (can't redirect elsewhere), bot UA not counted, dedupe window, rate limit, reward reservation and pool exhaustion, hold, refund, reconciliation balances, statement includes clicks, no connect-before-pay requirement.
- **SPEC:** D29 (Clicks objective) with all the rules above.

### 7.3 Age / gender as opt-in hard filters (D8 amendment)
- Campaign field e.g. `audienceTargeting.requireAgeMatch` / `requireGenderMatch` (booleans, default false) plus a minimum share (e.g. `minAgeShare`, `minGenderShare`, 0–100, default 50). Additive field (ADR 0001); existing campaigns unchanged.
- Eligibility (`Backend/src/services/eligibility.js`): when required, block if the creator's self-reported share for the targeted ranges/genders is below the minimum, with messages in the existing style, e.g. "Needs at least 50% of your audience aged 25-34 (you have 20%)" and "Add your audience age breakdown to join" when data is missing. Interests stay ranking-only (D8 amended).
- Wizard: toggles under targeting with a visible warning that audience data is self-reported; the live match count (`services/creatorMatchCount.js`) must respect the filters (it uses the same eligibility service — confirm).
- Applications and joins respect it; applicant snapshot shows the relevant shares.
- Tests: unit tests in `Backend/test/unit/eligibility.test.js` for each case (required vs not, missing data, threshold edge), e2e join refused/allowed, match count changes.

### 7.4 Custom usage-rights terms per campaign
- Only for destination brand_page or both. Brand chooses Standard licence (D6: perpetual, non-exclusive, organic and paid social) or Custom: duration (months or perpetual), exclusivity (none / category exclusivity with period), paid ads allowed (yes/no), territories (list or worldwide), additional terms free text ≤ 1,000 chars.
- Store as a versioned object on the campaign (`usageRights: { type, terms, version }`). **Decision to record:** terms can't change once any creator has joined or applied (recommended — simplest and fair); if the owner wants edits, require re-acceptance and let creators withdraw without penalty.
- Creators see terms on the campaign detail before joining/applying and must tick "I accept these usage terms"; store `usageRightsAccepted: { version, acceptedAt }` on the placement (Slot) and on the application (snapshot). Join/apply API refuses without acceptance of the current version (code e.g. `USAGE_TERMS_NOT_ACCEPTED`).
- Show accepted terms on the submission/delivery screens (creator and brand) and in admin campaign/submission views.
- Tests: validation, acceptance required, version mismatch refused, terms locked after first join/apply, display data present.
- SPEC: D30.

### 7.5 Not doable without outside access (leave for later, document only)
- **Audience demographics — Instagram: APPROVED, buildable now (confirmed 17 Sep).** Meta App Review (submitted 12 Sep 2026) approved `instagram_business_basic` and `instagram_business_manage_insights` (Advanced Access) for app 1372054961141544; the app is Published. Build it:
  - Call `GET https://graph.instagram.com/<META_GRAPH_VERSION>/<ig-user-id>/insights?metric=follower_demographics&period=lifetime&timeframe=last_90_days&metric_type=total_value&breakdown=<city|country|age|gender>` once per breakdown with the creator's stored Instagram Login token (see `Backend/src/services/meta.js`, `graph.instagram.com`).
  - Only Business/Creator accounts with ≥ 100 followers return data; only the top 45 values are returned and shares are of followers with known demographics — normalise to percentages and store the covered share. Handle errors (personal account, < 100 followers, expired token) by keeping self-reported data and showing why.
  - Store on the creator profile audience as `source: "api"`, `provider: "instagram"`, `syncedAt`; map to the existing `audience.locations` (city and country names), `audience.ages` (map Meta's age buckets to `AGE_RANGES` in `Backend/src/utils/creatorProfile.js`), `audience.genders` (F/M/U → female/male/other). API data wins over self-reported for that platform; label "Verified audience" in web profile, applicant snapshot, eligibility messages and admin; keep "Self-reported" otherwise.
  - Refresh on connect and in the existing sync job (weekly is enough), rate-limit aware.
  - Add the call to `Backend/scripts/checkInstagramApi.js`.
  - Privacy policy already updated (website repo commit `e7a82d4`, not yet deployed). Before shipping: confirm the policy is live; previously: add a sentence to the website privacy policy (`Easilypromote-website/src/data/privacy.ts`, the platform-data list ~line 102) that audience demographics (followers' age range, gender, city and country, aggregated) are collected from connected Instagram accounts; confirm `INSTAGRAM_SCOPES` on Render is unset or includes `instagram_business_manage_insights`.
  - Record as a SPEC decision (next free number) and D7 amendment.
- **Audience demographics — TikTok: approval UNDER REVIEW (owner, 17 Sep).** Don't build until TikTok approves; then confirm which API and scope were approved. Current app uses Login Kit (`user.info.basic,user.info.profile,video.list`), which has no demographics. Needs TikTok API for Business (Organic API → Accounts; verify the exact insights scope in the portal), a developer app approval, and creators on TikTok Business accounts. Keep TikTok audience self-reported until then.
- **Engagement objective:** stays Coming soon until shares/saves are stored, YouTube and X sync, and an engagement price/payout/refund/reconciliation path exists (SPEC decision recorded).
- **Other objective:** stays Coming soon (webhook `custom` event carries no action description).
- **Interests as a hard filter:** no interests data yet.

---

## 8. Known small gaps (fix when convenient; not blockers)

1. Hybrid: views arriving after campaign completion earn no bonus (by design today; revisit with owner).
2. Brand campaign page shows the hybrid bonus setup but not bonus paid/owed figures (admin has them) — add from `brandStatement.js` figures.
3. With `AUTO_REFUNDS_ENABLED` off, refund rows a crash left unsent aren't retried automatically; finance retries from the admin Refunds page (documented).
4. Match count caches the creator pool for 5 minutes (documented).
5. `AGENTS.md` is out of date: says apps `brand`/`creator` are live and lists ports 3001/3002; the live app is `Fontend/apps/web`. Update it.
6. The standalone roadmap web page (claude.ai artifact) was last updated before M7b; `LAUNCH_ROADMAP.md` + this file are the source of truth. Tick M7b items in `LAUNCH_ROADMAP.md` (they're built but the checklist boxes above the M8 section still show `[ ]` except the dropped upload).

---

## 9. Repo housekeeping state

- Worktrees: `.claude/worktrees/optimistic-roentgen-d68154` on branch `claude/optimistic-roentgen-d68154` belongs to another session — leave it.
- Two old stashes on `main` — leave them unless the owner says otherwise.
- Tag `hotfix-keep-records-2026-09-17` — keep.
- Deleted branches: all campaign-engine milestone branches and `perf/web-and-db-tuning` (`c138e21`).

---

## 10. Order of work (checklist)

1. [x] §4 finish deploy review; fix the two minor findings; `npm test` + typechecks green; commit.
2. [ ] §5 owner: snapshot → preDeployChecks → confirm Render Paystack live key → push → index checks → smoke tests → reconciliation → badge review.
3. [ ] §7.1 remove all `alert()`/`confirm()`.
4. [x] §6 marketplace UI on sections + load test + docs (M8 batch 6) — web UI on sections, in-memory tab state caching, cursor paging, browser check, load test p50 587ms, ADMIN_RUNBOOK §9d, DEPLOY_CHECKLIST §15, LAUNCH_ROADMAP ticked.
5. [ ] §7.3 age/gender hard filters.
6. [ ] §7.4 custom usage rights.
7. [ ] §7.2 Clicks objective.
8. [ ] §8 small gaps; update `AGENTS.md`; tick `LAUNCH_ROADMAP.md`.
9. [ ] Before each later push: full review of the new range, `npm test`, typechecks, DEPLOY_CHECKLIST section for any production step, owner go-ahead.
