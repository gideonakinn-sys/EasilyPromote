# 06: Application Required — apply and brand review

**What to build:** On an Application Required campaign, a creator taps APPLY. The brand reviews applicants in a condensed snapshot that puts what matters for *this* campaign first, then approves or rejects. Approved creators get "You've been selected", a reserved place and the full brief.

**Blocked by:** 01, 02, 05

**Milestone:** M4 · track A · 19 – 30 Oct

**Status:** ready-for-agent

## Corrections from the first draft

- Build brand screens in the `web` app's brand campaign page, creator screens in the `web` app's creator dashboard.
- **Blocked by 05**: approving an application reserves a place with the same guarded reservation used by instant join.
- Creator Approval lives on the application; it never reads or writes a submission's status (and ticket 07 never touches applications).

## Acceptance criteria

- [ ] APPLY runs the shared eligibility check and creates an application (pending), with an optional short pitch and a snapshot of the creator's profile frozen at that moment
- [ ] A creator can withdraw a pending application; one application per creator per campaign
- [ ] Brand campaign page lists applicants with a count, filters (pending / approved / rejected) and sorting by match score
- [ ] Snapshot shows: photo, name, ✓ Verified, location; platform and followers; categories; top location %, top age %, gender %; average views, engagement %, past campaigns, total campaign views; portfolio thumbnails; badge and completion %; APPROVE and REJECT
- [ ] Snapshot order depends on the campaign: location-targeted → share of audience in that location first; performance campaign → performance stats first; category campaign → portfolio items in that category first
- [ ] APPROVE reserves a place; approving when no places are left is refused with a clear message
- [ ] APPROVE notifies the creator ("You've been selected") in-app and by email and unlocks the full brief; REJECT notifies with the optional reason
- [ ] Pending applications expire after 7 days; the brand is reminded on day 3 (D9)
- [ ] Creator sees "My applications" with status
- [ ] End-to-end tests: apply → approve → brief unlocks; approve past capacity refused; reject; expiry
