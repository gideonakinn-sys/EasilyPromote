# 11: Launch follow-ups

**What to build:** The smaller features moved out of the two-month launch window, shipped before the holiday freeze (21 Dec).

**Blocked by:** General launch (17 Nov); each item's own blocker noted below

**Milestone:** M7b · 18 Nov – 18 Dec

**Status:** needs-triage — split into separate tickets before starting

## Acceptance criteria

- [ ] Trending section on the marketplace: most joins and applications in the last 72 hours (after 04)
- [ ] Wizard shows a live "about N creators match" count while setting targeting and eligibility (after 03)
- [ ] Brand-page delivery accepts the original video file (resumable upload, up to 500 MB) as well as a link (after 07)
- [x] Unused budget is refunded automatically at campaign end (after 09). Paystack fees are **not** deducted (D5 amended); see SPEC D5 (automatic)
- [x] Brand payment statement: deliverables paid, performance paid, fee, refund (after 09), per campaign and overall, with CSV
- [ ] Admin screen for the per-view price table (existing per-industry rates keep working)
- [ ] Engagement, Leads, Sales and Other objectives leave "Coming soon" where tracking exists
- [ ] Load test on marketplace, join, apply and approve

## D23 items (built with the money follow-ups)

- [x] Retry failed views, referral and bonus refunds from the admin panel (finance / super admin; never refunds twice)
- [x] Payout appeals: a rejected withdrawal or voided undelivered pay, within 7 days; grants by finance / super admin only
- [x] One admin inbox for content and payout appeals, with filters, notes, audit log and creator notifications
- [x] Repaired: a sign-up bonus void interrupted by a crash is returned to the pool by the ops job

Decisions: SPEC.md rows D5 (automatic), D23 (built), Ticket 11 statement, D4 (repaired). Code: `Backend/src/services/autoRefunds.js`, `payoutAppeals.js`, `appealsInbox.js`, `brandStatement.js`, `utils/refunds.js`; tests: `test/e2e/auto-refunds.test.js`, `refund-retries.test.js`, `payout-appeals.test.js`, `brand-statement.test.js`.
