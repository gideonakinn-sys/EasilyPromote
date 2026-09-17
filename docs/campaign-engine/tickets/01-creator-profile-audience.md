# 01: Creator Profile v2 — audience, portfolio, verification

**What to build:** Creators keep a full profile: private basics (legal name, phone, email), public basics, social accounts, categories, audience demographics (top locations %, age %, gender %), a curated portfolio, the ✓ Verified badge and earned badges. Brands see a brand-safe view of it. Matching later uses where the creator's **audience** is, not where the creator lives.

**Blocked by:** 00

**Milestone:** M1 (data + API, 21 Sep – 2 Oct) and M3 track B (screens, 5 – 16 Oct)

**Status:** ready-for-agent

## Corrections from the first draft

- Screens go in the `web` app's creator dashboard, not the standalone `creator` app (a stale copy).
- Rank, creator score, completion rate and verified views already exist on the profile — extend, don't duplicate.
- TikTok and Meta connections already exist. At launch, audience data is **self-reported with a proof screenshot** (D7); pulling it from the APIs is post-launch (M8). Store where each number came from.
- "Verified" means at least one connected social account plus an admin identity check (D13).

## Acceptance criteria

- [ ] Profile stores audience locations (up to 5, with %), age breakdown %, gender breakdown %, the source (self-reported / API), a proof image and when it was last updated
- [ ] Each breakdown is rejected if it adds up to more than 100%
- [ ] Creator can add, reorder and remove portfolio items (link, thumbnail, platform, views, category)
- [ ] Profile carries categories, verified status and badges; badges are read-only for the creator
- [ ] Cached stats per creator (followers, average views, engagement %, past campaigns, total campaign views) refresh from connected TikTok / Instagram accounts where available
- [ ] Brand-facing profile never includes legal name, phone, email or bank details (covered by an end-to-end test)
- [ ] Creator dashboard: profile screens for all of the above, with private fields clearly marked
- [ ] Creator dashboard prompts creators with no audience data to add it
- [ ] Existing profile fields and endpoints keep working unchanged
