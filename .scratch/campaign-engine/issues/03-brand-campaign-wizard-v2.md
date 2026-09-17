# 03: Brand campaign wizard v2

**What to build:** A brand creates and pays for a Content, Views or Sign-ups campaign in five steps: objective & model → destination & access → targeting & eligibility → pay & budget → brief. The pay step only asks the brand for what the brand controls, and the summary shows exactly what they'll be charged.

**Blocked by:** 02

**Milestone:** M2 · track A · 5 – 16 Oct

**Status:** ready-for-agent

## Corrections from the first draft

- Build in the `web` app's brand dashboard, replacing the current create-campaign flow; the standalone `brand` app is a stale copy.
- Checkout already exists as one Paystack payment covering views and referral budget, with connect-before-pay for sign-up campaigns. Extend it; don't build a second checkout.
- **Moved to ticket 11 (after launch):** live "about N creators match" count. **Moved to ticket 10:** Hybrid pay.
- Engagement, Leads, Sales and Other objectives show as "Coming soon".

## Acceptance criteria

- [ ] Step 1: objective picker; unsupported objectives are visible but marked "Coming soon"
- [ ] Step 2: content destination (creator page / brand page / both) with the standard usage-rights text for brand page and both (D6); creator access with a plain explanation of Open Call vs Application Required
- [ ] Step 3: audience targeting and creator eligibility fields
- [ ] Step 4 follows rate authority: Content → brand enters ₦ per approved deliverable and number of deliverables; Sign-ups → brand enters a budget and sees "Reward per sign-up is set by our team"; Views → price from the price table, as today
- [ ] Step 4 summary shows creator budget, performance budget, platform fee and total, from the shared budget calculator
- [ ] Step 5: brief, do's and don'ts, hashtags, sound, reference videos, tone, key messages, product info, approval requirements
- [ ] Paying a content campaign charges exactly the summary total and takes the campaign live, like views campaigns today
- [ ] Sign-up campaigns still can't be paid until the brand's app is connected
- [ ] Drafts save and resume across all five steps
- [ ] End-to-end test: create and pay for one content, one views and one sign-ups campaign; amounts match the calculator to the kobo
