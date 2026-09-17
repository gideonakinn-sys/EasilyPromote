// Automated badges (M8): thresholds, minimum sample sizes, hysteresis and admin overrides.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  BADGES,
  BADGE_RULES,
  evaluateBadge,
  evaluateBadges,
  effectiveBadges,
  migrationOverrides,
} = require("../../src/services/badgeRules");

// A creator who clears every gain bar comfortably.
function star(overrides = {}) {
  return {
    creatorScore: 92,
    completionRate: 100,
    completionSample: 12,
    finishedCampaigns: 12,
    verifiedViews: 120000,
    verifiedConversions: 0,
    ratingAverage: 4.8,
    ratingCount: 8,
    ...overrides,
  };
}

test("a creator who clears every bar earns all four badges", () => {
  const { auto } = evaluateBadges(star());
  assert.deepEqual(auto, BADGES);
});

test("one campaign can never earn a badge, however good it was", () => {
  const oneCampaign = star({ finishedCampaigns: 1, completionSample: 1, ratingCount: 1, ratingAverage: 5, verifiedViews: 900000 });
  const { auto, results } = evaluateBadges(oneCampaign);
  assert.deepEqual(auto, []);
  for (const badge of BADGES) assert.equal(results[badge].minimumsMet, false, badge);
});

test("each badge's minimum sample sizes are enforced", () => {
  assert.equal(evaluateBadge("reliable_creator", star({ finishedCampaigns: 2 }), false).held, false);
  assert.equal(evaluateBadge("reliable_creator", star({ finishedCampaigns: 3, completionSample: 4 }), false).held, false);
  assert.equal(evaluateBadge("reliable_creator", star({ finishedCampaigns: 3, completionSample: 5 }), false).held, true);

  assert.equal(evaluateBadge("high_performer", star({ finishedCampaigns: 2 }), false).held, false);
  assert.equal(evaluateBadge("high_performer", star({ finishedCampaigns: 3 }), false).held, true);

  assert.equal(evaluateBadge("campaign_pro", star({ finishedCampaigns: 9 }), false).held, false);
  assert.equal(evaluateBadge("campaign_pro", star({ completionSample: 9 }), false).held, false);
  assert.equal(evaluateBadge("campaign_pro", star({ finishedCampaigns: 10, completionSample: 10 }), false).held, true);

  assert.equal(evaluateBadge("top_creator", star({ ratingCount: 4 }), false).held, false);
  assert.equal(evaluateBadge("top_creator", star({ finishedCampaigns: 4 }), false).held, false);
  assert.equal(evaluateBadge("top_creator", star({ ratingCount: 5, finishedCampaigns: 5, completionSample: 5 }), false).held, true);
});

test("gain thresholds sit exactly at the documented values", () => {
  // Reliable Creator: completion 90 to gain.
  assert.equal(evaluateBadge("reliable_creator", star({ completionRate: 90 }), false).held, true);
  assert.equal(evaluateBadge("reliable_creator", star({ completionRate: 89 }), false).held, false);
  // High Performer: 50,000 verified views or 100 conversions, and score 70.
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 50000, creatorScore: 70 }), false).held, true);
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 49999 }), false).held, false);
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 0, verifiedConversions: 100 }), false).held, true);
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 0, verifiedConversions: 99 }), false).held, false);
  assert.equal(evaluateBadge("high_performer", star({ creatorScore: 69 }), false).held, false);
  // Campaign Pro: completion 85.
  assert.equal(evaluateBadge("campaign_pro", star({ completionRate: 85 }), false).held, true);
  assert.equal(evaluateBadge("campaign_pro", star({ completionRate: 84 }), false).held, false);
  // Top Creator: score 85, rating 4.5, completion 90.
  assert.equal(evaluateBadge("top_creator", star({ creatorScore: 85, ratingAverage: 4.5, completionRate: 90 }), false).held, true);
  assert.equal(evaluateBadge("top_creator", star({ creatorScore: 84 }), false).held, false);
  assert.equal(evaluateBadge("top_creator", star({ ratingAverage: 4.49 }), false).held, false);
  assert.equal(evaluateBadge("top_creator", star({ completionRate: 89 }), false).held, false);
});

test("rating bars only apply once a creator has enough ratings", () => {
  // Reliable Creator ignores the rating until there are 3 ratings; then needs 3.5 to gain.
  const fewRatings = star({ ratingCount: 2, ratingAverage: 1 });
  const result = evaluateBadge("reliable_creator", fewRatings, false);
  assert.equal(result.held, true);
  assert.ok(result.checks.find((c) => c.metric === "ratingAverage").skipped);
  assert.equal(evaluateBadge("reliable_creator", star({ ratingCount: 3, ratingAverage: 3.4 }), false).held, false);
  assert.equal(evaluateBadge("reliable_creator", star({ ratingCount: 0, ratingAverage: null }), false).held, true);
  // Campaign Pro from 5 ratings.
  assert.equal(evaluateBadge("campaign_pro", star({ ratingCount: 4, ratingAverage: 2 }), false).held, true);
  assert.equal(evaluateBadge("campaign_pro", star({ ratingCount: 5, ratingAverage: 3.9 }), false).held, false);
});

test("hysteresis: a held badge is kept down to the lower keep bar, then lost; regaining needs the gain bar again", () => {
  const between = star({ completionRate: 85 });
  assert.equal(evaluateBadge("reliable_creator", between, false).held, false, "85% isn't enough to gain");
  assert.equal(evaluateBadge("reliable_creator", between, true).held, true, "85% is enough to keep");
  assert.equal(evaluateBadge("reliable_creator", star({ completionRate: 80 }), true).held, true);
  assert.equal(evaluateBadge("reliable_creator", star({ completionRate: 79 }), true).held, false);

  // A run of recalculations with completion wobbling between 86 and 91 doesn't flap.
  let held = [];
  const history = [];
  for (const rate of [91, 86, 88, 86, 91, 87, 79, 86, 89, 90]) {
    held = evaluateBadges(star({ completionRate: rate }), held).auto;
    history.push(held.includes("reliable_creator"));
  }
  assert.deepEqual(history, [true, true, true, true, true, true, false, false, false, true]);

  // Top Creator keeps down to 78 score / 4.2 rating / 85 completion.
  const slipping = star({ creatorScore: 80, ratingAverage: 4.3, completionRate: 86 });
  assert.equal(evaluateBadge("top_creator", slipping, false).held, false);
  assert.equal(evaluateBadge("top_creator", slipping, true).held, true);
  assert.equal(evaluateBadge("top_creator", star({ ratingAverage: 4.1 }), true).held, false);

  // High Performer keeps down to 40,000 views / 80 conversions and score 60.
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 45000, creatorScore: 65 }), false).held, false);
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 45000, creatorScore: 65 }), true).held, true);
  assert.equal(evaluateBadge("high_performer", star({ verifiedViews: 39999 }), true).held, false);
});

test("minimums still apply to a held badge", () => {
  assert.equal(evaluateBadge("top_creator", star({ ratingCount: 4 }), true).held, false);
});

test("every keep bar is at or below its gain bar", () => {
  const flatten = (checks) => checks.flatMap((c) => (c.anyOf ? c.anyOf : [c]));
  for (const badge of BADGES) {
    const gain = flatten(BADGE_RULES[badge].gain);
    const keep = flatten(BADGE_RULES[badge].keep);
    assert.equal(gain.length, keep.length, badge);
    gain.forEach((g, i) => {
      assert.equal(keep[i].metric, g.metric, badge);
      assert.ok(keep[i].min <= g.min, `${badge} ${g.metric}`);
    });
  }
});

test("the evaluation says why a badge is missing", () => {
  const result = evaluateBadge("reliable_creator", star({ completionRate: 70 }), false);
  const failing = result.checks.filter((c) => !c.pass);
  assert.deepEqual(failing.map((c) => [c.metric, c.value, c.need]), [["completionRate", 70, 90]]);
  const missingData = evaluateBadge("high_performer", { finishedCampaigns: 3 }, false);
  assert.equal(missingData.held, false);
  assert.equal(missingData.checks[0].anyOf[0].value, null);
});

test("overrides: grants add, revocations remove, anything else follows the rules", () => {
  const auto = ["high_performer", "reliable_creator"];
  assert.deepEqual(effectiveBadges(auto, []), ["high_performer", "reliable_creator"]);
  assert.deepEqual(
    effectiveBadges(auto, [
      { badge: "top_creator", mode: "grant" },
      { badge: "reliable_creator", mode: "revoke" },
    ]),
    ["top_creator", "high_performer"]
  );
  // Unknown badges or modes are ignored; the result is always in badge order.
  assert.deepEqual(effectiveBadges(["campaign_pro", "top_creator"], [{ badge: "nope", mode: "grant" }, { badge: "campaign_pro", mode: "auto" }]), [
    "top_creator",
    "campaign_pro",
  ]);
});

test("migration keeps badges held before automatic badges as grants, once, without touching existing overrides", () => {
  const now = new Date("2027-01-10");
  const overrides = migrationOverrides(["top_creator", "campaign_pro"], [{ badge: "campaign_pro", mode: "revoke", source: "admin" }], now);
  assert.equal(overrides.length, 2);
  assert.deepEqual(overrides[1], {
    badge: "top_creator",
    mode: "grant",
    source: "migration",
    setAt: now,
    note: "Held before automatic badges; kept until an admin reviews it",
  });
  assert.equal(overrides[0].mode, "revoke");
  // A creator with no automatic badges keeps exactly what they had.
  assert.deepEqual(effectiveBadges([], migrationOverrides(["reliable_creator"], [], now)), ["reliable_creator"]);
  assert.deepEqual(migrationOverrides([], [], now), []);
});
