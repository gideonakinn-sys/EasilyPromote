# EasilyPromote Campaign Engine — Specification (Operation Launch Fast)

## Problem Statement

The legacy EasilyPromote campaign engine operates on a single assumption: campaigns are view-based distribution contracts funded by brands, split into fixed view milestone slots.

In practice, two fundamentally distinct campaign models exist:
1. **Content Campaigns**: Brands seeking creator-generated content (UGC/creative assets) delivered directly to the brand or published on creator handles, with compensation tied to delivered, approved content (e.g. ₦15,000/approved video). Views may be tracked for performance insights, but do not dictate base pay.
2. **Performance/Distribution Campaigns**: Brands seeking measurable business results (app downloads, website sign-ups, qualifying views), with compensation paid per verified conversion action (e.g. ₦250/verified download, ₦5/1k qualifying views).

Furthermore, current architecture conflates creator participation gating with content approval gating, lacks support for flexible compensation structures (Fixed, Performance, Hybrid), ignores creator audience demographics when matching (evaluating creator physical location instead of where their followers live), and lacks clear operational boundaries between brand-set rates (content creation) and EasilyPromote-set rates (referral/sign-up actions and view tiers).

---

## Solution

The EasilyPromote Campaign Engine introduces:
- **Two Campaign Models**:
  - `Content Campaign`: Pay per deliverable created and approved.
  - `Performance Campaign`: Pay per verified outcome achieved.
- **Three Compensation Structures**:
  - `Fixed`: ₦X per approved deliverable.
  - `Performance`: ₦Y per verified action (download, sign-up, view milestone).
  - `Hybrid`: ₦Base fee + performance bonus.
- **Objective-Driven Rate Authority**:
  - `Content`: Brand sets the creator rate directly.
  - `Sign-ups / Referrals`: Brand provides total campaign budget; EasilyPromote's referral system (webhook auto-generates referral codes and tracks conversions) allows Admin to set per-referral creator payout rates.
  - `Views`: EasilyPromote platform pricing matrix standardizes per-view pricing tiers.
- **Three Content Destinations**:
  - Creator's own social media.
  - Brand's social media / owned channels (asset delivered to brand).
  - Both (creator posts + brand obtains commercial usage rights).
- **Two Creator Access Models**:
  - `Open Call`: Eligible creators join immediately with one click; slot is reserved instantly.
  - `Application Required`: Creators apply; brand reviews applicants and hand-picks participants.
- **Decoupled Two-Gate Lifecycle**:
  - Gate 1: **Creator Approval** (permission to participate and receive brief).
  - Gate 2: **Content Approval** (review of created content against the brief).
  - These two gates are strictly isolated in data models and UX flows.
- **Audience Location Matching**:
  - Targeting evaluates where the creator's audience resides (e.g. 80% Lagos followers), not the creator's physical location.
- **Economic-First Creator Marketplace**:
  - Segmented filter tabs: `All`, `Fixed Pay`, `Performance`, `Hybrid`.
  - Sections: `Recommended for You`, `Trending`, `New`.
  - Upfront economics on every card (`₦15,000 / APPROVED VIDEO`, `₦250 / DOWNLOAD`).
  - Access badges: `Open Call 🟢` / `Application Required 🔵`.
- **Contextual Applicant Review**:
  - Condensed campaign application snapshot prioritizing data fields based on campaign targeting (surfacing matching location %, category portfolio, or conversion metrics first).

---

## User Stories

1. As a brand, I want to create a Content Campaign with a fixed fee per approved deliverable, so that I can acquire high-quality video assets for my marketing.
2. As a brand, I want to create a Performance Campaign with pay-per-action metrics (downloads, sign-ups, views), so that I only pay when real business results are delivered.
3. As a brand, I want to configure Hybrid compensation (base pay + performance bounty), so that I can attract top-tier creators while incentivizing viral reach.
4. As a brand running a Content Campaign, I want to directly set the payout rate per deliverable (e.g. ₦15,000/video), so that I have predictable asset acquisition costs.
5. As a brand running a Sign-up/Download campaign, I want to provide a total campaign budget and let EasilyPromote manage creator referral rates and webhook tracking, so that I do not have to negotiate rates individually.
6. As a brand, I want to specify whether content should be posted on the creator's page, delivered directly to my brand page, or both, so that usage rights and distribution channels are clear from day one.
7. As a brand, I want to choose between "Open Call" and "Application Required" access models, so that I can choose between instant scale or curated creator selection.
8. As a brand targeting Lagos consumers, I want creator matching to look at creators whose audience is located in Lagos, so that an Abuja-based creator with 80% Lagos followers is prioritized over a Lagos-based creator with non-local followers.
9. As a brand, I want to review applicants through a condensed snapshot that highlights data relevant to my specific campaign criteria, so that I can make quick approval decisions without reading full resumes.
10. As a brand, I want to review and approve/reject submitted content deliverables before they are posted or paid out, so that my brand guidelines are preserved.
11. As an eligible creator, I want to join an Open Call campaign immediately with one click, so that I can begin creating without waiting days for brand review.
12. As a creator, I want to apply for Application Required campaigns with my portfolio and audience metrics automatically attached, so that brands can see my track record.
13. As a creator, I want to browse a marketplace filtered by compensation model (Fixed Pay, Performance, Hybrid) with economics prominently displayed on cards, so that I immediately know how much I will earn.
14. As a creator, I want to see whether a campaign is Open Call or Application Required before clicking, so that I can plan my schedule accordingly.
15. As a creator who is approved for a campaign, I want full access to the creative brief, reference videos, do's/don'ts, and tracking links, so that I have all information required to produce the content.
16. As a creator, I want to submit my draft content for review and receive constructive feedback or approval, so that I know my work is accepted before going live.
17. As a creator, I want automated escrow release upon brand content approval for fixed pay campaigns, so that my compensation is guaranteed.
18. As a creator in a referral/action campaign, I want a unique referral link and real-time conversion dashboard, so that I can track verified actions and earnings live.
19. As an EasilyPromote admin, I want to set the per-action creator payout rate on brand referral budgets, so that platform margins and creator payouts remain balanced.
20. As an EasilyPromote admin, I want conversion webhooks to process idempotently and debit from the campaign escrow pool, so that campaigns cannot spend beyond their funded budget.

---

## Implementation Decisions

### 1. Schema Extensions & Domain Models

#### `Campaign` Model Extensions
```typescript
interface ICampaignCompensation {
  model: "fixed" | "performance" | "hybrid";
  basePay: number; // ₦ per approved deliverable or base participation
  performanceMetric?: "views" | "clicks" | "downloads" | "signups" | "sales" | "leads" | "engagement";
  performanceRate?: number; // ₦ per action
  rateAuthority: "brand" | "admin" | "easilypromote";
}

interface IAudienceTargeting {
  locations: Array<{ state: string; minPercentage?: number }>;
  ageRanges: string[]; // e.g. ["18-24", "25-34"]
  genders: Array<"all" | "female" | "male">;
  interests: string[];
  platforms: Array<"tiktok" | "instagram" | "youtube" | "twitter">;
}

interface ICreatorEligibility {
  minFollowers: number;
  minEngagement: number;
  categories: string[];
  verifiedOnly: boolean;
  minRank: string;
}
```

- Added `campaignModel`: `"content"` | `"performance"`
- Added `contentDestination`: `"creator_page"` | `"brand_page"` | `"both"`
- Added `creatorAccess`: `"open_call"` | `"application_required"`
- Added `compensation`: `ICampaignCompensation`
- Added `audienceTargeting`: `IAudienceTargeting`
- Added `creatorEligibility`: `ICreatorEligibility`

#### `CreatorProfile` Model Extensions
- `audienceDemographics`:
  - `locations`: `[{ state: String, percentage: Number }]`
  - `ageBreakdown`: `[{ range: String, percentage: Number }]`
  - `genderBreakdown`: `{ female: Number, male: Number, other: Number }`
- `portfolio`: `[{ title: String, videoUrl: String, thumbnailUrl: String, platform: String, views: Number }]`
- `verified`: Boolean (`✓ Verified Creator` badge)
- `badges`: `["top_creator", "high_performer", "reliable_creator", "campaign_pro"]`

#### New `CampaignApplication` Model
- `campaignId`: ObjectId (ref: Campaign)
- `creatorId`: ObjectId (ref: User)
- `status`: `"pending"` | `"approved"` | `"rejected"`
- `appliedAt`: Date
- `reviewedAt`: Date
- `rejectionReason`: String
- `applicantSnapshot`: Cached snapshot of audience %, followers, engagement, and portfolio at time of application.

### 2. Frontend Applications

All brand and creator screens are built in the `web` app (`Fontend/apps/web`): the brand dashboard and the creator dashboard. The standalone `brand` and `creator` apps are stale copies and are not changed. Admin screens go in `Fontend/apps/admin`.

- **Brand dashboard**: five-step campaign wizard (objective & model, destination & access, targeting & eligibility, pay & budget, brief); applicant review with the campaign-aware snapshot; content review with revision requests.
- **Creator dashboard**: marketplace with pay-shape tabs, sections, economics-first cards and access badges; campaign detail with JOIN CAMPAIGN or APPLY; profile with audience data, social accounts and portfolio.
- **Admin**: sign-up reward setting (already exists), refunds, content campaign overview.

### 3. Additive schema

Existing fields (`objective`, `referral`, `targetViews`, `budget`, slots and submissions) stay and keep their meaning. Campaign v2 fields are added beside them and existing campaigns are migrated to performance model, views metric, open call access. See `docs/adr/`.

---

## Testing Decisions

Tests run against a throwaway local MongoDB with Paystack stubbed (never the database in `Backend/.env`). The main seam is the HTTP API; pure calculations (budget, eligibility, snapshot ordering) are tested directly.

1. **Unit & Calculation Layer**:
   - Validation schemas (Zod).
   - Escrow split calculations (Platform Fee vs Creator Pool).
   - Eligibility evaluation logic (verifying audience location threshold and verification flags).
2. **HTTP & Workflow Integration**:
   - Open Call instant claim with concurrency limit validation.
   - Application Required submission → Brand review → Brief unlocking.
   - Content Submission → Brand Revision / Approval → Escrow staging.
   - Conversion Webhook → Idempotent deduction from campaign pool.
3. **Frontend & Styling Verification**:
   - `npx tsc --noEmit` across all apps.
   - Strict adherence to AGENTS.md UI guidelines (no font-bold, no shadows, no button hover effects, font-rethink, pill buttons).

---

## Out of Scope
- Automated AI video moderation (manual brand and admin review preserved).
- Cross-currency fx conversion (Nigerian Naira ₦ via Paystack only).
- Pulling audience demographics from TikTok / Instagram APIs at launch. The connections exist, but launch uses self-reported numbers with proof screenshots; API data is post-launch (M8).

---

## Product Decisions (D1–D14)

Status: **accepted — defaults adopted 16 Sep 2026.**

| # | Decision | Default |
|---|---|---|
| D1 | When fixed pay is credited | Brand page only: on content approval. Creator page / both: once the live post is verified |
| D2 | Platform fee on content campaigns | Added on top of the brand's rate; the creator gets exactly the advertised rate |
| D3 | What a content campaign buys | Rate × number of deliverables; places = number of deliverables |
| D4 | Hybrid bonus | Views bonus (price table) or sign-up bonus (admin reward), from a bonus pool paid at checkout, capped per creator. Ships after launch (ticket 10) |
| D5 | Unused budget | Refunded at campaign end minus Paystack fees; admin-issued at launch, automatic later |
| D6 | Usage rights (brand page / both) | One standard licence: perpetual, non-exclusive, organic and paid social |
| D7 | Audience data at launch | Self-reported % with an analytics screenshot, admin spot checks, labelled "Self-reported" |
| D8 | Targeting strictness | Location, platform, verification are hard requirements; age, gender, interests only rank |
| D9 | Application expiry | 7 days unreviewed; brand reminded on day 3 |
| D10 | Content review deadline | Auto-approve after 72 hours without a brand response |
| D11 | Revision rounds | 2 change requests, then approve or reject (appealable) |
| D12 | Brand-page delivery | Download link at launch; file upload after launch |
| D13 | Verified creator | At least one connected social account + admin identity check |
| D14 | Launch scope | Content + fixed pay, performance (views, sign-ups), both access models, all destinations |

### Amendments and decisions made during the build (17 Sep 2026)

These refine D1–D14 where building showed a gap. The lead's recommendation was adopted for each.

| # | Topic | Decision |
|---|---|---|
| D2 (clarified) | Content platform fee | 30% of the creator budget, added on top: 10 × ₦15,000 costs ₦195,000 |
| D5 (amended) | Refund of unused budget | Unused deliverables × rate + the platform fee on them. Paystack fees are **not** deducted, matching views and referral refunds |
| D8 (amended) | Interests | Not used in ranking until creators have interests data; location, age and gender rank creators |
| D15 | When fixed pay is withdrawable | Credited at the D1 moment; withdrawable once delivery is confirmed (by the brand or after 72 hours) and 7 days have passed |
| D16 | Brand never confirms delivery or a live post | Confirmed automatically after 72 hours, like content review (D10) |
| D17 | Appeal window | 7 days after rejection; until then the deliverable isn't refundable |
| D18 | Undelivered brand-page pay | Admin can void it 14 days after approval, or at once on a cancelled campaign |
| D19 | Money actions by role | Refunds, voids, paying withdrawals, the payout run and cancelling a paid campaign: finance admins and super admins only |
| D20 | Sign-ups after a referral budget runs out | Paid oldest first when the brand tops up, while the new budget lasts |
| D21 | Rank for brand-picked creators | A place's rank requirement is skipped when a brand approves an applicant |
| D22 | Cancelled campaigns | Never deleted once payments, placements, content, applications or conversions exist |
| D23 | After launch (ticket 11) | Payout appeals, retrying failed views/referral refunds, an admin inbox for appeals |
| D2 (amended for hybrid, ticket 10) | Platform fee on a hybrid campaign | Added on top of the base budget **and** on top of the bonus pool, at the campaign's fee percent: 3 × ₦5,000 base + ₦20,000 pool costs ₦15,000 + ₦4,500 + ₦20,000 + ₦6,000 = ₦45,500. Creators get exactly the base and up to the pool. The base is the fixed pot; the pool and its fee are a separate "bonus" pot |
| D4 (detailed, ticket 10) | Hybrid bonus | The brand sets the metric (views, sign-ups or downloads), the pool (≥ ₦1,000) and the per-creator cap (≤ pool), never the rate. Views: the price table's first tier less the fee, per 1,000 verified views on the creator's verified live post (₦3,010 at 30%), stored at setup; creator page or both only. Sign-ups/downloads: admin's reward per conversion, through referral codes. Each bonus is reserved as results are verified, up to the cap and what's left of the pool (a last conversion can pay part of the reward), held 7 days, voidable in the hold for conversions |
| D5 (amended for hybrid, ticket 10) | Unused hybrid money | Unused base as D5 amended. The unused bonus pool plus its pro-rata fee (rounded down to the kobo, no Paystack fees deducted) is refunded by finance/super admins once the campaign is cancelled, or completed (views bonus) / completed 7 days ago (conversion bonus, after the conversion grace). Refunding stops any more bonus from that pool |
| D5 (automatic, ticket 11) | Automatic refunds at campaign end | An hourly job refunds, with no Paystack fee deducted and through the same crash-safe refund rows admins use (admins can still refund by hand; whoever runs first wins): **content base** as D5 amended as soon as the campaign is completed or cancelled, and again whenever more becomes unused; **hybrid bonus pool** as D5 amended for hybrid, once refundable and only while no content on the campaign is under appeal or can still be appealed (D17, voided-pay appeals); **views** on a cancelled campaign as on cancel, on a completed campaign 7 days after completion, refunding only what no placed creator can still earn (each placed creator keeps their full place reward, less what they've been paid; the fee isn't refunded, as on cancel), once per campaign; **referral budget** on a cancelled campaign as on cancel, on a completed campaign 7 days after completion (conversions still count until then), the unearned pool grossed up by its fee, once per campaign, never while sign-ups wait for admin's reward or a back-pay is in flight. Campaigns that ended more than 90 days ago aren't looked at again. Refund rows a crash left unsent are retried after 10 minutes. What the job can't refund is recorded on the campaign and raised as the `auto_refund_failed` ops alert until a run succeeds |
| D23 (built, ticket 11) | Retrying views, referral and bonus refunds | Finance / super admins retry any failed or unsent refund from its own row (never a new row, so the amount and the books don't change). Every refund row is sent under a 5-minute send lock, and before a part is sent Paystack's own refunds for that payment are checked and a matching one adopted, so a retry never refunds twice. A part with no Paystack payment still has to be refunded by hand |
| D23 (built, ticket 11) | Payout appeals | A creator can appeal a **rejected withdrawal** or **fixed pay voided as not delivered** once, within 7 days of the decision. Any admin can deny (note required, final). Granting moves money, so only finance / super admins can: a withdrawal goes back in the payout queue with its original request date (refused if its earnings no longer cover it or another withdrawal for that campaign is queued); voided pay is restored (content back to awaiting delivery, place retaken, pay credited again), refused if the place or budget is gone. Voided pay isn't refundable while its appeal is open or can still be filed. Voided conversions (referral rewards, sign-up bonuses) aren't appealable in the product: they follow the brand's server record and are disputed through support. Approving a content appeal stays open to every admin role as before (it credits pay like a brand approval; it doesn't pay out) |
| D23 (built, ticket 11) | Appeals inbox | One admin inbox lists content appeals and payout appeals, filtered by kind, open / resolved, campaign and a search. Content appeal decisions are now audit-logged like payout appeal decisions |
| Ticket 11 | Brand payment statement | Per campaign and overall: paid in, deliverables paid, performance paid (views, referrals, bonus), platform fee, refunds issued (Paystack confirmed) and pending (sent, or failed views / referral / bonus refunds awaiting a retry), remaining. "Paid" to creators includes what's owed to them (credited and waiting for delivery, a hold or a payout). Figures are the reconciliation's, so they add up to paid in to the kobo; CSV download included |
| D5 (switch, ticket 11) | Turning automatic refunds on | The job does nothing unless `AUTO_REFUNDS_ENABLED=true`, because its first run refunds every campaign that ended in the last 90 days, including ones that ended before it shipped. Finance switches it on deliberately after checking that first run. While off, admin refunds and retries work as before and the admin Overview and Refunds screens say automatic refunds are off |
| D4 (repaired, ticket 11) | Voiding a sign-up bonus | The credit is voided with a pending give-back marker, the bonus is returned to the pool keyed on the credit's reference, then the marker is cleared; the 15-minute ops job finishes any give-back a crash interrupted, never twice |
| Ticket 11 | Trending on the marketplace | The eligible campaigns (live, places left, not already held, the creator meets the campaign's eligibility) that the most **different creators** joined or applied to in the last 72 hours; a creator who applied and was then approved counts once, and applications count whatever became of them. At least 2 creators, at most 6 cards, most first (newer campaign breaks a tie). A campaign in Recommended for You isn't repeated in Trending, and New is everything else. Cards show only the count, never who. Computed in the marketplace request (no extra round trip) from partial / covering indexes on `slots.claimedAt` and `campaignapplications.appliedAt` |
| Ticket 11 | Live "about N creators match" count | Step 3 of the wizard shows how many active creators could join with the current audience targeting and creator eligibility, 600 ms after the brand stops changing them (`POST /api/campaigns/match-count`, brands only, 30 a minute per brand). Counted with the join check itself, so D8's hard requirements (audience location share when a minimum is set, platform, verification) and every eligibility rule decide it, plus a connected account and niches; age, gender and interests never change it. Only a rounded number is returned: 0 exactly, "fewer than 10" for 1–9, then the nearest 10 (under 1,000), 100 (under 10,000) or 1,000; never creators or a list. The creators counted against are cached in the API for 5 minutes |
| Ticket 11 | Admin per-view price table | Admin **Price Table** shows the tiers views campaigns are quoted from; every admin role can read it, only super admins and finance admins change it (a reason is required; each change is versioned, refused if someone saved since, and audit-logged with the before and after tiers). Validation: 2–20 tiers, whole numbers, views from 1,000 and prices above ₦0 both strictly rising, and the price per view never higher than the tier before (a volume discount). Saved in `pricetables` (defaults from `config/pricing.js` until the first save); every API instance re-reads it at most a minute old before pricing. It prices new quotes, new setups and drafts whose views change: a campaign keeps the budget and cost per view it was saved and paid at, top-ups keep the campaign's own cost per view, and a hybrid campaign keeps the views-bonus rate stored at setup (a new setup gets the creator's share of the new first tier). Per-industry cost-per-view rates (Industries) are separate and unchanged |
