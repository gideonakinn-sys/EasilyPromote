# Budget-first campaign flow — implementation plan

Diagram and roadmap page: https://claude.ai/artifact/PtRjzsUrJutM6egHB2XZZ8

## Decisions (agreed)

- **Brands set views and a referral budget.** Target views work exactly as today (price follows the tier table). For an action goal (sign-ups, downloads, purchases, deposits) the brand enters one referral budget. Brands never set the reward per sign-up.
- **Admin sets the reward per sign-up** after the campaign is live, and can change it later (new sign-ups only). Brands can't change it.
- **Sign-ups before a reward exists** are recorded and paid once the reward is set, oldest first, while the budget lasts.
- **Connect before paying.** A referral campaign can't be paid for until the brand's own server has sent a signed code check and a signed conversion (test or real). Our dashboard's test sender never counts. Verification is per brand and reused by every later campaign.
- **One payment.** One Paystack checkout covers the views price and the referral budget. The campaign goes live right after payment, as today.
- **Paystack can't hold money**, so everything that can block a campaign is checked before payment. After payment the only way back is a Paystack refund.
- **30% platform fee is inside each budget** ("creators get ₦…"), as today.
- **Brands can add referral budget later**; admin keeps or updates the reward.
- **Weekly, per-campaign withdrawals.** Once a week per campaign; views and referral earnings (past their 7-day hold) together in one transfer, recorded against each pot separately.
  - Payout day: **Friday**, for requests made by end of Thursday.
  - Minimum per campaign withdrawal: **₦2,000**; smaller amounts carry over.
  - **Paystack's transfer fee is covered by our platform fee** and recorded on the campaign, so creators receive exactly what they see.

## Working rules

- Build on `feature/budget-first-flow`. Existing live campaigns and payouts must keep working at every step.
- Test only against a throwaway local MongoDB (`mongod` on a scratch dbpath). Never the database in `Backend/.env`.
- End-to-end scripts stub `services/paystack` before requiring `src/app`.
- Match existing code style; confirmations are in-app modals, never `alert()` / `window.confirm()`.

## Phases

### P1 — Honest connection check
- [x] Brand verification record: `referralVerification.codeCheckAt`, `conversionAt`, `verifiedAt`
- [x] Requests from the dashboard test sender never count toward verification
- [x] Notification + socket event (`referral-verified`) when a brand becomes verified
- [x] `GET /api/referral/status` returns `verified` and the two checks
- [x] Referral screen: plain-language "How referral tracking works", two-step checklist, "Send to your developer"
- [x] Backfill script from the request log for brands already sending real requests
- [x] End-to-end test

### P2 — Wizard with a referral budget
- [x] Campaign fields: `objective` (views | actions), action type (`referral.eventType`), `referral.requestedBudget`, `paymentAmount`
- [x] Brands can't set `rewardPerConversion` on create/edit or the referral settings route (ignored)
- [x] Wizard: Setup → Brief → Goal → Launch; view picker unchanged; referral budget with "creators get ₦…"; no reward input, no code-source choice
- [x] Review shows views price + referral budget = total

### P3 — Connect before paying, one payment
- [x] `POST /campaigns/:id/pay` returns 409 `INTEGRATION_REQUIRED` for an action-goal campaign from an unverified brand (and 400 without a referral budget); referral budget top-ups need a connected app too
- [x] One checkout for views price + referral budget; webhook and status check book the views deposit and credit the referral pot after amount/currency match
- [x] Launch step shows the connect checklist in place of Pay until verified; dashboard cards say "Connect your app to launch"
- [x] Campaign page: "Being set by our team" until admin sets the reward

### P4 — Admin sets the referral reward
- [x] `PATCH /api/admin/referrals/campaigns/:id/reward` (admin/super_admin; changes apply to new sign-ups), activity log
- [x] When first set, pay earlier unpaid sign-ups oldest first while the pool lasts (fresh 7-day hold)
- [x] Admin "Needs a reward" filter, overview callout, and Set reward dialog with a pool ÷ reward calculator
- [x] Notify brand and creators

### P5 — Weekly per-campaign withdrawals
- [x] One withdrawal per creator per campaign per payout week (Friday–Thursday, Lagos time), views + referral together, ₦2,000 minimum; older kind + amount requests still work, capped to that part
- [x] One transfer per campaign withdrawal, split into views and referral release rows sharing `transferReference`; Paystack fee recorded as a `transfer_fee` row on the campaign
- [x] Admin Weekly Payout Run page (`/payout-run`), grouped by campaign and brand; failed transfers go back to pending for the next run
- [x] Creator wallet lists each campaign with views, referrals, hold, state and payout day

### P6 — Rollout
- [x] Existing campaigns keep their current reward; brands already sending real requests can be backfilled as connected
- [ ] Run `checkUniqueIndexConflicts.js` and `backfillReferralVerification.js` against production before deploy
- [ ] Paystack: refund webhooks on; keep balance for Friday payouts; confirm the transfer fee field (fees are estimated from Paystack's NGN tiers until then)
- [ ] Update the public developer docs page and `referral-tracking-plan.md`
