// Creator Eligibility: can this creator join or apply, why not, and how well do they match?
// Platform and verification are hard requirements; age, gender, location and interests only rank (D8).
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

const lagosCampaign = { audienceTargeting: { locations: ["Lagos"] }, creatorEligibility: {} };

test("audience location only ranks creators; the bigger share matches better", () => {
  const abujaCreator = creator({ city: "Abuja", state: "FCT", audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 80 }, { name: "Abuja", percentage: 15 }] } });
  const lagosCreator = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 10 }, { name: "London", percentage: 70 }] } });

  const onTarget = evaluateEligibility(abujaCreator, lagosCampaign);
  const lowShare = evaluateEligibility(lagosCreator, lagosCampaign);
  assert.equal(onTarget.eligible, true);
  assert.equal(lowShare.eligible, true, "a low location share never blocks, it only ranks");
  assert.ok(onTarget.matchScore > lowShare.matchScore);
});

test("the location share counts every targeted location together, ignoring letter case", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos", "Abuja"] }, creatorEligibility: {} };
  const split = creator({ audience: { source: "self_reported", locations: [{ name: "lagos", percentage: 30 }, { name: "ABUJA", percentage: 25 }] } });
  assert.equal(evaluateEligibility(split, campaign).eligible, true);
  assert.equal(evaluateEligibility(split, campaign).matchScore, 55);
});

test("a creator with no audience data can still join a location-targeted campaign", () => {
  const result = evaluateEligibility(creator({ audience: undefined }), lagosCampaign);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.failures, []);
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
    audienceTargeting: { locations: ["Lagos"], platforms: ["tiktok"] },
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

test("a follower minimum asks for the missing count instead of saying the creator is too small", () => {
  const campaign = { audienceTargeting: { platforms: ["tiktok"] }, creatorEligibility: { minFollowers: 5000 } };
  const noCount = creator({ socialAccounts: [{ platform: "tiktok", handle: "@c" }] });
  assert.deepEqual(evaluateEligibility(noCount, campaign).failures, [
    { criterion: "minFollowers", message: "Add your follower count on TikTok to join" },
  ]);
  const small = creator({ socialAccounts: [{ platform: "tiktok", handle: "@c", followers: 100 }] });
  assert.deepEqual(evaluateEligibility(small, campaign).failures, [
    { criterion: "minFollowers", message: "Needs 5,000+ followers on TikTok" },
  ]);
});

test("targeted locations only rank; platform names ignore letter case", () => {
  const campaign = { audienceTargeting: { locations: ["Lagos"], platforms: ["TikTok"] }, creatorEligibility: {} };
  const result = evaluateEligibility(creator({ audience: undefined }), campaign);
  assert.deepEqual(result.failures, []);
});

test("age and gender become hard requirements only when the brand opts in (D8 amended, M8)", () => {
  const base = { locations: ["Lagos"], ageRanges: ["25-34"], genders: ["female"] };
  const young = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 60 }], ages: [{ range: "18-24", percentage: 90 }, { range: "25-34", percentage: 10 }], genders: { female: 20, male: 80, other: 0 } } });

  assert.equal(evaluateEligibility(young, { audienceTargeting: base, creatorEligibility: {} }).eligible, true, "off by default");

  const required = { audienceTargeting: { ...base, requireAgeMatch: true, requireGenderMatch: true, minGenderShare: 30 }, creatorEligibility: {} };
  assert.deepEqual(evaluateEligibility(young, required).failures, [
    { criterion: "audienceAge", message: "Needs at least 50% of your audience aged 25-34 (you have 10%)" },
    { criterion: "audienceGender", message: "Needs at least 30% of your audience female (you have 20%)" },
  ]);

  const noData = creator({ audience: { source: "self_reported", locations: [{ name: "Lagos", percentage: 60 }] } });
  const failures = evaluateEligibility(noData, required).failures.map((f) => f.criterion);
  assert.deepEqual(failures, ["audienceAge", "audienceGender"]);

  const zeroShare = { audienceTargeting: { ...base, requireAgeMatch: true, minAgeShare: 0 }, creatorEligibility: {} };
  assert.equal(evaluateEligibility(young, zeroShare).eligible, true, "a 0% minimum is respected, not treated as 50%");
});
