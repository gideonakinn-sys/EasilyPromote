// Automated badges (M8): the rules, thresholds and hysteresis, and how admin overrides combine with
// them. Pure: no database. services/creatorBadges.js feeds it a creator's metrics and stores the result.
//
// Every badge has
//   minimums  sample sizes a creator must have before the badge can be held at all, so one
//             campaign (or one glowing rating) can never earn it;
//   gain      what a creator who doesn't hold the badge needs to earn it;
//   keep      the lower bar a creator who already holds it needs to keep it.
// The gap between gain and keep is the hysteresis: a creator hovering around a threshold doesn't
// gain and lose the badge on every recalculation.
//
// A check is { metric, min }, optionally with `onlyWith: { metric, min }` (the check only applies
// once that sample exists, e.g. a rating bar that applies once a creator has 3 ratings), or
// { anyOf: [checks] } (one of them is enough).

const BADGES = ["top_creator", "high_performer", "reliable_creator", "campaign_pro"];

const BADGE_LABELS = {
  top_creator: "Top Creator",
  high_performer: "High Performer",
  reliable_creator: "Reliable Creator",
  campaign_pro: "Campaign Pro",
};

const METRIC_LABELS = {
  creatorScore: "Creator score",
  completionRate: "Completion rate",
  completionSample: "Placements counted for completion",
  finishedCampaigns: "Finished campaigns",
  verifiedViews: "Verified views",
  verifiedConversions: "Verified conversions",
  ratingAverage: "Average brand rating",
  ratingCount: "Brand ratings",
};

const BADGE_RULES = {
  reliable_creator: {
    description: "Finishes the campaigns they take on.",
    minimums: [
      { metric: "finishedCampaigns", min: 3 },
      { metric: "completionSample", min: 5 },
    ],
    gain: [
      { metric: "completionRate", min: 90 },
      { metric: "ratingAverage", min: 3.5, onlyWith: { metric: "ratingCount", min: 3 } },
    ],
    keep: [
      { metric: "completionRate", min: 80 },
      { metric: "ratingAverage", min: 3.0, onlyWith: { metric: "ratingCount", min: 3 } },
    ],
  },
  high_performer: {
    description: "Delivers strong verified results.",
    minimums: [{ metric: "finishedCampaigns", min: 3 }],
    gain: [
      { anyOf: [{ metric: "verifiedViews", min: 50000 }, { metric: "verifiedConversions", min: 100 }] },
      { metric: "creatorScore", min: 70 },
    ],
    keep: [
      { anyOf: [{ metric: "verifiedViews", min: 40000 }, { metric: "verifiedConversions", min: 80 }] },
      { metric: "creatorScore", min: 60 },
    ],
  },
  campaign_pro: {
    description: "Experienced: many finished campaigns, reliably delivered.",
    minimums: [
      { metric: "finishedCampaigns", min: 10 },
      { metric: "completionSample", min: 10 },
    ],
    gain: [
      { metric: "completionRate", min: 85 },
      { metric: "ratingAverage", min: 4.0, onlyWith: { metric: "ratingCount", min: 5 } },
    ],
    keep: [
      { metric: "completionRate", min: 75 },
      { metric: "ratingAverage", min: 3.5, onlyWith: { metric: "ratingCount", min: 5 } },
    ],
  },
  top_creator: {
    description: "The best all round: high score, top brand ratings and reliable delivery.",
    minimums: [
      { metric: "finishedCampaigns", min: 5 },
      { metric: "completionSample", min: 5 },
      { metric: "ratingCount", min: 5 },
    ],
    gain: [
      { metric: "creatorScore", min: 85 },
      { metric: "ratingAverage", min: 4.5 },
      { metric: "completionRate", min: 90 },
    ],
    keep: [
      { metric: "creatorScore", min: 78 },
      { metric: "ratingAverage", min: 4.2 },
      { metric: "completionRate", min: 85 },
    ],
  },
};

const OVERRIDE_MODES = ["grant", "revoke"];

function numberOf(metrics, metric) {
  const value = metrics ? metrics[metric] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Returns { label, metric?, value, need, pass, skipped?, anyOf? } for one check.
function runCheck(check, metrics) {
  if (check.anyOf) {
    const parts = check.anyOf.map((part) => runCheck(part, metrics));
    return {
      label: parts.map((p) => p.label).join(" or "),
      anyOf: parts,
      pass: parts.some((p) => p.pass),
    };
  }
  const value = numberOf(metrics, check.metric);
  const base = { label: METRIC_LABELS[check.metric] || check.metric, metric: check.metric, value, need: check.min };
  if (check.onlyWith) {
    const sample = numberOf(metrics, check.onlyWith.metric);
    if (sample === null || sample < check.onlyWith.min) {
      return {
        ...base,
        pass: true,
        skipped: `Applies from ${check.onlyWith.min} ${(METRIC_LABELS[check.onlyWith.metric] || check.onlyWith.metric).toLowerCase()}`,
      };
    }
  }
  return { ...base, pass: value !== null && value >= check.min };
}

// One badge for one creator. `heldBefore` is whether the rules gave them the badge last time
// (overrides don't count: a hand-granted badge still has to reach the gain bar to be earned).
function evaluateBadge(badge, metrics, heldBefore) {
  const rule = BADGE_RULES[badge];
  if (!rule) throw new Error(`Unknown badge ${badge}`);
  const minimums = rule.minimums.map((check) => runCheck(check, metrics));
  const stage = heldBefore ? "keep" : "gain";
  const checks = rule[stage].map((check) => runCheck(check, metrics));
  const minimumsMet = minimums.every((c) => c.pass);
  const held = minimumsMet && checks.every((c) => c.pass);
  return { badge, held, stage, minimumsMet, minimums, checks };
}

function evaluateBadges(metrics, previousAuto = []) {
  const results = {};
  const auto = [];
  for (const badge of BADGES) {
    const result = evaluateBadge(badge, metrics, previousAuto.includes(badge));
    results[badge] = result;
    if (result.held) auto.push(badge);
  }
  return { auto, results };
}

// What the creator shows and eligibility reads: the rules' badges, plus admin grants, less admin
// revocations. At most one override per badge; the last one listed wins if there are more.
function effectiveBadges(auto = [], overrides = []) {
  const mode = new Map();
  for (const o of overrides || []) {
    if (BADGES.includes(o.badge) && OVERRIDE_MODES.includes(o.mode)) mode.set(o.badge, o.mode);
  }
  return BADGES.filter((badge) => (mode.get(badge) === "grant" ? true : mode.get(badge) === "revoke" ? false : auto.includes(badge)));
}

// Before automatic badges, badges could only be set by hand in the database. The first time a
// creator is evaluated, each badge they already hold becomes a "grant" override from the migration
// (unless an override for it exists), so nothing is silently taken away; admins review them.
function migrationOverrides(existingBadges = [], overrides = [], now = new Date()) {
  const overridden = new Set((overrides || []).map((o) => o.badge));
  const added = (existingBadges || [])
    .filter((badge) => BADGES.includes(badge) && !overridden.has(badge))
    .map((badge) => ({ badge, mode: "grant", source: "migration", setAt: now, note: "Held before automatic badges; kept until an admin reviews it" }));
  return [...(overrides || []), ...added];
}

module.exports = {
  BADGES,
  BADGE_LABELS,
  BADGE_RULES,
  METRIC_LABELS,
  OVERRIDE_MODES,
  evaluateBadge,
  evaluateBadges,
  effectiveBadges,
  migrationOverrides,
};
