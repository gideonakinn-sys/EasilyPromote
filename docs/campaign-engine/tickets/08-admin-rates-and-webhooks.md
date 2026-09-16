# 08: Referral tracking on the new join paths (remaining work)

**What to build:** Sign-up campaigns keep working when creators join through Open Call or get approved through Application Required: each creator gets their referral code at that moment, conversions are credited to them, and admin keeps setting the reward per sign-up.

**Blocked by:** 05, 06

**Milestone:** M6 · 2 – 6 Nov

**Status:** ready-for-agent

## Corrections from the first draft

Most of the first draft **is already built** (budget-first and referral-tracking plans):

- Admin sets and changes the reward per sign-up; earlier unpaid sign-ups are paid oldest first
- Referral codes per creator per campaign; brands can load or import their own
- Signed conversion webhooks that ignore repeats, key rotation, connect-before-pay
- Rewards reserved from the pool atomically so a campaign can't overspend
- Live updates to creators and brands

What's left is making sure these follow the new ways into a campaign. The admin per-view price screen moves to ticket 11.

## Acceptance criteria

- [ ] Joining an Open Call sign-up campaign creates the creator's referral code (a failure never costs the creator their place; backfill repairs it)
- [ ] Approving an application on a sign-up campaign creates the creator's referral code
- [ ] Conversions for codes created either way are credited and paid exactly as today
- [ ] The campaign page and marketplace card show "Reward being set" until admin sets it
- [ ] End-to-end test: join → signed conversion → reward reserved → appears in creator wallet
