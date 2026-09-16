// Creator Eligibility: can this creator join or apply, why not, and how well do they match?
// Location, platform and verification are hard requirements; age, gender and interests only rank (D8).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateEligibility } = require("../../src/services/eligibility");

function creator(overrides = {}) {
  return {
    city: "Lagos",
    state: "Lagos",
    verifiedAt: new Date("2026-09-01"),
    socialAccounts: [{ platform: "tiktok", handle: "@c", followers: 20000 }],
    categories: ["Music"],
    rank: "rank2",
    badges: [],
    stats: { engagementRate: 6 },
    audience: {
      source: "self_reported",
      locations: [{ name: "Lagos", percentage: 60 }],
      ages: [{ range: "18-24", percentage: 70 }],
      genders: { female: 50, male: 50, other: 0 },
    },
    ...overrides,
  };
}

const lagosCampaign = { audienceTargeting: { locations: ["Lagos"], minLocationShare: 50 }, creatorEligibility: {} };

test("audience location decides, not where the creator lives", () => {
  const abujaCreator = creator({ city: "Abuja", state: "FCT", audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 80 }, { name: "Abuja", percentage: 15 }] } });
  const lagosCreator = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 10 }, { name: "London", percentage: 70 }] } });

  assert.equal(evaluateEligibility(abujaCreator, lagosCampaign).eligible, true);

  const result = evaluateEligibility(lagosCreator, lagosCampaign);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failures, [{ criterion: "audienceLocation", message: "Needs at least 50% of your audience in Lagos (you have 10%)" }]);
});

test("the location share counts every targeted location together, ignoring letter case", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos", "Abuja"], minLocationShare: 50 }, creatorEligibility: {} };
  const split = creator({ audience: { source: "self_reported", locations: [{ name: "lagos", percentage: 30 }, { name: "ABUJA", percentage: 25 }] } });
  assert.equal(evaluateEligibility(split, campaign).eligible, true);
});

test("a creator with no audience data can't join a location-targeted campaign", () => {
  const result = evaluateEligibility(creator({ audience: undefined }), lagosCampaign);
  assert.equal(result.eligible, false);
  assert.equal(result.failures[0].criterion, "audienceLocation");
  assert.match(result.failures[0].message, /Add your audience locations/);
});

test("each creator eligibility rule explains itself when it isn't met", () => {
  const campaign = {
    audienceTargeting: { platforms: ["instagram"] },
    creatorEligibility: {
      verifiedOnly: true,
      minFollowers: 50000,
      minEngagementRate: 8,
      categories: ["Comedy", "Fashion"],
      minRank: "rank4",
      requiredBadges: ["reliable_creator"],
    },
  };
  const result = evaluateEligibility(creator({ verifiedAt: null }), campaign);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.failures, [
    { criterion: "platform", message: "Needs a connected Instagram account" },
    { criterion: "verified", message: "Only verified creators can take part" },
    { criterion: "minFollowers", message: "Needs 50,000+ followers on Instagram" },
    { criterion: "minEngagementRate", message: "Needs an engagement rate of 8% or more (you have 6%)" },
    { criterion: "categories", message: "Needs a creator in Comedy or Fashion" },
    { criterion: "minRank", message: "Needs rank 4 or higher" },
    { criterion: "requiredBadges", message: "Needs the Reliable Creator badge" },
  ]);
});

test("a creator who meets every rule is eligible with no failures", () => {
  const campaign = {
    audienceTargeting: { locations: ["Lagos"], minLocationShare: 50, platforms: ["tiktok"] },
    creatorEligibility: { verifiedOnly: true, minFollowers: 10000, minEngagementRate: 5, categories: ["Music"], minRank: "rank2" },
  };
  assert.deepEqual(evaluateEligibility(creator(), campaign).failures, []);
  assert.equal(evaluateEligibility(creator(), campaign).eligible, true);
});

test("age and gender only rank creators; they never block them (D8)", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos"], ageRanges: ["25-34"], genders: ["female"] }, creatorEligibility: {} };
  const young = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 60 }], ages: [{ range: "18-24", percentage: 90 }], genders: { female: 20, male: 80, other: 0 } } });
  const onTarget = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 60 }], ages: [{ range: "25-34", percentage: 90 }], genders: { female: 80, male: 20, other: 0 } } });

  assert.equal(evaluateEligibility(young, campaign).eligible, true);
  assert.ok(evaluateEligibility(onTarget, campaign).matchScore > evaluateEligibility(young, campaign).matchScore);
});

test("match score: share of audience in the targeted locations, ages and genders", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos"], ageRanges: ["18-24"], genders: ["female"] }, creatorEligibility: {} };
  // location 60 × 0.6 + age 70 × 0.25 + female 50 × 0.15 = 36 + 17.5 + 7.5 = 61
  assert.equal(evaluateEligibility(creator(), campaign).matchScore, 61);
  // Nothing targeted: every creator matches equally.
  assert.equal(evaluateEligibility(creator(), { audienceTargeting: {}, creatorEligibility: {} }).matchScore, 100);
});

test("targeting locations with no minimum share only ranks; platform names ignore letter case", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos"], minLocationShare: 0, platforms: ["TikTok"] }, creatorEligibility: {} };
  const result = evaluateEligibility(creator({ audience: undefined }), campaign);
  assert.deepEqual(result.failures, []);
});
