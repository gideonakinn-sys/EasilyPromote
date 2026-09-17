# Load test: marketplace, join, apply and approve (ticket 11)

Run on 17 Sep 2026 against `main` after commit `2edbe75`. Everything below ran on one laptop (Intel i7-8650U, 4 cores / 8 threads, 17 GB, Windows 11, Node 22.14, MongoDB 8.0): a throwaway `mongod`, the API as its own process and the load generator. Production adds Render and Cloudflare in front (users see about 600 ms round trip to the API) and Atlas behind (every query is a network round trip), so treat these as **relative** numbers: what's slow, what breaks under concurrency, and what the fixes bought. They aren't production latency.

## How to run it

```bash
cd Backend
npm run load-test                       # seeds a fresh throwaway mongod, runs everything, deletes it
npm run load-test -- --out results.json # also writes the numbers as JSON
```

Options: `--creators 5000 --campaigns 2000 --brands 250` (volume), `--concurrency 50` (virtual users for the throughput scenarios), `--marketplace-requests 1000`, `--scenarios marketplace,join,apply,approve,races` (default all). To seed once and run many times, start a local `mongod` and pass `--mongo-uri mongodb://127.0.0.1:27099/ep_load --save-seed seed.json`, then `--reuse-seed seed.json` with the same `--mongo-uri`. `--cpu-prof <dir>` writes a V8 CPU profile of the API process.

The script exits non-zero if any request errors (5xx or a dropped connection) or any invariant fails.

**Safety.** It never reads `Backend/.env`, `MONGODB_URI` or any key from your shell:
- `scripts/loadTest/safety.js` refuses any MongoDB URI that isn't `mongodb://` on `127.0.0.1`, `localhost` or `::1` (so every `mongodb+srv://` and Atlas host), and any API URL that isn't `http://` on those hosts (unit tested in `test/unit/loadTestSafety.test.js`).
- Seeding goes through the real API in-process with Paystack stubbed (`test/e2e/harness.js`, which also clears email, storage and social API keys).
- The API under test runs from an empty temporary directory, so `dotenv` finds no `.env`, with an environment built from scratch: only the OS variables Node needs plus the throwaway database, test JWT secrets and a fake Paystack key.

Never point it at production.

## What it does

**Seed** (83 s): 250 brands; 5,000 creators with a connected TikTok account, niches, follower counts and self-reported audience locations; 2,000 paid live campaigns through the API (content 40%, views 32.5%, sign-ups 20%, downloads 7.5%; 30% Application Required; one in four targets an audience location and minimum followers), plus 80 race campaigns with exactly 5 places each. 40% of every campaign's places are taken by creators who finished their work (a fifth of them in the last 72 hours, for Trending) with completed content; about 4 applications in every state per Application Required campaign. Totals: 2,080 live campaigns, 20,256 places (7,635 taken, 12,621 open), 7,635 submissions, 2,600 applications.

**Scenarios** (each with its own creators, so refusals are real ones):

| # | Scenario | Load |
|---|---|---|
| 1 | Marketplace | 1,000 requests from 50 concurrent creators |
| 2 | Join | 1,000 creators each join 3 Open Call campaigns with places left (3,000 joins, 50 concurrent) |
| 3 | Apply | 1,000 creators each apply to 3 Application Required campaigns (3,000, 50 concurrent) |
| 4 | Approve | brands approve those 3,000 applications, more than there are places (50 concurrent) |
| 5 | Join race | 30 creators for each of 40 campaigns with 5 places (1,200 joins, 240 in flight) |
| 6 | Double join | 50 creators send the same join twice at once |
| 7 | Placement limit race | 50 creators each join 6 different campaigns at once (limit: 3 active) |
| 8 | Approve race | 15 applicants on each of 40 campaigns with 5 places, all 600 approved at once |
| 9 | Double apply, double approve | the same apply twice at once, then the same approval twice at once (50 each) |

"Errors" are 5xx responses and dropped connections. Expected refusals (`CAMPAIGN_FULL`, `ALREADY_JOINED`, `NOT_ELIGIBLE`, `ALREADY_APPLIED`, `NOT_PENDING`, ...) are counted separately; "Unexpected" is any other 4xx.

**Invariants** checked in the database afterwards (`scripts/loadTest/invariants.js`): no creator holds two places in one campaign; open places have no creator and held places have one; no creator has more than 3 active placements; held places never promise more than the creator pool; one application per creator per campaign; race campaigns never overfill; every approved applicant holds a place and every place on an Application Required race campaign belongs to an approved applicant; and, from the responses, a double join, double apply or double approve never succeeds twice.

## Results (final run)

| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Unexpected |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GET /api/creators/marketplace (2,080 live) | 1000 | 9 | 5357 | 6979 | 7633 | 8298 | 0 (0.00%) | 0 |
| POST /api/campaigns/:id/join | 3000 | 114 | 391 | 603 | 643 | 704 | 0 (0.00%) | 0 |
| POST /api/campaigns/:id/apply | 3000 | 159 | 301 | 389 | 616 | 786 | 0 (0.00%) | 0 |
| POST /api/campaigns/:id/applications/:id/approve | 3000 | 105 | 489 | 686 | 781 | 811 | 0 (0.00%) | 0 |
| join race: 30 creators per 5 places, 40 campaigns | 1200 | 133 | 1802 | 2146 | 2433 | 2562 | 0 (0.00%) | 0 |
| double join | 100 | 153 | 619 | 648 | 651 | 651 | 0 (0.00%) | 0 |
| placement limit race: 6 joins at once per creator | 300 | 122 | 1677 | 2038 | 2049 | 2061 | 0 (0.00%) | 0 |
| approve race: 15 approvals per 5 places, 40 campaigns | 600 | 88 | 2748 | 3058 | 3181 | 3208 | 0 (0.00%) | 0 |
| double apply | 100 | 162 | 564 | 614 | 616 | 617 | 0 (0.00%) | 0 |
| double approve | 100 | 162 | 354 | 609 | 613 | 614 | 0 (0.00%) | 0 |

Latency under a closed loop of 50 (or 240) concurrent users is mostly queueing on one API process: 114 joins a second is under 9 ms of API time per join. Race latencies include every request in the burst arriving together.

Outcomes:
- Join: 2,996 joined, 4 `ALREADY_JOINED` (creators who held an older place there). Apply: 3,000 applied. Approve: 2,142 approved, 858 `CAMPAIGN_FULL`.
- Join race: exactly 200 joined (40 × 5), 1,000 `CAMPAIGN_FULL`. Approve race: exactly 200 approved, 400 `CAMPAIGN_FULL`.
- Double join, apply and approve: exactly one of each pair won (50), the other got `ALREADY_JOINED`, `ALREADY_APPLIED` or `NOT_PENDING`.
- Placement limit race: 150 joined (3 per creator), 150 refused `NOT_ELIGIBLE` (placementLimit).
- **Every invariant held.** MongoDB's profiler saw no collection scans; the only operations over 25 ms were the marketplace's open-places aggregation (up to 897 ms while 50 marketplace requests queued on it) and the Trending lookup.

**Marketplace by number of live campaigns** (same data, after the fixes; for the 580 row, 1,500 of the 2,000 seeded campaigns were completed):

| Live campaigns | 1 creator: p50 / p95 ms | 50 concurrent: req/s, p50 / p95 ms |
|---:|---:|---:|
| 580 | 81 / 96 | 32 req/s, 1,556 / 1,855 |
| 2,080 | 147 / 169 | 9 req/s, 5,357 / 6,979 |

## What the load test found, and what was fixed

1. **Marketplace (fixed, 4x): every request decoded every live campaign and every open place.** At 2,080 live campaigns and 50 concurrent creators it served 2 req/s with p50 18.9 s and p95 31.9 s (and 12% of requests timed out at 60 s in the first run). A CPU profile showed ~45% of the API's time decoding BSON, ~19% garbage collection and ~11% copying each campaign per request. `services/creatorDashboard.js` now:
   - loads live campaigns with only the fields a card, the join check and Recommended for You read, and keeps that list in the API process until a live campaign changes. Each request reads one summary row (how many campaigns are live, when one last changed) and reloads when it moved; it reloads at least every 30 s anyway in case instances' clocks disagree. Places left are never cached;
   - summarises open places in the database: one row per campaign and rank requirement (count and the first place in join order) instead of 12,621 place documents. The place a card shows is the first one the creator's rank allows, which is always the first of its rank group;
   - stops copying every campaign to attach its brand and converting the same ids to strings again and again.

   Result: 8 req/s, p50 5.7 s at the same load (9 req/s, p50 5.4 s with the JWT fix). The response is unchanged. Tests: `creator-marketplace.test.js` (rank-limited places and counts; a change, pause or new campaign shows on the next request).

2. **Placement limit bypass under concurrency (fixed).** Every creator who joined 6 campaigns at once ended with **6 active placements** (the limit is 3): each join counted the creator's active placements before any of them had taken a place. After reserving, `takePlacement` (`services/placements.js`) now keeps the creator's oldest active placements up to the limit and gives a later one back with the normal placementLimit refusal. The same path serves approvals. In the final run exactly 3 of 6 succeed. Test: `open-call-join.test.js` ("a creator joining six campaigns at once...", red before the fix).

3. **JWT verification cost about 11% of all API CPU (fixed).** `jsonwebtoken` turns a string secret into a key on every call, first trying it as a PEM public key and throwing (the stack trace alone was 2%). `utils/jwt.js` now makes the HMAC key once per secret; the socket handshake uses the same helper. Tokens are identical, so sessions survive the deploy. Join went from 88 to 114 req/s (p50 515 to 391 ms), apply 107 to 159, approve 76 to 105; the before numbers were measured on the same volume but a database the earlier scenarios had already run against, so read them as approximate. Test: `test/unit/jwt.test.js`.

4. **No double-booking, overfilling or double approval found.** The existing guarded updates (a place flips from available once, the unique `{campaignId, creatorId}` place index, the pool re-check after reserving, the pending-to-approved update on applications) held under every race.

5. **No missing indexes.** The profiler recorded no collection scans on these paths at this volume.

## Not fixed: known limits

- **The marketplace still sends every open live campaign in one response** (about 2,080 cards at the top volume; the UI filters and sections them in the browser). Its cost grows with the number of live campaigns: fine at a few hundred live campaigns, slow at thousands. The next step is server-side sections or pagination (Recommended, Trending and New as separate, paged lists), which changes the API and the creator marketplace screen.
- **Approval does the most work of the write paths** (the application update, the same reservation as a join, a referral code when tracked, notifications). It's correct under concurrency; its latency is queueing on one process.
- **One API process.** Node runs requests on one thread; production scales by instances. The in-process caches (price table, match count's creators, live campaigns for the marketplace) are per instance and each reloads on its own.
- **In production each MongoDB query is a round trip to Atlas.** The query counts per request in `scripts/measureEndpoints.js` matter more there than local latency.
