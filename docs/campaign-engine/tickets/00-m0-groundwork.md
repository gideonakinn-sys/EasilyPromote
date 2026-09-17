# 00: M0 groundwork — decisions, glossary, end-to-end test setup

**What to build:** The team can start M1 safely. The open product decisions (D1–D14 in the spec) have answers, the domain language is written down, and there is a repeatable end-to-end test that runs today's views campaign from creation to content approval against a throwaway database, so every later ticket can prove it didn't break live campaigns.

**Blocked by:** None (can start immediately)

**Milestone:** M0 · Thu 17 – Mon 21 Sep 2026

**Status:** in-progress

- [x] D1–D14 answered and recorded in the spec (defaults adopted 16 Sep)
- [ ] Glossary covers: campaign model, objective, pay shape, rate authority, content destination, creator access, Creator Approval, Content Approval, audience targeting, creator eligibility
- [ ] ADRs recorded for decisions that are hard to reverse and surprising without context
- [ ] End-to-end test setup starts its own throwaway MongoDB, never touches the database in the environment file, and stubs Paystack
- [ ] One end-to-end test runs an existing views campaign: brand creates → pays → goes live → creator claims → submits content → brand approves
- [ ] A single command runs every end-to-end test
