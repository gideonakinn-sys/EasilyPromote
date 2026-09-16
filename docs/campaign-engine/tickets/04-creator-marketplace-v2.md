# 04: Creator marketplace v2

**What to build:** Creators browse campaigns by how they're paid. Each card leads with the money (`₦15,000 / APPROVED VIDEO`, `₦250 / DOWNLOAD`, `₦5 / 1,000 VIEWS`), then platform, location, access badge and the right button. Campaigns that suit the creator's audience appear first.

**Blocked by:** 01, 02

**Milestone:** M3 · track B · 5 – 16 Oct

**Status:** ready-for-agent

## Corrections from the first draft

- Build in the `web` app's creator dashboard (replacing the current marketplace), not the standalone `creator` app.
- **Blocked by 01 as well as 02**: "Recommended for You" needs the creator's audience data and the eligibility match score.
- **Moved to ticket 10:** Hybrid tab. **Moved to ticket 11:** Trending section.
- Sign-up rewards can be unset when a campaign goes live (admin sets them later). The card then shows "Reward being set" instead of a number.

## Acceptance criteria

- [ ] Tabs: All / Fixed Pay / Performance
- [ ] Sections: Recommended for You (ordered by match score) and New (newest first)
- [ ] No sub-category labels anywhere ("UGC campaign", "Download campaign")
- [ ] Card headline shows the pay per unit for every campaign type, including existing views campaigns
- [ ] Card shows platform, target location, access badge (Open Call 🟢 / Application Required 🔵) and button (JOIN CAMPAIGN / APPLY)
- [ ] Campaigns the creator isn't eligible for say why ("Needs 5,000+ followers") instead of disappearing
- [ ] Marketplace loads in one request per screen (the API is ~600 ms away)
