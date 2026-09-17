# 09: Fixed pay payouts and a clear money trail

**What to build:** Creators on content campaigns get paid their fixed rate at the right moment, see it in their wallet next to any performance earnings, and withdraw it in the existing weekly payout. Every naira paid in is accounted for.

**Blocked by:** 07

**Milestone:** M6 · 2 – 6 Nov (both engineers)

**Status:** ready-for-agent

## Corrections from the first draft

- Weekly per-campaign withdrawals (Friday payout, ₦2,000 minimum, 7-day hold, Paystack transfer, admin payout run) **already exist**. Fixed pay feeds into them; no new payout pipeline.
- Performance payouts on verified views and on conversions already exist.
- **Moved to ticket 10:** Hybrid payouts. **Moved to ticket 11:** automatic refunds and the brand statement. At launch, admin issues refunds.
- Paystack can't hold money: all of a campaign's money is collected at checkout, so payouts only ever draw down from what was paid.

## Acceptance criteria

- [ ] Fixed pay is credited when D1 says: on approval for brand-page delivery; once the post is verified live for creator page / both
- [ ] Crediting fixed pay reserves from the campaign's creator budget atomically; it can never pay more deliverables than were bought
- [ ] Creator wallet shows each campaign with fixed pay, performance pay and referral pay separately, plus hold and payout day
- [ ] Fixed pay goes out in the existing weekly withdrawal together with any other earnings from that campaign
- [ ] Admin can refund a campaign's unused budget; the refund is logged and reduces what's left to pay out (D5)
- [ ] Every money movement (deposit, fee, credit, withdrawal, refund) has an audit entry
- [ ] Reconciliation check: for every campaign, paid in = creator payouts + fees + refunds + what's left, to the kobo
- [ ] End-to-end test: content campaign paid → creator joins → content approved → fixed pay credited → weekly withdrawal → reconciliation passes
