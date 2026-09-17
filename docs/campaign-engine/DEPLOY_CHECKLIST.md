# Campaign Engine — Production Deploy Checklist

Ordered steps for shipping the stacked campaign-engine branches (M0–M6) and M7 to production. Written against the branches as they stand on `m7/launch-fixes`; re-check the commit ids before starting.

Assumptions to confirm first: production runs `main` (`e8f5a87`); the API runs on Render behind Cloudflare with `node src/server.js`; the web app deploys from `Fontend/apps/web`; the admin panel from `Fontend/apps/admin`. The stale `Fontend/apps/brand` and `Fontend/apps/creator` apps aren't part of this release.

Never paste connection strings or keys into this document, a ticket or shell history. Commands below use placeholders.

---

## 1. Branches and merge order

The code branches form one straight line; each contains the one before it:

| # | Branch | Tip | What it adds |
|---|---|---|---|
| 1 | `m0/e2e-harness` | `ce13e6e` | Backend end-to-end test harness |
| 2 | `m1/creator-profile-v2` | `dfe795a` | Creator Profile v2 backend |
| 3 | `m1/campaign-v2` | `8570f8e` | Campaign v2 fields, rate authority, budget, eligibility, migration script |
| 4 | `m2/brand-wizard-v2` | `0a094a3` | Brand wizard v2, quote, content checkout |
| 5 | `m3/creator-marketplace-join` | `25bb00b` | Profile screens, Marketplace v2, Open Call join |
| 6 | `m4/application-required` | `afef614` | Applications, brand review, expiry job |
| 7 | `m5/content-approval` | `4f635fc` | Content Approval, delivery, auto-approve job |
| 8 | `m6/fixed-pay-payouts` | `4e3ec7e` | Fixed pay pot, withdrawals, refunds, voids, reconciliation script |
| 9 | `m7/hardening` (part A) | branches from `4e3ec7e` | Tests, alerts, speed |
| 10 | `m7/launch-docs` (part B) | branches from `4e3ec7e` | Help pages, this checklist, admin runbook |
| 11 | `m7/launch-fixes` | stacked on the M7 branches (`bb09c27`) | Read-only check scripts, alert fixes and new alerts, Complete Campaign, verification screen, money roles, void frees placements, top-up back-pay |

`m7/launch-fixes` already contains `m7/hardening`, `m7/keep-cancelled-money` and `m7/launch-docs`; merging it brings all of M7.

Two docs-only branches come straight off `main` and touch no code: `m0/domain-glossary` (`CONTEXT.md`, `docs/adr/`) and `m0/correct-tickets` (`docs/campaign-engine/` spec, roadmap and tickets, `.scratch/`).

### Order

1. Check `main` hasn't moved: `git fetch && git log --oneline -1 origin/main` should still be `e8f5a87`. If it moved, rebase the stack onto it first and expect conflicts wherever the new `main` commits touch the same files.
2. Merge `m0/domain-glossary`, then `m0/correct-tickets`. They touch different files; no conflicts expected.
3. Merge `m6/fixed-pay-payouts` (brings in 1–8 at once). Against an unmoved `main` it's a fast-forward, so no conflicts.
4. Merge `m7/launch-fixes` (it contains `m7/hardening`, `m7/keep-cancelled-money` and `m7/launch-docs`, already combined). If merging the M7 branches one at a time instead: merge `m7/hardening`, then `m7/launch-docs`. Both start from `4e3ec7e`, so conflicts only happen in files both changed. Part B changes `Fontend/packages/ui/src/components/nav-bar.tsx`, `Fontend/apps/web/src/components/creator-header.tsx` and `Fontend/apps/web/src/app/(dashboard)/dashboard/brand/page.tsx` (small Help links), and adds `Fontend/apps/web/src/app/help/`, `Fontend/apps/web/src/components/help-article.tsx` and the two docs in `docs/campaign-engine/`. Expect a conflict only if part A's speed work edited those three files; keep both changes.
5. On the merged result:
   ```bash
   cd Backend && npm ci && npm test                  # unit + end-to-end (needs a local mongod; never production)
   cd ../Fontend/apps/web && npx tsc --noEmit
   cd ../admin && npx tsc --noEmit
   ```
   All must pass. Don't deploy on red.

---

## 2. Environment variables

**No new environment variables in this release (M0–M6).** Checked by listing every `process.env.*` in `Backend/src` and `Backend/scripts` on `main` and on `m6/fixed-pay-payouts`: the sets are identical. The same holds for `Fontend/apps/web`, `Fontend/apps/admin` and `Fontend/packages/ui` (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_ADMIN_URL`, `BACKEND_URL`, `EP_KEY_ID`, `EP_WEBHOOK_SECRET`).

Existing variables the new features depend on; confirm they're set in production (don't print the values):

| Variable | Why it matters now |
|---|---|
| `MONGODB_URI` | API and all three scripts. |
| `PAYSTACK_SECRET_KEY` | Content checkout, refunds (including the Paystack refund lookup before a retry), payouts. Without it the payout reconcile job is skipped. |
| `PAYSTACK_CALLBACK_URL` | Checkout return URL when the request has no origin. |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | "You've been selected", "Application not selected" and brand reminder emails. |
| `CLIENT_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` | Unchanged, still required. |

`MONGOD_PATH` is read by the test harness only; never set it in production.

**M7 adds one:** `OPS_ALERT_EMAIL`, the address (or comma-separated addresses) ops alerts are emailed to. Optional: without it alerts only show in the admin **Overview**. Set it before deploying the API. See `ADMIN_RUNBOOK.md` §9a for the alert kinds and thresholds.

**Ticket 11 adds one:** `AUTO_REFUNDS_ENABLED`, the on-switch for automatic refunds. Optional and off unless exactly `true`; leave it unset at deploy and switch it on as its own step (§11).

`scripts/preDeployChecks.js` checks every variable this release needs (names only, never values).

---

## 3. Backups (before anything touches production)

1. Pick a quiet window. **Not on a Friday** (payout day), and not while a payout run or refund is in progress. Tell the team not to run payouts, refunds or voids until step 9.
2. Take a full backup of the production database:
   - Atlas: **Take Snapshot Now** on the cluster, if the tier supports it, and wait until it's complete; or
   - `mongodump --uri "$MONGODB_URI" --out "backup-pre-campaign-engine-$(date +%F)"` from a machine with network access, with `MONGODB_URI` set in the environment rather than typed on the command line.
3. Record the backup id / path and the time in the release ticket.
4. Note the currently deployed API, web and admin versions so they can be redeployed (§10).

---

## 4. Read-only checks (before deploying)

Run from a checkout of the merged release, in `Backend/` after `npm ci`, with `MONGODB_URI` pointing at production (a restored copy of the backup is even better for the migration dry run). The scripts load `dotenv`, but a variable already set in the environment wins; don't rely on a local `.env`.

**All check scripts are read-only.** `preDeployChecks.js`, `checkUniqueIndexConflicts.js`, `reconcileCampaigns.js` and `migrateCampaignV2.js` connect through `scripts/scriptConnection.js` (`connectReadOnly`; the migration's `--apply` uses `connectForMigration`, named for the fact that it writes, with the same options) with Mongoose's `autoIndex` and `autoCreate` off, so they never build an index or create a collection (a test runs them against a throwaway database and checks nothing was added). The migration with `--apply` writes only the Campaign v2 fields on existing campaigns; indexes are built by the API when it starts (§6).

**MongoDB 4.4 or newer is required** (the creator dashboard and join read with `$unionWith`). `preDeployChecks.js` reads the server version and blocks below 4.4.

### 4.1 Unique index conflicts

```bash
node scripts/checkUniqueIndexConflicts.js
```

**Good** (exit code 0):
```
OK  transactions {reference, type}
OK  slots {campaignId, creatorId} with a creator
OK  withdrawals pending {creatorId, campaignId, kind}
OK  withdrawals processing {creatorId, campaignId, kind}
```

**Blocks the deploy:** any `CONFLICT` line (exit code 2). MongoDB can't build a unique index over duplicates. The new one here is **slots**: a creator holding more than one placement in the same campaign. The printed group lists the slot ids, statuses and rewards; decide with engineering which placement to release (never one with a submission or payouts) before continuing.

The two other new unique indexes can't conflict: `campaignapplications` is a new collection, and the unique `{slotId, creatorId}` index on submissions only covers submissions that have a `slotId`, which only content campaigns write.

### 4.2 Migration dry run

```bash
node scripts/migrateCampaignV2.js
```

**Good:**
```json
{
  "toMigrate": 42,
  "migrated": 0,
  "byObjective": { "views": 37, "signups": 4, "downloads": 1 },
  "dryRun": true
}
Dry run only. Re-run with --apply to write.
```
- `toMigrate` equals the number of campaigns without `campaignObjective` (all of them, before the first run):
  `db.campaigns.countDocuments({ campaignObjective: { $exists: false } })`.
- `byObjective` matches what's in production: `views` for campaigns with `objective: "views"`; for `objective: "actions"`, the first match in their conversion types of `signup` → `signups`, `install` → `downloads`, `purchase` / `deposit` → `sales`, `custom` → `other`.
- `sales` and `other` are "Coming soon" objectives for new campaigns; migrated campaigns keep working with them.

**Blocks the deploy:** "Migration failed: …", a connection error, or counts that don't match the database.

The migration only ever writes `campaignObjective`, `campaignModel` (`performance`), `payShape` (`performance`), `rateAuthority`, `performanceMetric`, `contentDestination` (`creator_page`) and `creatorAccess` (`open_call`) on campaigns that don't have `campaignObjective` yet. It never touches budgets, pools, placements or payments, and it's safe to re-run.

### 4.3 Reconciliation baseline

```bash
node scripts/reconcileCampaigns.js > reconcile-before.txt; echo "exit $?"
```

- Exit 0 and `Checked N campaigns; 0 don't balance.` is ideal.
- Exit 1 lists `FAIL` campaigns with their problems. Before the deploy there are only views and referral campaigns, and older data may already fail. **Save the output as the baseline.** It blocks the deploy only if a campaign shows money leaving that shouldn't have (`… was paid ₦…, more than …`, `payouts … exceed the creator pool`) and nobody can explain it; those need investigating whatever this release does.
- Exit 2: the script couldn't run. Fix and re-run.

See `ADMIN_RUNBOOK.md` §8 for what each problem means.

### 4.4 All-in-one pre-deploy checks

```bash
node scripts/preDeployChecks.js              # production
node scripts/preDeployChecks.js --staging    # a staging stack with Paystack test keys
```

It checks, in order: the environment variables (required ones block; `OPS_ALERT_EMAIL` and `PAYSTACK_CALLBACK_URL` only warn; a key that isn't `sk_live_` blocks unless `--staging`; `JWT_REFRESH_SECRET` equal to `JWT_SECRET` blocks), the MongoDB server version (below 4.4 blocks), the Campaign v2 migration dry run (a warning: apply it as its own step, §7), unique index conflicts (block) and reconciliation of every campaign with money (a campaign that doesn't balance blocks). `--apply` is refused.

**Good:** `No blocking problems.` and exit code 0. Exit 1 lists the blocking problems; exit 2 means the checks couldn't run (for example, no connection).

### 4.5 Paystack settings

- The webhook URL is `<API base>/api/webhooks/paystack` and receives `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`, `refund.processed` and `refund.failed`. Content refunds only show as Refunded after `refund.processed`.
- Transfers don't require OTP.

---

## 5. Deploy order: API first, then web, then admin

**Deploy the API first.** The new API still serves what the old web app and admin call; the new web app needs routes that only the new API has.

Why that's safe, from the code:
- **Old clients on the new API keep working.** `POST /api/slots/claim` goes through the same `joinCampaign` path as the new `POST /api/campaigns/:id/join`. `POST /api/creators/withdrawals` still accepts the older `kind` + `amount` requests. Campaign create and edit still accept the older `objective` (`views | actions`) and `referral` fields and derive the v2 fields from them (`resolveCampaignSetup`). Admin routes only gained fields and routes.
- **The new API handles campaigns that aren't migrated yet.** `campaignTerms` reads a campaign without v2 fields as views or its referral objective, performance, Open Call; the content deadline job treats a campaign without `campaignModel` as content only if its objective says so.
- **The new web app on the old API breaks:** `POST /api/campaigns/quote`, `/:id/join`, `/:id/apply`, `/:id/applications`, the Marketplace v2 payload, the content submission routes and `GET /api/admin/campaigns/:id/content-budget` don't exist there.

### Steps

1. **Deploy the API** (merged `main`).
2. Watch the boot logs:
   - `[MongoDB] Connected successfully!` and `EasilyPromote API running on port …`.
   - A `[Reconcile] checked=…` line shortly after boot. `[Reconcile] Skipped — PAYSTACK_SECRET_KEY not set` means the key is missing: stop and fix.
   - No `[Content] Deadline run failed` or `[Applications] Deadline run failed`.
   - `GET <API base>/api/health` answers.
3. **Confirm the indexes built** (§6).
4. **Apply the migration** (§7).
5. **Reconcile again** (§7).
6. **Deploy the web app.**
7. **Deploy the admin panel.**
8. **Smoke tests** (§8).
9. Tell the team payouts, refunds and voids can resume.

---

## 6. Index builds

Mongoose builds any missing index when the API connects (`autoIndex` is on by default). A build that fails, for example over duplicates, doesn't stop the API and isn't logged by the app, so check by hand.

New indexes in this release (from the models):

| Collection | Keys | Options | Model |
|---|---|---|---|
| `slots` | `{ campaignId: 1, creatorId: 1 }` | **unique**, partial: `creatorId` is an ObjectId | `Slot.js` |
| `submissions` | `{ slotId: 1, creatorId: 1 }` | **unique**, partial: `slotId` is an ObjectId | `Submission.js` |
| `submissions` | `{ status: 1, awaitingBrandSince: 1 }` | | `Submission.js` |
| `campaignapplications` | `{ campaign: 1, creator: 1 }` | **unique** | `CampaignApplication.js` |
| `campaignapplications` | `{ campaign: 1, status: 1, matchScore: -1 }` | | `CampaignApplication.js` |
| `campaignapplications` | `{ status: 1, appliedAt: 1 }` | | `CampaignApplication.js` |
| `opsalerts` | `{ key: 1 }` | **unique**, partial: `active` is true | `OpsAlert.js` |
| `opsalerts` | `{ resolvedAt: 1, firstSeenAt: -1 }`, `{ active: 1, kind: 1 }` | | `OpsAlert.js` |
| `paystackwebhookfailures` | `{ createdAt: 1 }` | TTL 30 days | `PaystackWebhookFailure.js` |

`jobstates` (the ops alerts job's last full reconciliation pass) is also new and has only its `_id` index. New collections can't have conflicts.

Also confirm these unique indexes from `main` exist, since the budget-first rollout may not have built them in production yet: `transactions` `{ reference: 1, type: 1 }` (partial), `withdrawals` `one_pending_withdrawal` and `one_processing_withdrawal`.

Check in `mongosh`:
```js
db.slots.getIndexes()
db.submissions.getIndexes()
db.campaignapplications.getIndexes()
db.transactions.getIndexes()
db.withdrawals.getIndexes()
db.currentOp({ "command.createIndexes": { $exists: true } })   // builds still running
```

Each unique index must show `unique: true` and the partial filter above. If one is missing after the API has been up a few minutes and no build is running, re-run `checkUniqueIndexConflicts.js`, resolve conflicts, and create it by hand, for example:
```js
db.slots.createIndex(
  { campaignId: 1, creatorId: 1 },
  { unique: true, partialFilterExpression: { creatorId: { $type: "objectId" } } }
)
```

The indexes can also be created by hand before step 5.1; the old API is unaffected by them as long as §4.1 found no conflicts.

---

## 7. Applying the migration

After the new API is up and the indexes are confirmed:

```bash
node scripts/migrateCampaignV2.js            # dry run again: same counts as §4.2 (plus any campaigns created since)
node scripts/migrateCampaignV2.js --apply    # writes; prints one line per campaign, then the summary
node scripts/migrateCampaignV2.js            # dry run: toMigrate must now be 0
```

**Good:** the `--apply` summary shows `migrated` equal to `toMigrate` and `"dryRun": false`; the last dry run shows `"toMigrate": 0`.

If `migrated` is lower than `toMigrate`, a campaign was changed between reading and writing (the write only applies where `campaignObjective` is still missing). Re-run `--apply`; it picks up whatever's left.

Then:
```bash
node scripts/reconcileCampaigns.js > reconcile-after.txt; echo "exit $?"
diff reconcile-before.txt reconcile-after.txt
```
**Good:** no campaign fails that didn't fail in the baseline. The migration doesn't write money fields, so a new failure here means something else is wrong: stop and investigate before deploying the web app.

---

## 8. Smoke tests after deploy

Use a test brand and a test creator account. In production these move real money; keep amounts tiny (the examples total ₦390 plus a refund), or run the same list on a staging stack with Paystack test keys first.

The test creator needs a connected TikTok or Instagram / Facebook account and chosen niches.

### Brand

1. **Help pages:** logged out, open `/help/brands` and `/help/creators`. Both load; the section links jump to their sections. Logged in, the brand dashboard and creator dashboard headers show **Help**.
2. **Content campaign draft:** Create Campaign → Objective **Content** → destination **Your page**, access **Open Call** → skip audience → Pay and budget: ₦100 per deliverable, 2 deliverables → save and close. The draft is on the dashboard and reopens on the step it was saved on.
3. **Quote:** on Pay and budget the summary shows Creator Budget ₦200, Platform Fee ₦60, **Total to Pay ₦260** (`POST /api/campaigns/quote`).
4. **Views quote (no payment):** a Views draft at 100,000 views shows ₦430,000.
5. **Sign-up campaign gate (no payment):** for a brand whose app isn't connected, paying a Sign-ups draft is refused with "Connect your app before paying for a referral campaign…".
6. **Pay:** pay the content draft (₦260). After Paystack returns, the campaign is **live**. In **Campaigns** (admin), the campaign shows **Deliverables And Fixed Pay** with Bought 2.
7. **Application Required campaign:** create a second content campaign, destination **Creator's page**, access **Application Required**, a hashtag in the brief (e.g. `#EPTest`), ₦100 × 1, and pay it (₦130).

### Creator

8. **Join:** in the marketplace, open the first campaign → join. The place is reserved and the full brief shows. Joining again is refused ("You already have a place in this campaign").
9. **Apply:** open the second campaign → apply with a pitch. **My Applications** shows it pending with its expiry date.
10. **Approve (brand):** campaign → Applicants → open the snapshot → Approve. The creator is told "You've been selected" and the brief unlocks.

### Content, delivery, confirmation

11. **First campaign (Your page):** creator submits a content link → brand **Request Changes** with a note → creator resubmits → brand **Approve** → creator shares a download link and accepts the usage rights → brand confirms receipt. The submission ends **completed**. In admin, Completed 1.
12. **Second campaign (Creator's page):** creator submits → brand approves → creator shares a live post link with a caption **without** the hashtag: refused "Your caption is missing #EPTest" → again with it: accepted → brand confirms the post → **completed**.

### Wallet

13. Creator → Wallet: both campaigns show ₦100 fixed pay **on hold** with the unlock date (7 days after completion). Withdrawing from either is refused with the on-hold message.

### Admin

14. **Complete and refund:** as `admin`, open the first campaign in **Campaigns** → **Complete Campaign** → confirm. It leaves the creator marketplace and joining it is refused; the brand gets "Campaign completed"; **Activity Log** shows `campaign.completed`. As `support`, the button isn't shown. **Deliverables And Fixed Pay** shows Unused 1 and ₦130 refundable. Signed in as `support` or `admin`, **Refund Unused Budget** is disabled (the API refuses it with 403). As `finance_admin` or `super_admin`, refund it: the state shows **Sent, Waiting For Paystack** or **Refunded**; the brand gets "Unused budget refunded"; **Activity Log** shows `campaign.unused_budget_refunded`; after Paystack's webhook the state is **Refunded**.
15. **Weekly Payout Run** and **Withdrawal Requests** load and show the Paystack balance.
16. **Reconciliation:** `node scripts/reconcileCampaigns.js --all` shows both test campaigns as `OK`, and no campaign fails that wasn't in the baseline.

Leave the test campaigns **completed**. (A cancelled campaign with payments, placements, content, applications or conversions is kept, not deleted; see the runbook §5.)

---

## 9. After the deploy

- For the first 72 hours, check the API logs daily for `Deadline run failed`, `Auto-confirm failed`, `[FixedPay] No creator budget left`, `[Refunds]` / `[FixedPay] Paystack refund failed`, `[Payouts] Transfer failed`.
- Run the stuck-job queries in `ADMIN_RUNBOOK.md` §9 once a day for the first week.
- Run `reconcileCampaigns.js` before the first Friday payout run.

---

## 10. Rollback plan

Every campaign-engine field is additive (ADR 0001), so **reading** migrated data with the old code is harmless. What isn't harmless is the old code **acting** on campaigns and money the new code created.

### Always safe

- **Roll back the web app or the admin panel** to the previous deploy while the new API stays. The new API still serves the old clients (§5).
- **Leave the migration in place.** The old API ignores the v2 fields on legacy campaigns; there's nothing to undo.
- **Leave the new indexes in place.** The only behaviour change for old code is that a second placement for the same creator in a campaign fails with a duplicate-key error instead of being created.

### Safe only before any new-model campaign is paid

Roll back **the API** to `main` only while **no content campaign has been paid and no Application Required campaign is live**. Check:
```js
db.transactions.countDocuments({ bucket: "fixed" })                         // must be 0
db.campaigns.countDocuments({ campaignModel: "content", status: { $nin: ["draft", "pending_payment"] } })  // must be 0
db.campaigns.countDocuments({ creatorAccess: "application_required", status: "live" })                 // must be 0
```

### Not safe once content campaigns have money (forward-fix instead)

Once any of the counts above is non-zero, rolling the API back to `main` would:
- **Hybrid pay (ticket 10) needs no migration, index or environment variable.** Its fields (`Campaign.hybridBonus`, `Withdrawal.bonusAmount`, `ConversionEvent.bonusAmount`, the `bonus` ledger bucket and `bonus_credit` rows) are additive. Rolling back past it once a hybrid campaign is paid is **not safe**: older code reads the `bonus` bucket as views escrow and pays sign-up bonuses from the (empty) referral budget. Forward-fix instead.
- **Treat the fixed pot as views escrow.** `main` reads any bucket other than `referral` as views, so a cancel would refund the content payment as views escrow and views withdrawals could draw on it.
- **Ignore fixed pay credits** in withdrawals, so creators owed fixed pay can't withdraw it, and a mixed withdrawal's `fixedAmount` wouldn't be paid.
- **Break saves** of content campaigns (`main` requires `targetViews`) and of submissions in the new statuses (`changes_requested`, `awaiting_delivery`, `awaiting_receipt`, `completed`, `not_delivered` aren't in `main`'s enum).
- **Let anyone join Application Required campaigns** and let creators claim deliverable places as views places, since `main` ignores `creatorAccess` and slot `kind`.
- **Stop every deadline job:** no auto-approval, no application expiry, no crediting.

In that state, fix forward on the new API. If the API must come down, put it in maintenance rather than running `main` against the data.

### Restoring the backup

Restoring the §3 backup undoes the migration **and everything since**: payments confirmed by Paystack webhooks, withdrawals, conversions and refunds would be lost from our ledger while the money has really moved. Only restore if nothing with real money happened after the backup; otherwise reconcile by hand against Paystack before and after.

---

## 11. Money follow-ups (ticket 11: automatic refunds, refund retries, payout appeals, brand statement)

**No migration. One new environment variable, `AUTO_REFUNDS_ENABLED`, the automatic refund job's on-switch.** The job does nothing unless it is exactly `true` (log at boot: `[AutoRefunds] Off — AUTO_REFUNDS_ENABLED isn't true`). Leave it **unset** for the deploy; switch it on as a separate, deliberate step once finance has agreed the first run (below). While it's off, **Refund Unused Budget**, **Refund Unused Bonus** and **Retry Refund** still work, and the admin **Overview** and **Refunds** screens show **Automatic Refunds Are Off**. `scripts/preDeployChecks.js` warns (never blocks) while it's off. The job also needs `PAYSTACK_SECRET_KEY` (already required); without it the job is skipped (`[AutoRefunds] Skipped`).

**Indexes and collections (built by the API at boot, §6):**

| Collection | Keys | Options | Model |
|---|---|---|---|
| `payoutappeals` (new) | `{ subjectType: 1, subjectId: 1 }` | **unique** | `PayoutAppeal.js` |
| `payoutappeals` | `{ status: 1, createdAt: -1 }`, `{ creatorId: 1, createdAt: -1 }` | | `PayoutAppeal.js` |
| `submissionevents` | `{ type: 1, createdAt: -1 }` | | `SubmissionEvent.js` |

The new collection can't conflict. The `submissionevents` index isn't unique; on a large collection check `db.currentOp({ "command.createIndexes": { $exists: true } })` until it's built.

**A new job moves money as soon as it's switched on.** With `AUTO_REFUNDS_ENABLED=true`, `startAutoRefunds` runs at boot and then hourly, and refunds unused budget on every campaign that was completed or cancelled in the last 90 days (runbook §5 Automatic refunds), including campaigns that ended before this release:
- content campaigns' unused deliverables (what **Refund Unused Budget** would offer today),
- hybrid campaigns' unused bonus pool once refundable,
- completed views campaigns' untaken places and completed sign-up campaigns' unearned referral pool, 7 days after completion (before this release these were never refunded),
- cancel refunds that never happened.

Before setting `AUTO_REFUNDS_ENABLED=true` (read-only, against production):
1. Run `node scripts/reconcileCampaigns.js` and keep the output; a campaign that doesn't balance should be understood first, because the job refunds from the same figures.
2. List what the first run will look at, and agree with finance that those brands should be refunded now:
   ```js
   const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
   db.campaigns.find({ $or: [
     { status: "completed", completedAt: { $gte: since } },
     { status: "cancelled", updatedAt: { $gte: since } },
   ] }, { name: 1, status: 1, completedAt: 1, campaignModel: 1, payShape: 1 })
   ```
   For content campaigns, the **Deliverables And Fixed Pay** panel's refundable amount is what the job will send. If some must not be refunded yet, settle those refund decisions before switching it on: the switch is global, there's no per-campaign one.
3. Paystack: the balance must cover the refunds (Paystack refunds draw on it).

Switching it on: set `AUTO_REFUNDS_ENABLED=true` on the API service in Render and let it restart (the job runs at boot). To switch it off again, remove the variable (or set `false`) and restart; refund rows already sent stay sent.

After switching it on:
- Watch for `[AutoRefunds]` log lines in the first hour, then **Refunds** → **Needs Attention** and **Overview** → **Needs Attention** for `Automatic Refund Failed`.
- Run `node scripts/reconcileCampaigns.js` again; nothing new should fail.
- Smoke: as a brand, open **Statement** on the brand dashboard (figures add up to paid in; **Download CSV** works). As `support`, **Appeals Inbox** loads and **Grant Appeal** on a payout appeal is disabled. As `finance_admin`, **Refunds** loads.

**Behaviour changes to tell the team:** voided undelivered pay is no longer refundable until the creator's 7-day appeal window passes (or an appeal is denied); failed views, referral and bonus refunds are retried from **Refunds** instead of by hand in Paystack; rejected-withdrawal and voided-pay notifications now tell creators they can appeal.

**Rollback:** the fields (`Campaign.autoRefund`, `Campaign.hybridBonus.returnedRefs`, `Submission.voidAppealableUntil / voidAppealOpen / voidReinstatedAt`, `Withdrawal.appealReinstatedAt`, `Transaction.bonusGiveBack`, the `reinstated` status on `fixed_void` rows) are additive, and older code ignores them. Two caveats: older code treats a `fixed_void` row as blocking a credit whatever its status (harmless: restored pay is already credited), and older code would refund voided pay that's still inside its appeal window. Refunds the job already sent can't be undone by a rollback.

---

## 12. Launch follow-ups (ticket 11: Trending, live match count, price table, Leads and Sales)

**No migration and no new environment variable.** Deploy the API first, then web, then admin (§5). Nothing here moves money on its own.

**Indexes and collections (built by the API at boot, §6):**

| Collection | Keys | Options | Model |
|---|---|---|---|
| `slots` | `{ claimedAt: -1, campaignId: 1, creatorId: 1 }` | partial: `claimedAt` is a date | `Slot.js` |
| `campaignapplications` | `{ appliedAt: -1, campaign: 1, creator: 1 }` | | `CampaignApplication.js` |
| `pricetables` (new) | `_id` only | | `PriceTable.js` |

None is unique, so none can conflict. On a large `slots` collection check `db.currentOp({ "command.createIndexes": { $exists: true } })` until the build is done; until then Trending still works, only slower.

**Price table:** until someone saves on **Price Table**, the API uses the standard tiers from `config/pricing.js` (nothing changes for brands). The first save creates the `pricetables` document. It never reprices a paid campaign (runbook §9b).

**Leads and Sales:** the conversion webhook now accepts `"event": "lead"`. A Leads campaign counts `lead`; a Sales campaign counts `purchase`. The public developer docs (`Easilypromote-website`, not part of this release) still list the older events; update them before announcing Leads. Older API versions answer 400 to `lead`, so deploy the API before telling brands.

**Behaviour changes to tell the team:** brands can create Leads and Sales campaigns (connect-before-pay applies, our team sets the reward, runbook §1); the creator marketplace shows a Trending section; the wizard's audience step shows a rounded count of matching creators (never who they are; cached up to 5 minutes; 30 a minute per brand); finance and super admins can change view prices on **Price Table**.

**Smoke tests after deploy:**
- As a creator, the marketplace loads with **Trending** (once campaigns have had 2 or more creators join or apply in 3 days) between **Recommended for You** and **New**.
- As a brand, Create Campaign: Leads and Sales can be chosen, Engagement and Other say Coming soon and why; on Audience and creators the count line updates a moment after a change.
- As `support`, **Price Table** loads and **Edit Prices** is disabled. As `finance_admin` it opens; don't save in production unless prices really change.
- A views quote for 100,000 views still shows ₦430,000 unless the table was changed.

**Rollback:** the API code is safe to roll back while no Leads campaign exists. Older code ignores `pricetables` (it prices from `config/pricing.js` again, so a saved table stops applying), the extra indexes and the Trending fields. Older code's schema doesn't know `lead`, so once a Leads campaign or `lead` conversion exists, forward-fix instead.

