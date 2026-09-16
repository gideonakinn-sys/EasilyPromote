// Recommended for You: eligible campaigns that suit the creator's audience or, when a
// campaign targets no audience, that share the creator's categories or niches.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recommendation, sortRecommended } = require("../../src/services/recommendations");

const creator = { niches: ["Music"], categories: ["Comedy"] };

test("an untargeted campaign is recommended only when its category or niches overlap the creator's", () => {
  const untargeted = { category: "Finance", niches: [], audienceTargeting: {} };
  assert.deepEqual(recommendation(creator, untargeted, { eligible: true, matchScore: 100 }), { recommended: false, nicheOverlap: 0 });

  // Platforms are a requirement, not audience targeting.
  const music = { category: "Music", niches: ["comedy"], audienceTargeting: { platforms: ["tiktok"] } };
  assert.deepEqual(recommendation(creator, music, { eligible: true, matchScore: 100 }), { recommended: true, nicheOverlap: 2 });
  assert.equal(recommendation(creator, music, { eligible: false, matchScore: 100 }).recommended, false);
});

test("a targeted campaign is recommended when the audience match is at least 50", () => {
  const lagos = { category: "Finance", audienceTargeting: { locations: ["Lagos"] } };
  assert.equal(recommendation(creator, lagos, { eligible: true, matchScore: 50 }).recommended, true);
  assert.equal(recommendation(creator, lagos, { eligible: true, matchScore: 49 }).recommended, false);
  // Targeting "all" genders targets nobody in particular.
  const allGenders = { category: "Finance", audienceTargeting: { genders: ["all"] } };
  assert.equal(recommendation(creator, allGenders, { eligible: true, matchScore: 100 }).recommended, false);
});

test("recommended campaigns order by match score, then niche overlap", () => {
  const rows = [
    { id: "a", matchScore: 60, nicheOverlap: 0 },
    { id: "b", matchScore: 80, nicheOverlap: 0 },
    { id: "c", matchScore: 60, nicheOverlap: 2 },
  ];
  assert.deepEqual(rows.sort(sortRecommended).map((r) => r.id), ["b", "c", "a"]);
});
