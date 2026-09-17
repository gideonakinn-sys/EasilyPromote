// Automated badges (M8, D25): stores what services/badgeRules.js decides for a creator, applies
// admin overrides, notifies the creator of a badge they gain, and explains the result to admins.
//
// Badge writes are guarded by `badgesRevision`: each write only lands if nobody else wrote the
// badges since they were read, and is retried on the fresh profile otherwise. So a recalculation
// and an admin override at the same moment can't undo each other, and a gained badge is announced
// once.
const CreatorProfile = require("../models/CreatorProfile");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { emitToUser } = require("../config/socket");
const { recordAdminActivity } = require("./adminActivity");
const {
  BADGES,
  BADGE_LABELS,
  BADGE_RULES,
  METRIC_LABELS,
  evaluateBadges,
  effectiveBadges,
  migrationOverrides,
} = require("./badgeRules");

const MAX_ATTEMPTS = 5;
const BADGE_FIELDS = "userId username displayName badges badgesAuto badgeOverrides badgeEvaluation badgesEvaluatedAt badgesRevision brandRating";

class BadgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The creator's metrics the rules read, from a freshly recalculated standing (creatorScore.js).
function badgeMetrics(standing, rating) {
  const count = (rating && rating.count) || 0;
  return {
    creatorScore: standing.creatorScore,
    completionRate: standing.completionRate,
    completionSample: (standing.factors && standing.factors.completion && standing.factors.completion.sample) || 0,
    finishedCampaigns: standing.finishedCampaigns || 0,
    verifiedViews: standing.verifiedViews || 0,
    verifiedConversions: standing.verifiedConversions || 0,
    ratingAverage: count > 0 && typeof rating.average === "number" ? rating.average : null,
    ratingCount: count,
  };
}

// Only lands if the badges weren't written since `profile` was read. A profile never written has
// no revision, which the filter matches as null.
async function writeBadges(profile, $set) {
  const result = await CreatorProfile.updateOne(
    { _id: profile._id, badgesRevision: profile.badgesRevision == null ? null : profile.badgesRevision },
    { $set, $inc: { badgesRevision: 1 } }
  );
  return result.modifiedCount === 1;
}

async function notifyGained(userId, gained) {
  for (const badge of gained) {
    try {
      const notification = await Notification.create({
        creatorId: userId,
        type: "badge_earned",
        title: `You earned the ${BADGE_LABELS[badge]} badge`,
        body: `${BADGE_RULES[badge].description} Brands see it on your profile and applications, and some campaigns need it.`,
      });
      emitToUser(userId, "notification", {
        id: notification._id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        createdAt: notification.createdAt,
      });
    } catch (error) {
      console.error("[Badges] Couldn't notify", String(userId), "of", badge, error.message);
    }
  }
}

const gainedBetween = (before, after) => after.filter((badge) => !(before || []).includes(badge));

// Evaluates and stores one creator's badges from their metrics. The first evaluation keeps any
// badge the creator already held as a migration grant (badgeRules.migrationOverrides).
// Returns { badges, gained, lost, auto }.
async function applyBadgeEvaluation(profileId, metrics, now = new Date()) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const profile = await CreatorProfile.findById(profileId).select(BADGE_FIELDS).lean();
    if (!profile) return null;

    const overrides = profile.badgesEvaluatedAt
      ? profile.badgeOverrides || []
      : migrationOverrides(profile.badges || [], profile.badgeOverrides || [], now);
    const evaluation = evaluateBadges(metrics, profile.badgesAuto || []);
    const badges = effectiveBadges(evaluation.auto, overrides);

    const written = await writeBadges(profile, {
      badges,
      badgesAuto: evaluation.auto,
      badgeOverrides: overrides,
      badgeEvaluation: { metrics, results: evaluation.results },
      badgesEvaluatedAt: now,
    });
    if (!written) continue;

    const before = profile.badges || [];
    const gained = gainedBetween(before, badges);
    const lost = before.filter((badge) => !badges.includes(badge));
    if (gained.length) await notifyGained(profile.userId, gained);
    if (gained.length || lost.length) {
      console.log(`[Badges] ${profile.userId} gained=${gained.join(",") || "-"} lost=${lost.join(",") || "-"}`);
    }
    return { badges, gained, lost, auto: evaluation.auto };
  }
  throw new Error(`Badges for profile ${profileId} kept changing; try again`);
}

const MODES = ["grant", "revoke", "auto"];

// Admin: grant or revoke a badge whatever the rules say, or hand it back to the rules ("auto").
// A note is required and the change is audit-logged. :userId is the creator's user id.
async function setBadgeOverride({ req, userId, badge, mode, note, now = new Date() }) {
  if (!BADGES.includes(badge)) throw new BadgeError(400, "UNKNOWN_BADGE", `Badge must be one of ${BADGES.join(", ")}`);
  if (!MODES.includes(mode)) throw new BadgeError(400, "INVALID_MODE", "Mode must be grant, revoke or auto");
  const cleanNote = String(note || "").trim();
  if (!cleanNote) throw new BadgeError(400, "NOTE_REQUIRED", "Add a note saying why");
  if (cleanNote.length > 500) throw new BadgeError(400, "NOTE_TOO_LONG", "Keep the note under 500 characters");

  let profile = await CreatorProfile.findOne({ userId }).select("_id badgesEvaluatedAt").lean();
  if (!profile) throw new BadgeError(404, "NOT_FOUND", "Creator not found");
  // Never evaluated: evaluate first, so badges held before automatic badges become migration grants
  // before this override is placed beside them.
  if (!profile.badgesEvaluatedAt) {
    const { recalculateCreator } = require("./creatorScore");
    await recalculateCreator(await CreatorProfile.findById(profile._id), now.getTime());
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    profile = await CreatorProfile.findById(profile._id).select(BADGE_FIELDS).lean();
    const current = profile.badgeOverrides || [];
    const existing = current.find((o) => o.badge === badge) || null;
    const from = existing ? existing.mode : "auto";
    if (from === mode && (mode === "auto" || existing.source === "admin")) {
      throw new BadgeError(409, "NO_CHANGE", mode === "auto" ? "This badge already follows the rules" : `This badge is already ${mode === "grant" ? "granted" : "revoked"} by an admin`);
    }

    const overrides = current.filter((o) => o.badge !== badge);
    if (mode !== "auto") overrides.push({ badge, mode, source: "admin", note: cleanNote, setBy: req.user._id, setAt: now });
    const badges = effectiveBadges(profile.badgesAuto || [], overrides);

    if (!(await writeBadges(profile, { badges, badgeOverrides: overrides }))) continue;

    const before = profile.badges || [];
    const gained = gainedBetween(before, badges);
    if (gained.length) await notifyGained(profile.userId, gained);

    await recordAdminActivity(req, {
      action: mode === "grant" ? "creator.badge_granted" : mode === "revoke" ? "creator.badge_revoked" : "creator.badge_override_cleared",
      targetType: "user",
      targetId: profile.userId,
      targetLabel: profile.displayName || profile.username,
      note: cleanNote,
      metadata: {
        badge,
        from: existing ? `${existing.mode}${existing.source === "migration" ? " (kept from before automatic badges)" : ""}` : "automatic",
        to: mode === "auto" ? "automatic" : mode,
        badgesBefore: before,
        badgesAfter: badges,
      },
    });
    return badgeReport(profile.userId);
  }
  throw new BadgeError(409, "BUSY", "This creator's badges just changed. Try again.");
}

// Admin: which badges a creator has, why, which are overridden, and the thresholds.
async function badgeReport(userId) {
  const profile = await CreatorProfile.findOne({ userId }).select(BADGE_FIELDS).lean();
  if (!profile) return null;
  const overrides = profile.badgeOverrides || [];
  const setters = await User.find({ _id: { $in: overrides.map((o) => o.setBy).filter(Boolean) } }).select("name email").lean();
  const setterName = new Map(setters.map((u) => [String(u._id), u.name || u.email]));
  const evaluation = profile.badgeEvaluation || {};
  const auto = profile.badgesAuto || [];

  return {
    creatorId: String(profile.userId),
    name: profile.displayName || profile.username,
    badges: profile.badges || [],
    evaluatedAt: profile.badgesEvaluatedAt || null,
    metrics: evaluation.metrics || null,
    rating: { average: profile.brandRating ? profile.brandRating.average : null, count: (profile.brandRating && profile.brandRating.count) || 0 },
    needsReview: overrides.some((o) => o.source === "migration"),
    metricLabels: METRIC_LABELS,
    items: BADGES.map((badge) => {
      const override = overrides.find((o) => o.badge === badge) || null;
      return {
        badge,
        label: BADGE_LABELS[badge],
        description: BADGE_RULES[badge].description,
        held: (profile.badges || []).includes(badge),
        earnedByRules: auto.includes(badge),
        override: override
          ? {
              mode: override.mode,
              source: override.source || "admin",
              note: override.note || "",
              setAt: override.setAt || null,
              setBy: override.setBy ? setterName.get(String(override.setBy)) || null : null,
            }
          : null,
        evaluation: (evaluation.results && evaluation.results[badge]) || null,
        rule: BADGE_RULES[badge],
      };
    }),
  };
}

// Admin: creators with badges kept from before automatic badges that nobody has reviewed yet.
async function creatorsToReview({ limit = 100 } = {}) {
  const profiles = await CreatorProfile.find({ "badgeOverrides.source": "migration" })
    .select("userId username displayName badges badgeOverrides")
    .limit(limit)
    .lean();
  return profiles.map((p) => ({
    creatorId: String(p.userId),
    name: p.displayName || p.username,
    username: p.username,
    badges: p.badges || [],
    keptBadges: (p.badgeOverrides || []).filter((o) => o.source === "migration").map((o) => o.badge),
  }));
}

module.exports = {
  BadgeError,
  badgeMetrics,
  applyBadgeEvaluation,
  setBadgeOverride,
  badgeReport,
  creatorsToReview,
};
