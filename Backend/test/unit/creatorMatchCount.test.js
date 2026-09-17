// The wizard's live "about N creators match" count (ticket 11): the join check's hard requirements
// decide who counts (D8), and only a rounded number is ever shown.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { countEligible, roundMatchCount } = require("../../src/services/creatorMatchCount");

const creator = (overrides = {}, connectedPlatforms = ["tiktok"]) => ({
  profile: {
    niches: ["Music"],
    categories: ["Fashion"],
    rank: "rank1",
    badges: [],
    socialAccounts: [{ platform: "tiktok", followers: 12000 }],
    audience: { locations: [{ name: "Lagos", percentage: 70 }] },
    verifiedAt: null,
    ...overrides,
  },
  connectedPlatforms,
});

test("location share, platform, verification and eligibility rules are hard requirements; age, gender and interests never change the count", () => {
  const pool = [
    creator(),
    creator({ audience: { locations: [{ name: "Abuja", percentage: 90 }] } }),
    creator({ verifiedAt: new Date() }),
    creator({}, ["instagram"]),
    creator({ niches: [] }), // can't join without niches
    creator({}, []), // no connected account
  ];
  assert.equal(countEligible(pool, {}), 4);
  assert.equal(countEligible(pool, { audienceTargeting: { locations: ["Lagos"], minLocationShare: 50 } }), 3);
  // Targeted locations without a minimum share only rank.
  assert.equal(countEligible(pool, { audienceTargeting: { locations: ["Lagos"] } }), 4);
  assert.equal(countEligible(pool, { audienceTargeting: { platforms: ["instagram"] } }), 1);
  assert.equal(countEligible(pool, { creatorEligibility: { verifiedOnly: true } }), 1);
  assert.equal(countEligible(pool, { creatorEligibility: { minFollowers: 20000 } }), 0);
  assert.equal(
    countEligible(pool, { audienceTargeting: { ageRanges: ["18-24"], genders: ["female"], interests: ["Cooking"] } }),
    countEligible(pool, {})
  );
});

test("the count is rounded: zero exact, under 10 hidden, then to the nearest 10, 100 or 1,000", () => {
  assert.deepEqual(roundMatchCount(0), { count: 0, fewerThan: false, label: "No creators match yet" });
  for (const n of [1, 5, 9]) assert.deepEqual(roundMatchCount(n), { count: 10, fewerThan: true, label: "Fewer than 10 creators match" });
  assert.equal(roundMatchCount(10).count, 10);
  assert.equal(roundMatchCount(14).count, 10);
  assert.equal(roundMatchCount(15).count, 20);
  assert.equal(roundMatchCount(994).count, 990);
  assert.equal(roundMatchCount(1249).count, 1200);
  assert.deepEqual(roundMatchCount(23456), { count: 23000, fewerThan: false, label: "About 23,000 creators match" });
});
