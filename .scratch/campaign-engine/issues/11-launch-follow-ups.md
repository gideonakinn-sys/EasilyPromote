# 11: Launch follow-ups

**What to build:** The smaller features moved out of the two-month launch window, shipped before the holiday freeze (21 Dec).

**Blocked by:** General launch (17 Nov); each item's own blocker noted below

**Milestone:** M7b · 18 Nov – 18 Dec

**Status:** needs-triage — split into separate tickets before starting

## Acceptance criteria

- [x] Trending section on the marketplace: most joins and applications in the last 72 hours (after 04)
- [x] Wizard shows a live "about N creators match" count while setting targeting and eligibility (after 03)
- [x] ~~Brand-page delivery accepts the original video file (resumable upload, up to 500 MB) as well as a link (after 07)~~ Dropped 17 Sep: storage is Cloudinary (100 MB max); delivery stays a download link
- [x] Unused budget is refunded automatically at campaign end (after 09). Paystack fees are **not** deducted (D5 amended); see SPEC D5 (automatic)
- [x] Brand payment statement: deliverables paid, performance paid, fee, refund (after 09), per campaign and overall, with CSV
- [x] Admin screen for the per-view price table (existing per-industry rates keep working)
- [x] Engagement, Leads, Sales and Other objectives leave "Coming soon" where tracking exists: Leads and Sales are open; Engagement and Other stay Coming soon (SPEC, ticket 11 rows)
- [x] Load test on marketplace, join, apply and approve: results, fixes and known limits in `docs/campaign-engine/LOAD_TEST.md`

## D23 items (built with the money follow-ups)

- [x] Retry failed views, referral and bonus refunds from the admin panel (finance / super admin; never refunds twice)
- [x] Payout appeals: a rejected withdrawal or voided undelivered pay, within 7 days; grants by finance / super admin only
- [x] One admin inbox for content and payout appeals, with filters, notes, audit log and creator notifications
- [x] Repaired: a sign-up bonus void interrupted by a crash is returned to the pool by the ops job

Automatic refunds are off until `AUTO_REFUNDS_ENABLED=true` (SPEC D5 (switch), DEPLOY_CHECKLIST §11).

## M7b items (built on main)

- Trending: `services/trending.js`, in the marketplace request; tests `creator-marketplace.test.js`, `unit/recommendations.test.js`
- Live match count: `POST /api/campaigns/match-count`, `services/creatorMatchCount.js`; tests `match-count.test.js`, `unit/creatorMatchCount.test.js`
- Price table: admin **Price Table**, `routes/adminPricing.js`, `models/PriceTable.js`, `config/pricing.js`; tests `admin-pricing.test.js`, `unit/campaignBudget.test.js`
- Leads and Sales: `lead` conversion event, `utils/campaignObjectives.js`; tests `referral-join-paths.test.js`, `launch-matrix.test.js`
- Load test: `npm run load-test` (`scripts/loadTest/`, local only); fixes: marketplace loading (`services/creatorDashboard.js`), the 3 active placements limit under concurrent joins (`services/placements.js`), JWT key reuse (`utils/jwt.js`); tests `creator-marketplace.test.js`, `open-call-join.test.js`, `unit/jwt.test.js`, `unit/loadTestSafety.test.js`
- Brand-page file upload: dropped 17 Sep (storage is Cloudinary, 100 MB max); delivery stays a download link (SPEC D12 (dropped))

Decisions: SPEC.md rows D5 (automatic), D5 (switch), D23 (built), Ticket 11 statement, D4 (repaired), and the Ticket 11 rows for Trending, the live match count, the price table, Leads and Sales, Engagement and Other. Code: `Backend/src/services/autoRefunds.js`, `payoutAppeals.js`, `appealsInbox.js`, `brandStatement.js`, `utils/refunds.js`; tests: `test/e2e/auto-refunds.test.js`, `refund-retries.test.js`, `payout-appeals.test.js`, `brand-statement.test.js`.
