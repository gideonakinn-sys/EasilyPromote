# 05: Open Call — instant join

**What to build:** On an Open Call campaign, an eligible creator taps JOIN CAMPAIGN and is in: a place is reserved, the full brief unlocks, and for sign-up campaigns their referral code is ready. An ineligible creator is told exactly which criteria they missed.

**Blocked by:** 02, 04

**Milestone:** M3 · track B · 5 – 16 Oct

**Status:** ready-for-agent

## Corrections from the first draft

- Creators already join views campaigns by claiming a slot. That claim already guards against two creators taking the same slot and re-checks the creator pool afterwards, giving the slot back if it overflowed. Reuse that behaviour for every campaign model instead of writing a second join path.
- Today's claim rules (a connected social account, chosen niches, at most 3 active placements, rank) become part of the eligibility check instead of living separately in the claim route.
- Referral codes are already created when a slot is claimed on a sign-up campaign. Keep that; it now happens on join.
- For content campaigns, the number of places is the number of deliverables the brand paid for.

## Acceptance criteria

- [ ] JOIN runs the shared eligibility check; if ineligible, the response lists each failed criterion in plain words and nothing is reserved
- [ ] If eligible, a place is reserved; two creators racing for the last place → exactly one succeeds, the other is told it just filled
- [ ] A creator can't hold two places on the same campaign
- [ ] Before joining, a creator sees the brief summary and pay; after joining, the full brief, references, hashtags, sound and (for sign-ups) their referral code
- [ ] Places left update live for everyone viewing the campaign
- [ ] JOIN is refused on Application Required campaigns
- [ ] End-to-end tests: eligible join, ineligible join with reasons, last-place race, existing views claim still works
