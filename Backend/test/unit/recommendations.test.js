// Recommended for You (v1 ticket 04, v2 M8 SPEC D26) and Trending (v1 ticket 11, v2 M8 SPEC D27).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  recommendation,
  sortRecommended,
  shapeSimilarity,
  similarityTo,
  trackRecord,
} = require("../../src/services/recommendations");
const { summarizeHistory } = require("../../src/services/creatorHistory");
const { trendScore, pickTrending, canTrend } = require("../../src/services/trending");
const { sectionsOf, pageOf, encodeCursor, decodeCursor } = require("../../src/services/marketplace");

const creator = { niches: ["Music"], categories: ["Comedy"] };
const content = { objective: "content", payShape: "fixed", creatorAccess: "open_call" };
const signups = { objective: "signups", payShape: "performance", creatorAccess: "open_call" };

test("cold start: an untargeted campaign is recommended only when its category or niches overlap the creator's", () => {
  const untargeted = { category: "Finance", niches: [], audienceTargeting: {} };
  const none = recommendation(creator, untargeted, { eligible: true, matchScore: 100 }, { terms: content });
  assert.equal(none.recommended, false);
  assert.equal(none.nicheOverlap, 0);

  // Platforms are a requirement, not audience targeting.
  const music = { category: "Music", niches: ["comedy"], audienceTargeting: { platforms: ["tiktok"] } };
  const fit = recommendation(creator, music, { eligible: true, matchScore: 100 }, { terms: content });
  assert.equal(fit.recommended, true);
  assert.equal(fit.nicheOverlap, 2);
  assert.equal(fit.score, 100);
  assert.deepEqual(fit.why, ["Fits your Music niche"]);
  assert.equal(recommendation(creator, music, { eligible: false, matchScore: 100 }, { terms: content }).recommended, false);
});

test("cold start: a targeted campaign is recommended at a match of 50+, scored by the match, with the audience share as the reason", () => {
  const profile = { ...creator, audience: { locations: [{ name: "Lagos", percentage: 70 }] } };
  const lagos = { category: "Finance", audienceTargeting: { locations: ["Lagos"] } };
  const at70 = recommendation(profile, lagos, { eligible: true, matchScore: 70 }, { terms: content });
  assert.deepEqual([at70.recommended, at70.score], [true, 70]);
  assert.deepEqual(at70.why, ["70% of your audience is in Lagos"]);
  assert.equal(recommendation(profile, lagos, { eligible: true, matchScore: 49 }, { terms: content }).recommended, false);
  // Targeting "all" genders targets nobody in particular.
  const allGenders = { category: "Finance", audienceTargeting: { genders: ["all"] } };
  assert.equal(recommendation(creator, allGenders, { eligible: true, matchScore: 100 }, { terms: content }).recommended, false);
  // No history at all is the same as cold start.
  assert.equal(recommendation(profile, lagos, { eligible: true, matchScore: 70 }, { terms: content, history: { finished: [], byObjective: {} } }).score, 70);
});

test("recommended campaigns order by score, then the newer campaign, then id", () => {
  const rows = [
    { id: "a", score: 60, publishedAt: "2026-09-01" },
    { id: "b", score: 80, publishedAt: "2026-09-01" },
    { id: "c", score: 60, publishedAt: "2026-09-05" },
    { id: "d", score: 60, publishedAt: "2026-09-01" },
  ];
  assert.deepEqual(rows.sort(sortRecommended).map((r) => r.id), ["b", "c", "d", "a"]);
});

// A history built the way the marketplace builds it: slots, submissions, paid conversions, campaigns.
function historyOf(entries, now = Date.parse("2026-09-17T12:00:00Z")) {
  const slots = [];
  const submissions = [];
  const conversions = new Map();
  const campaigns = new Map();
  entries.forEach((e, i) => {
    const campaignId = `c${i}`;
    campaigns.set(campaignId, { _id: campaignId, category: e.category, platforms: e.platforms || ["tiktok"], campaignObjective: e.objective, payShape: e.payShape });
    if (e.outcome === "completed") submissions.push({ campaignId, slotId: `s${i}`, status: "completed" });
    if (e.outcome === "views") submissions.push({ campaignId, status: "posted", viewsDelivered: e.views });
    if (e.outcome === "conversions") conversions.set(campaignId, e.conversions);
    if (e.outcome === "abandoned") slots.push({ campaignId, status: "claimed", claimedAt: new Date(now - 30 * 24 * 60 * 60 * 1000) });
  });
  return summarizeHistory({ slots, submissions, conversions, campaigns, now });
}

test("history: finished and abandoned campaigns per objective, with verified results on the finished ones", () => {
  const history = historyOf([
    { objective: "signups", category: "Finance", outcome: "conversions", conversions: 30 },
    { objective: "signups", category: "Finance", outcome: "conversions", conversions: 10 },
    { objective: "views", category: "Music", outcome: "views", views: 5000 },
    { objective: "content", category: "Fashion", outcome: "abandoned" },
  ]);
  assert.equal(history.finished.length, 3);
  assert.deepEqual(history.byObjective.signups, { finished: 2, abandoned: 0, views: 0, conversions: 40 });
  assert.deepEqual(history.byObjective.views, { finished: 1, abandoned: 0, views: 5000, conversions: 0 });
  assert.deepEqual(history.byObjective.content, { finished: 0, abandoned: 1, views: 0, conversions: 0 });

  // Sign-ups: success (2 + 1) / (2 + 2) = 0.75, 20 conversions per placement = 1 → 0.875.
  assert.equal(trackRecord("signups", history).value, 0.875);
  // Content: abandoned once, no results → success only, (0 + 1) / (1 + 2).
  assert.equal(Math.round(trackRecord("content", history).value * 1000) / 1000, 0.333);
  assert.equal(trackRecord("downloads", history).value, null);
});

test("similarity weighs objective, category, platform and pay shape, over the best 3 finished campaigns", () => {
  const a = { objective: "signups", category: "finance", platforms: ["tiktok"], payShape: "performance" };
  assert.equal(shapeSimilarity(a, a), 1);
  assert.equal(Math.round(shapeSimilarity(a, { ...a, category: "music" }) * 100) / 100, 0.75);
  assert.equal(shapeSimilarity(a, { objective: "content", category: "music", platforms: ["instagram"], payShape: "fixed" }), 0);
  // One finished campaign counts as a third: one campaign can't reshape recommendations.
  assert.equal(Math.round(similarityTo(a, { finished: [a] }) * 1000) / 1000, 0.333);
  assert.equal(similarityTo(a, { finished: [a, a, a, { ...a, objective: "views" }] }), 1);
});

test("with a history: score blends audience, similarity and track record, and explains why", () => {
  const history = historyOf([
    { objective: "signups", category: "Finance", outcome: "conversions", conversions: 30 },
    { objective: "signups", category: "Finance", outcome: "conversions", conversions: 25 },
    { objective: "signups", category: "Finance", outcome: "conversions", conversions: 20 },
  ]);
  const profile = { niches: ["Finance"], categories: [] };
  const financeSignups = { category: "Finance", platforms: ["tiktok"], audienceTargeting: {} };
  const financeContent = { category: "Finance", platforms: ["tiktok"], audienceTargeting: {} };

  const good = recommendation(profile, financeSignups, { eligible: true, matchScore: 100 }, { terms: signups, history });
  const other = recommendation(profile, financeContent, { eligible: true, matchScore: 100 }, { terms: content, history });
  assert.equal(good.recommended, true);
  assert.equal(other.recommended, true);
  assert.ok(good.score > other.score, `${good.score} > ${other.score}`);
  // audience 0.9, similarity 1, track 0.5·0.8 + 0.5·1 = 0.9 → 100 × (0.45 + 0.3 + 0.18) = 93.
  assert.equal(good.score, 93);
  assert.deepEqual(good.why, ["Fits your Finance niche", "You did well on sign-up campaigns"]);
  // Content: similarity (0.25 + 0.2) = 0.45, no content attempts → neutral 0.5 → 100 × (0.45 + 0.135 + 0.1).
  assert.equal(other.score, 68.5);
  assert.deepEqual(other.why, ["Fits your Finance niche"]);
});

test("with a history: an untargeted campaign outside the creator's niches is recommended from a strong record on campaigns like it", () => {
  const record = [1, 2, 3].map(() => ({ objective: "signups", category: "Finance", outcome: "conversions", conversions: 20 }));
  const history = historyOf(record);
  const musicCreator = { niches: ["Music"], categories: [] };
  const finance = { category: "Finance", platforms: ["tiktok"], audienceTargeting: {} };
  const rec = recommendation(musicCreator, finance, { eligible: true, matchScore: 100 }, { terms: signups, history });
  assert.equal(rec.recommended, true);
  assert.deepEqual(rec.why, ["You did well on sign-up campaigns"]);

  // Not from abandoned work on campaigns like it.
  const quitter = historyOf([1, 2, 3].map(() => ({ objective: "signups", category: "Finance", outcome: "abandoned" })));
  assert.equal(recommendation(musicCreator, finance, { eligible: true, matchScore: 100 }, { terms: signups, history: quitter }).recommended, false);

  // Never a targeted campaign the creator's audience doesn't suit.
  const lagos = { ...finance, audienceTargeting: { locations: ["Lagos"] } };
  assert.equal(recommendation(musicCreator, lagos, { eligible: true, matchScore: 20 }, { terms: signups, history }).recommended, false);
});

test("with a history: gated campaigns add up to 5 points for the creator's rating and badges, with a reason", () => {
  const history = historyOf([{ objective: "content", category: "Fashion", outcome: "completed" }]);
  const profile = { niches: ["Fashion"], categories: [], badges: ["reliable_creator"] };
  const open = { category: "Fashion", platforms: ["tiktok"], audienceTargeting: {} };
  const gated = { ...open, creatorEligibility: { requiredBadges: ["reliable_creator"] } };
  const rating = { average: 4.6, count: 5 };
  const plain = recommendation(profile, open, { eligible: true, matchScore: 100 }, { terms: content, history, rating });
  const withBadge = recommendation(profile, gated, { eligible: true, matchScore: 100 }, { terms: content, history, rating });
  // Rating (4.6 − 1) / 4 = 0.9 and a required badge held = 1 → 5 × 0.95 points.
  assert.equal(Math.round((withBadge.score - plain.score) * 10) / 10, 4.8);
  assert.ok(withBadge.why.includes("Your Reliable Creator badge qualifies you"), JSON.stringify(withBadge.why));
  const applied = recommendation(profile, open, { eligible: true, matchScore: 100 }, { terms: { ...content, creatorAccess: "application_required" }, history, rating });
  assert.ok(applied.why.includes("Brands rate your work 4.6"), JSON.stringify(applied.why));
});

test("trend score: fill speed over the last 72 hours (or since launch), damped for small campaigns, plus recent creators", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000);
  // 20 places, 10 taken in 72 h: speed 0.5, full size → 100 × (0.6 × 0.5 + 0.4 × 10/15).
  assert.equal(trendScore({ recentCreators: 10, recentFills: 10, totalPlaces: 20, launchedAt: days(10), now }).score, 56.7);
  // The same fills one day after launch: three times as fast, capped at 1.
  assert.equal(trendScore({ recentCreators: 10, recentFills: 10, totalPlaces: 20, launchedAt: days(1), now }).score, 86.7);
  // Launched an hour ago: the window is at least 24 hours, so 3 of 20 places is a speed of 0.45, not 1.
  assert.equal(trendScore({ recentCreators: 3, recentFills: 3, totalPlaces: 20, launchedAt: new Date(now - 60 * 60 * 1000), now }).score, 42);
  // A 4-place campaign filling completely can't beat a 20-place one filling fast.
  const tiny = trendScore({ recentCreators: 4, recentFills: 4, totalPlaces: 4, launchedAt: days(1), now }).score;
  const big = trendScore({ recentCreators: 12, recentFills: 12, totalPlaces: 20, launchedAt: days(2), now }).score;
  assert.ok(big > tiny, `${big} > ${tiny}`);
  assert.equal(trendScore({ recentCreators: 0, recentFills: 0, totalPlaces: 10, now }).score, 0);
});

test("Trending: eligible, not recommended, 4+ places and 3+ recent creators; best score first, at most 12", () => {
  const cardOf = (id, extra = {}) => ({ id, eligible: true, recommended: false, recentCreators: 5, totalPlaces: 10, trendScore: 50, publishedAt: "2026-09-01", ...extra });
  assert.equal(canTrend(cardOf("x", { recentCreators: 2 })), false);
  assert.equal(canTrend(cardOf("x", { totalPlaces: 3 })), false);
  assert.equal(canTrend(cardOf("x", { eligible: false })), false);
  assert.equal(canTrend(cardOf("x", { recommended: true })), false);
  const cards = [
    cardOf("low", { trendScore: 10 }),
    cardOf("top", { trendScore: 90 }),
    cardOf("tie-old", { trendScore: 60 }),
    cardOf("tie-new", { trendScore: 60, publishedAt: "2026-09-10" }),
    cardOf("tiny", { trendScore: 99, totalPlaces: 2 }),
    ...Array.from({ length: 12 }, (_, i) => cardOf(`filler-${i}`, { trendScore: 20 })),
  ];
  const picked = pickTrending(cards).map((c) => c.id);
  assert.equal(picked.length, 12);
  assert.deepEqual(picked.slice(0, 3), ["top", "tie-new", "tie-old"]);
  assert.ok(!picked.includes("tiny") && !picked.includes("low"));
});

test("sections and paging: every campaign once, in order, across pages; cursors are tied to their section and tab", () => {
  const scored = Array.from({ length: 40 }, (_, i) => ({
    id: `id${String(i).padStart(2, "0")}`,
    terms: { payShape: i % 3 === 0 ? "fixed" : "performance" },
    publishedAt: new Date(Date.parse("2026-09-01") + (i % 7) * 60000).toISOString(),
    eligible: i % 5 !== 0,
    recommended: i % 4 === 0 && i % 5 !== 0,
    score: (i * 7) % 11,
    recentCreators: i % 2 ? 5 : 0,
    totalPlaces: 10,
    trendScore: (i * 13) % 17,
  }));
  for (const tab of ["all", "fixed", "performance", "hybrid"]) {
    const lists = sectionsOf(scored, tab);
    const seen = [];
    for (const section of ["recommended", "trending", "new"]) {
      let after = null;
      const collected = [];
      for (let guard = 0; guard < 50; guard += 1) {
        const { items, more } = pageOf(lists[section], section, after, 3);
        collected.push(...items);
        if (!more) break;
        after = decodeCursor(encodeCursor(section, tab, items[items.length - 1]), section, tab);
      }
      assert.deepEqual(collected.map((s) => s.id), lists[section].map((s) => s.id), `${tab}/${section}`);
      seen.push(...collected.map((s) => s.id));
    }
    const expected = scored.filter((s) => tab === "all" || s.terms.payShape === tab).map((s) => s.id).sort();
    assert.deepEqual([...seen].sort(), expected, `${tab}: every campaign exactly once`);
    assert.ok(lists.trending.length <= 12);
  }
  const cursor = encodeCursor("new", "all", scored[0]);
  assert.throws(() => decodeCursor(cursor, "recommended", "all"), /expired/);
  assert.throws(() => decodeCursor(cursor, "new", "fixed"), /expired/);
  assert.throws(() => decodeCursor("not-a-cursor", "new", "all"), /expired/);

  // A campaign that goes live after page one never repeats a card on page two.
  const lists = sectionsOf(scored, "all");
  const first = pageOf(lists.new, "new", null, 5);
  const newer = { ...lists.new[0], id: "zz-newest", publishedAt: "2026-09-30T00:00:00Z" };
  const after = decodeCursor(encodeCursor("new", "all", first.items[4]), "new", "all");
  const second = pageOf([newer, ...lists.new], "new", after, 5);
  assert.deepEqual(second.items.map((s) => s.id), lists.new.slice(5, 10).map((s) => s.id));
});
