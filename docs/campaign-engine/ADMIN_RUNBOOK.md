# Campaign Engine — Admin Runbook

Step-by-step procedures for the EasilyPromote team running campaigns after launch. Every rule here was checked against the code on `m7/launch-fixes` (M0–M7). Where the admin panel can't do something, the procedure says so and gives the other way. Terms follow `CONTEXT.md`.

- **Admin panel:** `Fontend/apps/admin`. Screens are named by their sidebar label.
- **API:** routes are under `/api`. `$API` below is the production API base URL including `/api`.
- **Doing something the panel can't:** sign in to the admin panel, copy the `token` value from the browser's local storage, and call the route with `Authorization: Bearer $TOKEN`. Every such call below is marked **API only**.

---

## 0. Roles: who can do what

Roles come from `authorizeRoles` in `Backend/src/routes/admin.js` and `adminReferrals.js`.

| Action | Route | admin | super_admin | finance_admin | support |
|---|---|---|---|---|---|
| See everything in the panel | `GET /api/admin/*` | ✓ | ✓ | ✓ | ✓ |
| Put live, pause, resume, send back to review | `PATCH /admin/campaigns/:id/status` | ✓ | ✓ | ✓ | ✓ |
| **Complete a live or paused campaign** | `POST /admin/campaigns/:id/complete` (or the status route with `completed`) | ✓ | ✓ | ✓ | ✗ |
| Cancel an unpaid campaign (draft, pending payment) | `PATCH /admin/campaigns/:id/status` | ✓ | ✓ | ✓ | ✓ |
| **Cancel a paid campaign** (sends views and referral refunds) | `PATCH /admin/campaigns/:id/status` | ✗ | ✓ | ✓ | ✗ |
| Delete a draft, pending-payment or cancelled campaign with no records (§5) | `DELETE /admin/campaigns/:id` | ✓ | ✓ | ✓ | ✓ |
| Review submissions, decide content appeals | `PATCH /admin/submissions/:id/review`, `/appeal` | ✓ | ✓ | ✓ | ✓ |
| Verify or unverify a creator | `PATCH /admin/creators/:id/verification` | ✓ | ✓ | ✓ | ✓ |
| Grant, revoke or return a badge to automatic (note required) | **Users & Creators** → **Badges & Ratings** → `PUT /admin/creators/:id/badges/:badge` | ✓ | ✓ | ✓ | ✓ |
| Hide or unhide a brand rating (reason required to hide) | **Badges & Ratings** → Ratings → `PATCH /admin/ratings/:id/visibility` | ✓ | ✓ | ✓ | ✓ |
| Resolve an ops alert | `PATCH /admin/alerts/:id/resolve` | ✓ | ✓ | ✓ | ✗ |
| **Approve or reject withdrawals, run the weekly payout** | `POST /admin/withdrawals/:id/review`, `/admin/payout-run/approve` | ✗ | ✓ | ✓ | ✗ |
| **Check stuck payouts against Paystack** | `POST /admin/payouts/reconcile` | ✗ | ✓ | ✓ | ✗ |
| **Refund unused content budget, retry a refund** | `POST /admin/campaigns/:id/refund-unused`, `/refunds/:refundId/retry` | ✗ | ✓ | ✓ | ✗ |
| **Retry any failed refund** (content, views, referral, bonus) | **Refunds** → `POST /admin/refunds/:refundId/retry` | ✗ | ✓ | ✓ | ✗ |
| Deny a payout appeal (note required) | **Appeals Inbox** → `POST /admin/payout-appeals/:id/resolve` | ✓ | ✓ | ✓ | ✓ |
| **Grant a payout appeal** | **Appeals Inbox** → same route with `grant` | ✗ | ✓ | ✓ | ✗ |
| **Refund a hybrid campaign's unused bonus pool** | `POST /admin/campaigns/:id/refund-unused-bonus` | ✗ | ✓ | ✓ | ✗ |
| **Void undelivered fixed pay** | `POST /admin/submissions/:id/void-undelivered` | ✗ | ✓ | ✓ | ✗ |
| Set or change a sign-up reward (also a hybrid sign-up / download bonus) | `PATCH /admin/referrals/campaigns/:id/reward` | ✓ | ✓ | ✓ | ✗ |
| **Void a conversion** (its reward goes back to the pool, D19) | `POST /admin/referrals/conversions/:id/void` | ✗ | ✓ | ✓ | ✗ |
| Disable a code, revoke a signing key | `/admin/referrals/codes/...`, `/keys/...` | ✓ | ✓ | ✗ | ✗ |
| See the per-view price table | **Price Table** → `GET /admin/pricing/views` | ✓ | ✓ | ✓ | ✓ |
| **Change the per-view price table** | **Price Table** → `PUT /admin/pricing/views` | ✗ | ✓ | ✓ | ✗ |
| Create an admin | `POST /admin/create-admin` | ✗ | ✓ | ✗ | ✗ |

Every action that moves money (bold above, apart from Complete) is for `finance_admin` and `super_admin`. The panel disables or hides those buttons for other roles and says who can use them; the API answers 403 "Not authorized for this action" (`MONEY_ROLE_REQUIRED` when cancelling a paid campaign) if they're called anyway.

---

## 1. Sign-up, download, lead and sale rewards

Rate Authority (ADR 0003): for sign-ups, downloads, leads and sales the brand funds a Referral Budget and **our team** sets the Reward per Conversion. The API refuses a reward from a brand. Each objective counts one conversion event from the brand's server: sign-ups `signup`, downloads `install`, leads `lead`, sales `purchase` (ticket 11). Other events on the campaign are recorded but not counted or paid. Engagement and Other campaigns can't be created yet (SPEC, ticket 11).

### Set the first reward

**Who:** `admin`, `super_admin`, `finance_admin`.

1. **Referrals** → **Campaigns** tab → press **Needs a reward**. This lists live or paused campaigns with referral tracking and no reward.
2. Open the campaign's reward dialog. It shows the referral **Budget**, **Creator pool** (budget less the 30% fee) and **Left**.
3. Enter the reward per conversion (₦1 to ₦1,000,000) and an optional note. Save.
4. Read the result:
   - **Paid earlier conversions:** conversions recorded before any reward existed are paid now, oldest first, while the pool lasts. Each gets a fresh 7-day hold from now, so it can still be voided.
   - **Still unpaid:** the pool ran out. Those conversions are marked budget exhausted.
5. The brand and every creator with a code on the campaign get a notification. The activity log records `referral.reward_set` with the back-pay counts.

### Change a reward

Same dialog. The new amount applies to **new conversions only**; earlier conversions keep what they earned, and nothing is back-paid (`referral.reward_changed`).

### Refusals

| Message | Why |
|---|---|
| "This campaign's creator rate isn't set by our team" (`RATE_NOT_ADMIN_SET`) | The campaign's rate authority is the brand (content) or the price table (views). |
| "Referral tracking isn't on for this campaign" | Not a sign-up, download, lead or sale campaign. |
| "This campaign is cancelled" | Rewards can't be set on cancelled campaigns. |

### Things to know

- A conversion that arrives when the pool can't cover the reward is recorded unpaid (budget exhausted) and the brand is told once.
- **When the brand tops up the referral budget**, those unpaid conversions are paid first from the new pool, oldest first, while it lasts, each with a fresh 7-day hold (so it can still be voided). It happens as soon as the top-up is credited (Paystack webhook or the brand's return from checkout), and again on any repeat of either. Every creator paid gets one "Earlier sign-ups paid" notification per top-up. Anything the top-up can't cover stays unpaid (budget exhausted) for the next top-up. Nothing is back-paid until a reward is set.
- **Strictly oldest first.** While older sign-ups wait for pay, a new one never draws on the pool: it's recorded as budget exhausted, queued behind them, and the waiting ones are paid in order straight away as far as the pool goes.
- **A conversion is never paid twice and a conversion stays unpaid until its reward is really reserved.** Each is claimed first (the claim records the attempt and the reward), then its reward is reserved from the pool together with a marker for that conversion, then the reward is recorded and the claim cleared. If the API dies part-way, the claim is taken over once it's 5 minutes old by the next back-pay run and any reservation already made is reused, so the pool is decremented once. That run is the next top-up, a repeat of one or a new sign-up on the campaign, and at the latest the 15-minute ops alerts job, which retries back-pay on every campaign with waiting sign-ups whose reward is set and whose pool covers one, or with a claim older than 5 minutes. So a stranded back-pay (and the newer sign-ups queued behind it) is finished within about 20 minutes without anyone acting.
- To remove a fake or reversed conversion: **Referrals** → **Conversions** → void it with a note (`finance_admin`, `super_admin`). Only possible while its 7-day hold is running; the reward goes back to the pool.

---

## 2. Verifying creators

A Verified Creator has at least one connected social account and an identity check by our team (D13). Campaigns can require it (`verifiedOnly`).

**Who:** any admin role.

1. **Users & Creators** → **Creators** tab → find the creator. The Rank / Score column shows **Verified**, **Not Verified** or **No Connected Account**.
2. Do the identity check. The product has no ID upload or request flow; how the check is done is outside the product.
3. Press **Verify Creator**. The dialog lists the creator's connected social accounts (TikTok, Instagram, Facebook with their usernames). With none, it says why the creator can't be verified and the button is disabled; the API refuses the same case with `SOCIAL_ACCOUNT_REQUIRED` (409), shown in the dialog.
4. Confirm. The row shows **Verified**.
5. To remove it, press **Remove Verification** and confirm.

API equivalent: `PATCH $API/admin/creators/<userId>/verification` with `{"verified": true}` or `{"verified": false}` (user id, not profile id).

The badge is removed automatically when the creator disconnects their last social account. Each change is logged as `creator.verified` / `creator.unverified`.

---

## 2a. Badges and brand ratings (M8, SPEC D24 / D25)

**Who:** any admin role. Every change needs a note and is logged (**Activity** → **Users** for badges, **Ratings** for ratings).

### Brand ratings

A brand rates a creator 1–5 (optional comment and tags) from its campaign page once the creator's placement is complete: content completed, or, on a performance campaign, the campaign completed and the creator delivered verified views or a paid conversion. Once per creator per campaign; the brand can change it for 7 days. Creators and brands only see the count and, from 3 ratings, the average. Admins see everything.

**Hide an abusive rating:** **Users & Creators** → the creator's **Badges & Ratings** → **Ratings** → **Hide** → give a reason → **Hide Rating**. It stops counting towards the average, the score and badges straight away, the brand can no longer change it (they see it was hidden), and nothing is deleted. **Unhide** puts it back. Hide for abuse, personal attacks, private information or a rating that isn't about the work; not because the creator disagrees with a fair low rating.

API: `GET $API/admin/ratings?creatorId=<userId>&hidden=true|false`, `PATCH $API/admin/ratings/<ratingId>/visibility` with `{"hidden": true, "reason": "…"}`.

### Why a creator has or lacks a badge

**Badges & Ratings** → **Badges** shows, per badge: **Held / Not Held**, where it comes from (earned automatically, granted or revoked by an admin, or kept from before automatic badges), the minimum sample and each check with the creator's value and the threshold. A creator holding a badge is checked against the lower **To Keep It** bar; one who doesn't against **To Earn It**. Thresholds are in SPEC D25. Values are from the last check (daily, at API start, when their content completes or a rating changes); **Recalculate Now** checks again.

### Overriding a badge

- **Grant**: the creator holds it whatever the rules say (they're notified if it's new to them).
- **Revoke**: they don't hold it whatever the rules say; campaigns requiring it refuse them.
- **Automatic**: remove the override; the rules decide from now on.

Overrides survive every recalculation until changed. API: `PUT $API/admin/creators/<userId>/badges/<badge>` with `{"mode": "grant" | "revoke" | "auto", "note": "…"}`.

### Reviewing badges kept from before automatic badges

Badges set by hand before automatic badges shipped weren't removed: on the first check after deploy each became a grant marked **kept from before automatic badges**. **Users & Creators** shows a banner listing those creators (`GET $API/admin/badges/review`). For each kept badge, read the checks and choose **Grant** (keep it as your decision) or **Automatic** (the rules decide; the creator loses it now if they don't meet the bar). The banner clears once none are left.

---

## 3. Content appeals

A brand's rejection of content (content campaigns only) can be appealed by the creator within **7 days** of the rejection (`APPEAL_WINDOW_MS`). The appeal goes to our team; brands can't decide it.

### How you hear about it

The brand gets a notification. Admins get a live `submission-appealed` push if signed in, the **Overview** counts appealed submissions, and the appeal shows in **Appeals Inbox** (§3a).

### Decide an appeal

1. **Appeals Inbox** → **Content** (or **Verifications** → **Appeals** tab).
2. Watch the content. Read the brand's rejection reason and the creator's appeal. The campaign's brief is on the campaign in **Campaigns**.
3. Decide:
   - **Uphold the rejection:** a note is required. The content stays rejected, the appeal window closes, and the decision is final.
   - **Approve the appeal:** the content counts as approved and moves to delivery (`awaiting_delivery` for brand page / both, `awaiting_post` for creator page). For brand-page-only campaigns the creator's fixed pay is credited at once.
4. Refusals when approving:
   - `NO_BUDGET_FOR_APPEAL`: the campaign's creator budget is fully credited or refunded. The appeal can't be upheld.
   - `PLACEMENT_TAKEN`: another creator has taken the place since the rejection. The appeal can't be upheld.

The same **Verifications** screen also lets an admin approve or reject content that's waiting for review, through the same guarded path the brand uses.

Every decision is logged (`submission.appeal_approved` / `submission.appeal_rejected`).

## 3a. Payout appeals and the Appeals Inbox (D23)

A creator can appeal, once and within **7 days**, a **rejected withdrawal** or **fixed pay voided as not delivered** (§4), from their wallet. Voided conversions (§1) aren't appealable in the product.

**Appeals Inbox** lists content appeals (§3) and payout appeals together. Filter by **Content / Payouts**, **Open / Resolved / Any Status**, search by creator, campaign or reason, or open one campaign's appeals with `/appeals?campaign=<id>`. Choose a row to read the decision, the creator's reason and (content) the video.

- **Deny Appeal** (any admin role): a note is required. The decision stands, can't be appealed again, and the creator is told with your note (`payout_appeal.denied`).
- **Grant Appeal** (`finance_admin`, `super_admin`): moves money.
  - **Rejected withdrawal:** goes back in the payout queue with its original request date, so it's due in the next **Weekly Payout Run**, where escrow and holds are checked again. Refused with `WITHDRAWAL_IN_FLIGHT` when the creator already has a withdrawal queued for that campaign, or `NO_LONGER_AVAILABLE` when their earnings no longer cover it (they requested again, or earnings were voided). Deny it then; they can request what's available.
  - **Voided pay:** the content goes back to **awaiting delivery** (a new 14-day delivery window), the creator takes their place back and the pay is credited again. Refused with `PLACEMENT_TAKEN` or `NO_BUDGET_FOR_APPEAL` (the deliverable was refunded or paid to someone else).
  - A refused grant leaves the appeal open. The creator is told of a grant (`payout_appeal.granted`).
- A grant claims the appeal first ("Being Granted"). If the API died part-way, grant it again after 5 minutes: every step is repeat-safe and never pays twice.

While a voided-pay appeal is open or can still be filed, its deliverable isn't refundable, by hand or automatically.

---

## 4. Voiding undelivered fixed pay

For content going to the brand's page (brand page or both): if approved content is never delivered, its fixed pay can be removed so the deliverable becomes refundable.

**Who:** `finance_admin`, `super_admin`.

1. **Campaigns** → open the content campaign → **Deliverables And Fixed Pay** → **Approved, Not Delivered**.
2. Each row shows the creator, approval date, and either "can be voided from <date>" or an enabled **Void Undelivered Pay** button. It's enabled **14 days after approval**, or straight away if the campaign is cancelled.
3. Press it and confirm in the modal. This can't be undone.
4. Effect: the submission becomes `not_delivered`; if pay was credited, a `fixed_void` ledger row reverses it and the amount goes back to the campaign; the creator is notified and can appeal within 7 days (§3a); the action is logged (`submission.fixed_pay_voided`). The deliverable counts as unused for refunds once the appeal window has passed or an appeal was denied.
5. The creator's placement is freed and no longer counts toward their 3 active placements: on a **live** campaign that can still pay the deliverable it goes back to the campaign for another creator; otherwise (paused, completed, cancelled) it's **closed**. Either way the place loses its creator; the not-delivered submission records the creator and who voided it (`notDeliveredBy`). Closed places never count as creators (the brand's creator count counts distinct creators holding a place), whether closed by a void or by Complete Campaign. If a paused campaign is resumed (by the brand or an admin), places closed while it was paused reopen, up to the deliverables bought; if it's completed or cancelled instead, they stay closed and the deliverable is refundable. The creator who didn't deliver can't join that campaign again (`CONTENT_NOT_DELIVERED`).

Refusals: `NOT_AWAITING_DELIVERY` (the creator already delivered or it isn't approved), `NOT_VOIDABLE_YET` (under 14 days on a campaign that isn't cancelled), `NO_BRAND_DELIVERY` (creator-page campaign). Voiding twice is harmless.

> **Note for the lead:** for **both**, pay is only credited after the live post is confirmed, so content still awaiting delivery has no credit yet: voiding marks it not delivered and the panel reports "₦0 voided".

---

## 4a. Completing a campaign

Content campaigns never complete on their own, and views campaigns only complete when they reach their target. Complete one by hand when the brand wants to stop, or to open a content campaign's unused-budget refund.

**Who:** `admin`, `super_admin`, `finance_admin`. **When:** the campaign is `live` or `paused` (any campaign model).

1. **Campaigns** → **Inspect & Manage** → **Admin Actions**. Optionally type a note (it goes to the brand).
2. Press **Complete Campaign**. The dialog explains the effect; confirm.
3. Effect:
   - The campaign is `completed` (`completedAt` set). This can't be undone.
   - Places nobody took are **closed**: the campaign leaves the marketplace, and joins and applications are refused (`CAMPAIGN_NOT_LIVE`). A place still pointed at by a rejected creator's content stays open so an appeal decided later can give it back. Pending applications expire on the next hourly deadline run.
   - Creators who already hold a place keep it and can finish their work.
   - The brand gets a "Campaign completed" notification (for content campaigns it says unused budget will be refunded by our team).
   - The activity log records `campaign.completed` with the number of closed places.
   - Content campaigns: **Refund Unused Budget** becomes available (§5). Views and referral campaigns: completing refunds nothing.
4. Refusals: 409 `NOT_COMPLETABLE` for any other status; 403 for `support`.

The status route (`PATCH /admin/campaigns/:id/status` with `completed`) takes the same path.

## 5. Refunding unused budget

### Content campaigns (admin-issued, D5)

**Who:** `finance_admin`, `super_admin`. **When:** the campaign is `completed` or `cancelled`.

What's refundable (`utils/fixedPayRules.js`): deliverables bought that are **not** credited, **not** still able to earn (in review, changes requested, awaiting delivery / post, under appeal, rejected inside its 7-day appeal window, or voided pay whose payout appeal is open or can still be filed) and **not** already held by a pending or succeeded refund. Each is refunded at the brand's rate plus the platform fee charged on it, pro rata, rounded down to the kobo. **Paystack fees aren't deducted.**

Example: ₦15,000 × 10 deliverables = ₦150,000 creator budget + ₦45,000 fee = ₦195,000 paid. 6 completed, 4 unused → refund 4 × ₦15,000 + 4/10 of ₦45,000 = **₦78,000**.

1. **Campaigns** → open the content campaign → **Deliverables And Fixed Pay**. Check **Bought / Completed / Awaiting Delivery / In Progress / Unused / Refund Reserved**. If **Books Don't Balance** shows, stop and see §8.
2. If the campaign is still live or paused, end it first with **Complete Campaign** (§4a).
3. Press **Refund Unused Budget**. The modal shows Unused Deliverables, Creator Budget, Platform Fee On Them and the Refund. Confirm.
4. The request carries the amount you saw. If anything changed (a credit, an appeal), it's refused with `REFUND_CHANGED`; reload and confirm the new amount.
5. Read the outcome message and the refund's state (below). The brand is notified once Paystack has it; the attempt is logged (`campaign.unused_budget_refunded`).
6. Later, if more becomes unused (an appeal window closes, pay is voided), the button offers the new amount. You can refund again.

Refusals: `CAMPAIGN_NOT_FINISHED`, `NOTHING_TO_REFUND`, `REFUND_NEEDS_RETRY` (an earlier refund must be retried first).

### Hybrid campaigns: unused base and unused bonus pool (ticket 10)

A hybrid campaign pays a base per approved deliverable (fixed pay, exactly as above) plus a bonus from a pool the brand paid at checkout, with the fee on top of both (D2 amended). In **Campaigns** the budget, pool and fee are labelled **Base**, with **Bonus Pool / Bonus Fee / Bonus Left** beside them, and the content panel reads **Deliverables And Base Pay** with a **Bonus Pool** section (rate, cap, credited, paid out, owed, left, refunds).

- **Unused base:** **Refund Unused Budget**, as for any content campaign.
- **Unused bonus:** **Refund Unused Bonus** (finance / super admin). Allowed once the campaign is cancelled, or completed for a views bonus, or **7 days after completion** for a sign-up / download bonus (conversions still count in that window; refused with `CAMPAIGN_NOT_FINISHED` and the date). The modal shows Unused Pool, Platform Fee On It (pro rata, rounded down) and the Refund. Confirming claims the pool at once, so no more bonus can be earned from it; bonus already credited stays owed. Refusals: `REFUND_CHANGED` (a bonus was credited or voided since you loaded it; reload), `NOTHING_TO_REFUND`.
- A refused bonus refund shows **Failed** with **Retry Refund** beside it (also in **Refunds**). If the API crashed after claiming the pool but before writing the refund, pressing the button again (or the automatic refund job) sends that claim (reconciliation shows "refund the unused bonus again" until then).
- Sign-up / download bonuses use the brand's referral codes and your reward (§1). Setting the first reward pays earlier sign-ups from the bonus pool, oldest first, up to each creator's cap. Voiding a conversion in its hold gives its bonus back to the pool; if the API dies part-way, the 15-minute ops job finishes it (once).

### Automatic refunds (ticket 11)

**Off unless `AUTO_REFUNDS_ENABLED=true` is set on the API.** While it's off, **Overview** and **Refunds** show **Automatic Refunds Are Off**: refund ended campaigns by hand (above) and retry failed refunds from **Refunds** as usual; unsent rows a crash left behind aren't retried automatically either, so retry **Not Sent** refunds yourself. Switching it on is a deploy step (`DEPLOY_CHECKLIST.md` §11), because its first run refunds every campaign that ended in the last 90 days.

When on, an hourly job (`services/autoRefunds.js`) refunds unused budget on campaigns that ended in the last 90 days, through the same refund rows as above, with no Paystack fees deducted. You can still refund by hand first; the job then finds nothing left. Each automatic refund notifies the brand and is logged as `campaign.unused_budget_auto_refunded` by "Automatic refunds".

| Pot | When | What |
|---|---|---|
| Content base | As soon as the campaign is completed or cancelled, and again whenever more becomes unused | Unused deliverables × rate + the fee on them (as the button above) |
| Hybrid bonus pool | When **Refund Unused Bonus** would allow it, and no content on the campaign is under appeal or can still be appealed | Unused pool + its fee |
| Views | Cancelled: the cancel refund, if it never happened. Completed: 7 days after completion | Completed: only what no creator holding a place can still earn (each keeps their full place reward less what they were paid). Once per campaign |
| Referral budget | Cancelled: the cancel refund, if it never happened or a crash cut it short. Completed: 7 days after completion | The unearned pool grossed up by its fee. Once per campaign. Held while sign-ups wait for a reward (set it, §1) |

Refund rows left unsent by a crash are retried from themselves after 10 minutes. A refund Paystack refuses stays **Failed** for you to retry. Anything the job couldn't refund raises **Automatic Refund Failed** (§9a) until a run goes through. The job is skipped when `AUTO_REFUNDS_ENABLED` isn't `true` (log: `[AutoRefunds] Off`) or `PAYSTACK_SECRET_KEY` isn't set (log: `[AutoRefunds] Skipped`).

### Reading refund states

| Label | Meaning | What to do |
|---|---|---|
| **Refunded** | Paystack confirmed every part (`refund.processed` webhook, or processed immediately). | Nothing. |
| **Sent, Waiting For Paystack** | Paystack accepted every part; waiting for its webhook. Not retryable. | Wait. If it stays for more than a day, check the refund in the Paystack dashboard and the webhook deliveries. |
| **Not Sent** | At least one part never reached Paystack (for example "Couldn't check Paystack, try again", or a crash before sending). | **Retry Refund**. |
| **Failed** | Paystack refused a part, or the campaign changed while issuing. The error is shown. | Fix the cause if it's on Paystack's side, then **Retry Refund**. |

A refund is split across the brand's Paystack payments, newest first, never more than each payment has left.

### Why a retry can't refund twice

- **One row, reused.** A retry reuses the same refund row; it never creates a new one. A new refund is refused while any refund is retryable.
- **Budget held once.** Each refund reserves its deliverables and budget on the campaign in one conditional update. Credits and other refunds can't use them, and a retry of a failed row checks the deliverables are still unused before reserving them again (`NO_LONGER_REFUNDABLE` otherwise).
- **Send lock.** The update that reopens a row also takes a 5-minute send lock, so two admins pressing Retry at once get one send and one `REFUND_IN_PROGRESS`.
- **Sent parts are never resent.** A part with a send time or a Paystack refund id is skipped.
- **Crash after Paystack accepted.** Before sending a part, the API lists Paystack's refunds for that payment. A matching refund (same amount, not failed, created since the row, not recorded on another row) is adopted instead of sent again. If Paystack can't be checked, nothing is sent and the part stays Not Sent.

> **Notes for the lead:**
> - A part with no Paystack payment to refund against ("No Paystack payment on record to refund against") can't be retried: retries only reopen parts that have a payment reference. It has to be refunded by hand in Paystack, and the panel can't mark it done.
> - A refund stuck in **Sent** because the webhook never arrived can't be marked refunded from the panel.

### Views and sign-up / download campaigns (automatic on cancel)

When a views or referral campaign is **cancelled** (by the brand through the API, or by a `finance_admin` / `super_admin` in **Campaigns** → **Cancel Campaign**, reason required):

- **Views:** the unused part of the creator pool is refunded: the pool less payouts sent or in flight and less views withdrawals creators have requested. The platform fee isn't refunded.
- **Referral budget:** the pool no creator has earned is refunded, grossed up by the fee on it. Earned rewards stay for creators to withdraw.

Each happens once per campaign (a fixed reference). A failed part leaves the row `refund_failed` with a note "Refund failed: ₦… against <reference> (…)"; retry it from **Refunds** (finance / super admin). A retry reuses the row, so the books don't change.

Completing a views or referral campaign refunds nothing at once; the automatic refund job refunds what's unused 7 days later (above).

### Refunds screen

**Refunds** lists every refund with its budget (content, views, referral, bonus), amount, state and error. **Needs Attention** shows failed and unsent ones. **Retry Refund** (finance / super admin) resends only what never reached Paystack, after checking Paystack's own refunds, so it can't refund twice; two retries at once get one send and `REFUND_IN_PROGRESS`. A part with no Paystack payment can't be retried (`REFUND_BY_HAND`).

### Cancelled campaigns are only deleted when nothing depends on them

`utils/cleanupCancelled.js` runs every hour and deletes a campaign that has been `cancelled` for 24 hours **only if it has no payments, withdrawals, placements taken by a creator, content, applications, referral codes or conversions**. Everything else stays cancelled for good, so refunds, fixed pay owed, appeals, voids and reconciliation keep working after cancellation. **Delete Campaign** (admin) and the brand's delete follow the same rule and refuse otherwise (409 `CAMPAIGN_HAS_RECORDS`, "…can't be deleted. It stays cancelled.").

---

## 6. Weekly payout run

Creators withdraw once per campaign per payout week. A week runs Friday 00:00 to Thursday 23:59, Lagos time; everything requested in it is due on the Friday that ends it. The minimum is ₦2,000 per campaign. One withdrawal carries the campaign's views, referral and fixed pay together.

**Who:** `finance_admin`, `super_admin`. Other roles see the screens with the pay and reject buttons disabled.

### Before the run (Friday)

1. In Paystack: transfers must **not** require OTP (Settings → Preferences). With OTP on, every transfer is reverted with a message saying so.
2. **Weekly Payout Run** shows what's due: withdrawals requested before this payout week began, grouped by campaign and brand, with each pot's escrow, estimated Paystack fees, the total, the Paystack balance and what's already queued for next week.
3. Fund the Paystack balance if it doesn't cover the total. The run refuses a batch the balance can't cover (`INSUFFICIENT_PAYSTACK_BALANCE`).

### Run it

4. Select the withdrawals (up to 200 per run) and approve. Each one is paid on its own:
   - It's claimed first, so it can't be paid twice by two admins.
   - **Fixed pay is checked again:** only credits whose content is delivered and past its 7-day hold are paid. Anything else is cut from the withdrawal with a note ("Fixed pay capped at payout…"). If nothing is payable, it stays pending (`FIXED_PAY_NOT_ELIGIBLE`).
   - Each pot must have the money in escrow; otherwise it stays pending with "Insufficient funds in this campaign's …".
   - A creator with no bank account stays pending.
5. Read the result: **paid**, **processing** (Paystack accepted and is still sending), **failed** (with the reason per line), **skipped** (not due).
6. To reject a line, use its reject action with a note. The creator is notified.

### Failed and stuck transfers

| What happened | State | What to do |
|---|---|---|
| Paystack refused the transfer (4xx) | Released escrow, back to **pending** | Fix the cause (bank details, balance) and approve again, or leave it for next week. |
| OTP required, or an unexpected Paystack status | Reverted, back to **pending** | Turn OTP off / check Paystack, approve again. |
| Timeout or Paystack 5xx | Stays **processing** | **Don't send it again.** The reconcile job checks it with Paystack. |
| `transfer.failed` / `transfer.reversed` webhook | Reverted, back to **pending** | Approve again next run. |

The payout reconcile job runs every 30 minutes and checks withdrawals stuck in processing for more than 20 minutes against Paystack: settled if Paystack sent it, back to pending if it didn't. It's skipped entirely if `PAYSTACK_SECRET_KEY` isn't set (log: `[Reconcile] Skipped`). Approving a withdrawal whose previous attempt is unresolved also checks Paystack first and never sends twice.

To run the check now (**API only**, no panel button; `finance_admin` / `super_admin`):
```bash
curl -X POST "$API/admin/payouts/reconcile" -H "Authorization: Bearer $TOKEN"
```
It returns `checked / settled / failed / stillPending / unknown`.

**Withdrawal Requests** lists every withdrawal by status (pending, processing, rejected, released) with each pot's escrow, for one-off reviews.

---

## 7. Unmatched payments

A payment Paystack collected that couldn't be applied is recorded once as an `unmatched_payment` ledger row with status `under_review` and never counts toward escrow. Causes (`routes/webhooks.js`): wrong currency on a top-up or referral top-up; a campaign payment that doesn't match the expected amount or isn't NGN (the campaign stays unpaid); a payment that arrived after the campaign moved on or for a campaign that no longer exists.

1. Find them: **Payouts & Escrow** lists all ledger rows including type `unmatched_payment`. There's no filter; query directly if needed:
   ```js
   db.transactions.find({ type: "unmatched_payment" }).sort({ date: -1 })
   ```
   The `adminNotes` field says why, e.g. "Payment arrived while the campaign was "live". Paid 195,000 NGN. Refund it in Paystack or apply it manually."
2. Look up the `reference` in the Paystack dashboard.
3. Refund it in Paystack, or talk to the brand.

> **Note for the lead:** the panel can't refund, apply or close an unmatched payment; the row stays `under_review` for good. Keep a record of what was done outside the product.

---

## 8. Reconciliation

For every campaign with money on record, per pot (views, referral, fixed), to the kobo:

`paid in = released + in flight + owed to creators + platform fee kept + refunds + refunds pending + left in the pools`

The fee, per-creator payouts and content refunds are also checked on their own.

### Run it

- **One content campaign:** **Campaigns** → the campaign → **Deliverables And Fixed Pay** shows **Books Don't Balance** with the problems, or nothing when it balances.
- **Every campaign** (read-only: it never writes, builds an index or creates a collection; from a checkout of the release with `npm ci` done in `Backend/`):
  ```bash
  cd Backend
  MONGODB_URI="<production connection string>" node scripts/reconcileCampaigns.js        # failures only
  MONGODB_URI="<production connection string>" node scripts/reconcileCampaigns.js --all  # every campaign
  ```
  Exit code 0: all balance. 1: at least one doesn't. 2: couldn't run.

Output per failing campaign:
```
FAIL <campaignId> <name> (<status>)
     paid in ₦… = released ₦… + in flight ₦… + owed ₦… + fee ₦… + refunds ₦… + refunds pending ₦… + left ₦…
     - <problem>
```

### What a mismatch means

| Problem text starts with | Meaning | First step |
|---|---|---|
| `views: the campaign records a … fee` / `… creator pool` | The campaign's stored fee or pool doesn't match 30% of what was paid in. | Compare the campaign's budget with its deposits and top-ups. |
| `views: payouts … and refunds … exceed the creator pool` | More left the views pot than the pool held. | Stop paying that campaign; list its release and refund rows. |
| `<pot>: creator … was paid ₦…, more than the ₦…` | A creator was paid more than they earned. | Stop paying that creator on that campaign; check their withdrawals. |
| `referral: paid in … but the referral budget is …` / `conversions reserved … but the campaign records … earned` | Referral counters disagree with the ledger or conversions. | Check top-ups and voided conversions. |
| `referral: refunds … don't match the unused pool` | The cancel refund isn't the unused pool plus its fee. | Check the referral refund row. |
| `fixed: paid in … but the creator budget plus fee is …` | The content payment doesn't match rate × deliverables + fee. | Check the payment and any unmatched payment. |
| `fixed: credits in the ledger total …` / `… credit rows don't match …` / `a submission is credited more than once` | Fixed credits and the campaign's reservation disagree. | Escalate to engineering before paying or refunding. |
| `fixed: refund … is ₦… but … unused deliverables refund ₦…` / `… deliverables refunded but only … are unused` | A refund doesn't follow the formula or refunded work that isn't unused. | Escalate. |
| `fixed: the refunds holding budget … don't match …` | A refund was interrupted between writing and reserving. | Retry the pending refund (§5). |
| `fixed: this content campaign's payment was booked to the views pot` | The payment went to the wrong pot, so fixed pay can't be paid from it. | Escalate. |
| `paid in ₦… but ₦… is accounted for` | The totals don't add up. | Read the other problems on the same campaign first. |

Not counted in the balance, reported separately in the result: unmatched payments, Paystack transfer fees (covered by the platform fee) and failed content refunds (they moved nothing).

---

## 9. Background jobs and how to tell they're stuck

All jobs run inside the API process (`Backend/src/server.js`), start at boot and repeat on a timer. They only run while the API is up. With more than one API instance, each runs them; every step is guarded, so duplicates are safe.

| Job | Every | Does |
|---|---|---|
| Content deadlines (`startContentAutoApprove`) | 15 min | On content campaigns, anything waiting on the brand for 72 hours: approves content in review (not on cancelled campaigns), confirms receipts, confirms live posts. Up to 500 per run, oldest first. |
| Application deadlines (`startApplicationDeadlines`) | 1 hour | Expires pending applications after 7 days or when the campaign is completed / cancelled; reminds each brand once about applications waiting 3+ days; puts approvals that never got a place back to pending (10 minutes to 2 days after approval). |
| Payout reconcile | 30 min | §6. |
| Ops alerts (`startOpsAlerts`) | 15 min | §9a. Also retries stranded referral back-pay, accrues views bonuses and returns voided bonuses a crash left unreturned. |
| Automatic refunds (`startAutoRefunds`) | 1 hour | §5 Automatic refunds. Logs: `[AutoRefunds] … refunds, … retried, … campaigns with problems`. |
| Cancelled cleanup | 1 hour | Deletes campaigns cancelled for 24 hours that have no records (§5). |
| TikTok / Meta view sync | 15 min | Views on posts; completes views campaigns that reach their target. |
| Rank recalculation | 24 hours | Creator ranks, score, completion and badges (M8). Also at API start. Logs: `[Rank] Recalculated … badgesGained=… badgesLost=…` and `[Badges] <userId> gained=… lost=…`. |

### Is content auto-approval stuck?

Should be 0 (allowing one run of slack):
```js
const cutoff = new Date(Date.now() - (72 * 60 + 30) * 60 * 1000);
db.submissions.countDocuments({
  status: { $in: ["new", "awaiting_receipt", "verifying"] },
  awaitingBrandSince: { $lte: cutoff },
})
```
Content on a cancelled campaign in `new` is skipped by design; exclude those campaigns before worrying. Logs to search: `[Content] Deadline run failed`, `[Content] Auto-confirm failed for submission`.

### Is application expiry stuck?

Should be 0:
```js
db.campaignapplications.countDocuments({
  status: "pending",
  appliedAt: { $lte: new Date(Date.now() - (7 * 24 + 2) * 60 * 60 * 1000) },
})
```
Logs: `[Applications] Deadline run failed`, `[Applications] Expired N, reminded brands about N`, `[Applications] Application … was approved without a place; back to pending`.

### Fixed pay that became due but wasn't credited

If a campaign's creator budget is used up when pay falls due, the credit is skipped and logged: `[FixedPay] No creator budget left to credit submission …`. Find them:
```js
db.submissionevents.find({ type: "fixed_pay_due", "metadata.credited": false })
```
Completion retries the credit once (`[Content] Fixed pay repair failed …` if that fails). Escalate any you find: the creator is owed pay the campaign can't cover.

If a job isn't running at all (no log lines from it), restart the API. There's no admin control for jobs.

---

## 9a. Ops alerts

The ops alerts job (`services/opsAlerts.js`) runs every 15 minutes inside the API and records problems nobody would otherwise notice. Open alerts show in **Needs Attention** on the admin **Overview** (the badge counts every open alert, even past the 200 listed) and are emailed to `OPS_ALERT_EMAIL` (comma-separated addresses). Without `OPS_ALERT_EMAIL` they only show in the panel.

| Kind | Title | Raised when | Link |
|---|---|---|---|
| `payout_failed` | Payout Transfer Failed | A withdrawal is back in the queue (pending) and every release row of its latest transfer failed. Failures from the last 30 days are found; one already alerted keeps being checked however old. | Withdrawals |
| `withdrawal_stuck` | Withdrawal Stuck In Processing | A withdrawal has been processing for more than 24 hours. | Withdrawals |
| `refund_stuck` | Refund Not Completed | A views, referral, fixed or bonus refund is pending, failed or unsent more than 1 hour after it was created. | The campaign |
| `auto_refund_failed` | Automatic Refund Failed | The automatic refund job couldn't refund an ended campaign (Paystack refused, an earlier refund needs a retry, sign-ups wait for a reward). Resolves when a run for that campaign goes through. | The campaign |
| `webhook_failing` | Conversion Webhooks Failing | 5+ rejected conversion webhooks for one brand in the last hour. | Referrals |
| `paystack_webhook_failing` | Paystack Webhooks Failing | 3+ Paystack webhooks failed to process in the last hour. Each processing failure (the handler threw; not a bad signature) is recorded in `paystackwebhookfailures` (kept 30 days) with the event, reference and error. Paystack retries them; check the API logs. | Payouts & Escrow |
| `content_deadline_stuck` | Content Deadline Not Processed | Content has waited on the brand for more than 73 hours (the 72-hour job plus an hour). | The campaign |
| `application_expiry_stuck` | Applications Not Expired | Applications pending more than 7 days and 2 hours. | The campaign |
| `views_submission_stuck` | Views Posts Not Shared | Views content on a live or paused campaign approved more than 7 days ago whose creator never shared the live post (`awaiting_post`). Once the campaign is completed or cancelled the alert resolves. | The campaign |
| `reconciliation_mismatch` | Campaign Books Don't Balance | A campaign's books don't balance (§8). Checked on every run for campaigns with money movement in the last 48 hours and for every campaign already flagged (whatever its age or status), and once a day for every live, paused or recently finished campaign with money. The daily pass is recorded in the database (`jobstates`), so restarting the API doesn't repeat it. | The campaign |

"The campaign" links open **Campaigns** with that campaign's detail (`/campaigns?open=<id>`).

**How an alert lives:**
- One open alert per kind and subject. Seeing the problem again updates its message; it isn't duplicated.
- It **resolves by itself only when its subject is checked again and the problem is gone.** A campaign that drops out of the recent-money window, or a failed payout older than 30 days, stays open until it's actually re-checked and fine.
- **Resolve** (admin, super admin, finance admin) marks it handled. If the problem is still there, it **reopens and is emailed again** when the problem really changes: a different amount or status on a withdrawal or refund, another failed transfer on the same withdrawal, a count of stuck items or failed webhooks roughly doubling, or for a reconciliation mismatch a different kind of mismatch or a discrepancy of a different order of magnitude (money moving on the campaign doesn't count) or **24 hours after it was resolved**, whichever comes first. The panel shows **Reopened**.
- If the problem clears and comes back later, that's a new alert.
- An alert is marked emailed only once the email went out. A failed send is retried on the next run (log: `[OpsAlerts] Alert email failed`).

---

## 9b. Per-view price table (ticket 11)

**Who:** every admin role can look; `finance_admin` and `super_admin` change it. **Where:** **Price Table**.

The table is what brands pay for views: each tier is a number of views and its price, and a quote between two tiers is worked out along the line between them (above the last tier, the last segment's slope continues). Tier 1 also sets a hybrid views bonus: creators get the creator's share (70% at the standard 30% fee) of tier 1's price per 1,000 views.

1. **Price Table** → **Edit Prices**. Change views or prices, **Add Tier**, **Remove**, or **Use Standard Table** to go back to the defaults.
2. Problems show under the table as you type: 2 to 20 tiers; views at least 1,000 and rising; prices above ₦0 and rising; and the price per view never higher than the tier before.
3. Say why prices are changing (required; it goes in the activity log), then **Save Prices** and confirm in the dialog.
4. Refusals: `INVALID_TIERS` (the message names the tier), `NOTE_REQUIRED`, `NO_CHANGE`, and `PRICE_TABLE_CHANGED` when someone else saved since you opened the screen (it reloads; make the change again).

What a change does and doesn't do:
- New views quotes, new campaigns and drafts whose views change use it at once. Other API instances pick it up within a minute.
- **Paid campaigns never change:** a campaign keeps the budget and cost per view it was saved and paid at, and top-ups keep using the campaign's own cost per view.
- A draft saved before the change keeps its saved price until the brand changes its views.
- **Hybrid campaigns keep the views-bonus rate stored when they were set up**; hybrid campaigns set up afterwards get the new tier 1 rate.
- **Industries** cost-per-view rates are separate and unchanged.
- Each save is versioned and logged as `pricing.view_tiers_updated` with the tiers before and after (**Activity Log** → Price table). **Changes** on the screen lists the last 20. To undo, save the old tiers again (or **Use Standard Table**).

---

## 9c. Load test findings support may hear about (ticket 11)

Engineering load tested the marketplace, join, apply and approve (`docs/campaign-engine/LOAD_TEST.md`). What changed for creators and brands:

- **The 3 active placements limit now holds when a creator joins several campaigns at the same moment** (for example tapping Join on several cards quickly). Before, all of them could go through; now the first three stand and the rest are refused with "You have 3 active placements. Finish one to join another". The same applies when brands approve several of one creator's applications at once: an approval past the limit is refused as "This creator can't take a place right now", and the application stays pending.
- **Marketplace changes show on the creator's next load**: a campaign that goes live, is paused or completed, or has its details edited. Places left are always current.
- **Brand-page delivery stays a download link.** The planned original-file upload was dropped (storage is Cloudinary, 100 MB max). If a brand can't open a link, ask the creator to share a new link that anyone with the link can open. Until the brand confirms receipt the creator can replace the link from their campaign page, which gives the brand a fresh 72 hours.

---

## 10. Things the admin panel can't do yet

| Task | Do it this way |
|---|---|
| Check stuck payouts now | API: `POST /api/admin/payouts/reconcile` (§6) |
| Run reconciliation for all campaigns | `node scripts/reconcileCampaigns.js` (§8) |
| Refund, apply or close an unmatched payment | Paystack dashboard; record it elsewhere (§7) |
| Mark a refund part with no payment reference as refunded | Paystack dashboard (§5) |
| Mark a Sent content refund as refunded, or refund a part with no payment reference | Paystack dashboard; can't be recorded in the panel (§5) |
| See whether jobs are running | API logs and the database queries in §9 |
| Appeal a voided conversion | Not a feature; disputes go through support (§3a) |

---

## Notes for the lead: where the code and the plan disagree

The code wins in this runbook; these need a decision or a fix. Resolved on `m7/launch-fixes` and removed from this list: cancelled campaigns being deleted with their records (§5), no way to end a content campaign from the panel (§4a), no verification screen (§2; there's still no creator request flow, see item 3), money actions open to `support` and `finance_admin` unable to set rewards (§0), voided pay keeping the placement active (§4), and budget-exhausted conversions never paid after a top-up (§1).

1. ~~D5 says refunds are "minus Paystack fees"~~: D5 amended, no fees deducted (ticket 11's wording still says "minus"). Originally: **the code doesn't deduct them** (content, views and referral alike). The comment in `fixedPayRules.js` says D5 is being amended.
2. **D8 says interests rank creators; they don't.** The Match Score uses audience location, age and gender only. Interests are stored and ignored.
3. **Verification (D13) has no creator request flow or ID upload**; the identity check happens outside the product.
4. **What `support` should be able to do** needs a decision: it can still change campaign status (except complete and cancelling a paid campaign), delete record-free campaigns, decide content appeals and verify creators, but not resolve alerts or move money.
5. ~~Payout appeals don't exist~~: built (§3a). Voided conversions still can't be appealed.
6. **Referral codes in content captions:** `markContentPosted` checks the caption for the creator's referral code when referral tracking is on, but content campaigns never have referral tracking, so the check doesn't run today.
7. ~~Views and referral refunds can't be retried~~: retried from **Refunds** (§5), which shows the error. A refund part with no payment reference still can't be retried.
8. ~~Leftover escrow on a completed views campaign has no refund path~~: the automatic refund job refunds untaken places 7 days after completion (§5). Money held for a placed creator who under-delivered stays in escrow.
9. **The glossary's "Hold" (7 days) doesn't apply to views earnings**: views earnings are withdrawable as soon as they're earned while the campaign is live, paused or completed. Fixed pay and referral rewards have the 7-day hold.
10. **Views posts that stop syncing aren't alerted**: submissions have no per-post view sync time, so `views_submission_stuck` only covers approved content whose post link was never shared (§9a).
11. **D10 was extended in code:** besides content review, brand-page receipts and live-post checks are confirmed automatically after 72 hours.
12. **`docs/referral-tracking-plan.md` Phase 6 says the brand sets the reward per conversion**; ADR 0003 and the code have our team set it.
13. **Roadmap M6 lists a "stuck-payment queue" in admin**; there isn't one beyond the **Withdrawal Requests** processing filter and the reconcile job.
14. The older **Verifications** screen still uses `alert()` for errors, against the in-app modals rule (so do parts of **Campaigns**, **Users & Creators** and **Referrals**). **Appeals Inbox** decides content appeals without it.
