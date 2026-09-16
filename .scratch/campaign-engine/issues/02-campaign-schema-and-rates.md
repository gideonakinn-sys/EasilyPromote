# 02: Campaign v2 — models, pay shapes, rate authority, eligibility

**What to build:** A campaign can describe everything in the Flow Review: its campaign model (content or performance), objective, pay shape, who sets the creator rate, content destination, creator access, audience targeting, creator eligibility and a rich brief. The API enforces who may set which rate, one budget calculator prices every campaign, and one eligibility check says whether a creator qualifies and why not. Every existing campaign keeps running exactly as before.

**Blocked by:** 00

**Milestone:** M1 · 21 Sep – 2 Oct (both engineers)

**Status:** ready-for-agent

## Corrections from the first draft

- **Additive only.** The existing `objective` (views | actions) and `referral` fields stay; live campaigns, the admin panel and the payout code read them. New fields sit beside them.
- **Two of three rate authorities already exist**: views are priced by the EasilyPromote price table (with per-industry overrides), and admin sets the sign-up reward. This ticket adds the brand-set content rate and puts all three behind one rule.
- **Hybrid is modelled but not sellable at launch.** The schema allows it; creating a Hybrid campaign is switched off until ticket 10.
- Existing campaigns are migrated to: performance model, views metric, open call access.

## Acceptance criteria

- [ ] Campaign stores campaign model, objective (Content, Views, Engagement, Downloads, Sign-ups, Leads, Sales, Other), pay shape, base pay, number of deliverables, performance metric and rate, rate authority, content destination and creator access
- [ ] Campaign stores audience targeting (locations with minimum %, age ranges, genders, interests, platforms) and creator eligibility (minimum followers, minimum engagement %, categories, verified only, minimum rank, required badges)
- [ ] Brief stores do's, don'ts, hashtags, sound link, reference videos, tone, key messages, product info and approval requirements
- [ ] Rate authority is enforced on create, edit and admin routes: a brand-supplied rate is rejected where the brand doesn't own the rate (sign-ups, views)
- [ ] One budget calculator returns creator budget, performance budget, platform fee and total for content, views and sign-up campaigns; checkout and the wizard both use it (platform fee handling per D2)
- [ ] One eligibility check returns eligible / not eligible, each failed criterion in plain words, and a match score based on the share of the creator's audience in the target locations (hard vs ranking criteria per D8)
- [ ] Eligibility examples pass: a creator living in Abuja with 80% Lagos audience qualifies for a Lagos campaign needing 50%; a creator living in Lagos with 10% Lagos audience does not
- [ ] Migration script sets the new fields on existing campaigns; dry run on a copy of production shows identical payouts before and after
- [ ] End-to-end test: the existing views campaign flow from ticket 00 still passes
