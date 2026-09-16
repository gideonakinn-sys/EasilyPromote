// Joining a campaign: the one path that reserves a Placement for a creator, for every
// campaign model. Used by POST /api/campaigns/:id/join and the older POST /api/slots/claim.
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const CreatorProfile = require("../models/CreatorProfile");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const { joinEligibility } = require("./joinRules");
const { campaignTerms, fullBrief } = require("../utils/campaignPay");
const { emitPlacesLeft } = require("../utils/campaignUpdates");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES } = require("../utils/placementStatuses");

// Open places in the order joins take them; the marketplace prices cards from the same order.
const JOIN_ORDER = { createdAt: 1, _id: 1 };

// The creator's profile and which platforms they've connected: all joining needs.
async function loadJoiner(userId) {
  const [profile, tiktok, metaProviders] = await Promise.all([
    CreatorProfile.findOne({ userId }).lean(),
    TikTokConnection.exists({ userId }),
    MetaConnection.distinct("provider", { userId }),
  ]);
  const connectedPlatforms = [...(tiktok ? ["tiktok"] : []), ...metaProviders.filter(Boolean)];
  return { profile, connectedPlatforms, hasSocial: connectedPlatforms.length > 0 };
}

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

// What this placement would pay and deliver, capped by what's left of the campaign's pool.
// Returns { set } or { refusal }.
function placementTerms({ campaign, slot, committed, committedViews }) {
  const poolRemaining = Math.max((campaign.creatorPool || 0) - committed.reward, 0);

  if (slot.kind === "deliverable") {
    if (poolRemaining < (slot.reward || 0)) {
      return { refusal: refuse(409, "CAMPAIGN_FULL", "This campaign's creator pool just filled up") };
    }
    return { set: { reward: slot.reward } };
  }

  const viewsRemaining = Math.max((campaign.targetViews || 0) - committed.views, 0);
  if (poolRemaining <= 0 || viewsRemaining <= 0) {
    return { refusal: refuse(409, "CAMPAIGN_FULL", "The creator pool for this campaign is fully claimed") };
  }

  let viewTarget = Math.min(slot.viewTarget || Math.ceil(campaign.targetViews / 5), viewsRemaining);
  let reward = Math.min(slot.reward || Math.floor(campaign.creatorPool / 5), poolRemaining);

  if (committedViews !== undefined && committedViews !== null && committedViews !== "") {
    const target = campaign.targetViews || 0;
    const minViews = Math.min(Math.ceil(target * 0.2), viewsRemaining);
    const maxViews = Math.min(Math.ceil(target * 0.5), viewsRemaining);
    const views = Number(committedViews);
    if (!Number.isFinite(views) || views < minViews || views > maxViews) {
      return {
        refusal: refuse(400, "INVALID_COMMITTED_VIEWS", `Committed views must be between ${minViews} and ${maxViews} for the remaining campaign pool`),
      };
    }
    viewTarget = views;
    reward = Math.max(1, Math.min(Math.floor(((campaign.creatorPool || 0) * views) / (campaign.targetViews || 1)), poolRemaining));
  }
  return { set: { viewTarget, reward } };
}

// Gives a reservation back exactly as it was, including fields the place didn't have.
async function release(claimed, original, creatorId) {
  const update = { $set: { creatorId: null, status: "available", claimedAt: null } };
  for (const field of ["reward", "viewTarget"]) {
    if (original[field] === undefined) update.$unset = { ...update.$unset, [field]: 1 };
    else update.$set[field] = original[field];
  }
  await Slot.updateOne({ _id: claimed._id, creatorId, status: "claimed" }, update);
}

// Returns { status, body }. `campaignId` or `slotId` picks the campaign; `slotId` also picks
// the placement (older clients).
async function joinCampaign({ user, campaignId, slotId, committedViews }) {
  const creatorId = user._id;
  let requested = null;
  if (slotId) {
    requested = await Slot.findById(slotId).lean();
    if (!requested) return refuse(404, "PLACEMENT_NOT_FOUND", "Placement not found");
    campaignId = requested.campaignId;
  }
  if (!campaignId) return refuse(400, "CAMPAIGN_REQUIRED", "slotId or campaignId is required");

  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== "live") return refuse(404, "CAMPAIGN_NOT_LIVE", "Campaign not found or not live");

  if (campaignTerms(campaign).creatorAccess === "application_required") {
    return refuse(403, "APPLICATION_REQUIRED", "This campaign needs an application. The brand picks who takes part");
  }

  return reserve({ creatorId, campaign, requested, committedViews });
}

// Campaign engine: applications (ticket 06). Approving an application reserves the creator's
// place through the same guarded path as joining; only the Open Call access check is skipped
// because the brand picked this creator. Returns { status, body } like joinCampaign.
async function reservePlacementFor({ creatorId, campaignId }) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== "live") return refuse(404, "CAMPAIGN_NOT_LIVE", "Campaign not found or not live");
  return reserve({ creatorId, campaign, requested: null, committedViews: undefined });
}

async function reserve({ creatorId, campaign, requested, committedViews }) {
  const [ctx, activeSlots, alreadyHeld, openSlots] = await Promise.all([
    loadJoiner(creatorId),
    Slot.countDocuments({ creatorId, status: { $in: ACTIVE_PLACEMENT_STATUSES } }),
    Slot.exists({ campaignId: campaign._id, creatorId, status: { $in: HELD_PLACEMENT_STATUSES } }),
    requested ? Promise.resolve(null) : Slot.find({ campaignId: campaign._id, status: "available" }).sort(JOIN_ORDER).lean(),
  ]);
  if (alreadyHeld) return refuse(409, "ALREADY_JOINED", "You already have a place in this campaign");

  const available = requested ? (requested.status === "available" ? [requested] : []) : openSlots;
  if (available.length === 0) {
    return requested
      ? refuse(409, "CAMPAIGN_FULL", "This place was just taken by another creator")
      : refuse(409, "CAMPAIGN_FULL", "This campaign just filled up");
  }

  const check = joinEligibility({
    profile: ctx.profile,
    connectedPlatforms: ctx.connectedPlatforms,
    hasSocial: ctx.hasSocial,
    activeSlots,
    campaign,
    availableSlots: available,
  });
  if (!check.eligible) {
    return refuse(403, "NOT_ELIGIBLE", check.failures[0].message, { failures: check.failures });
  }

  const others = await Slot.find({ campaignId: campaign._id, status: { $in: HELD_PLACEMENT_STATUSES } }).select("reward viewTarget").lean();
  const committed = {
    reward: others.reduce((sum, s) => sum + (s.reward || 0), 0),
    views: others.reduce((sum, s) => sum + (s.viewTarget || 0), 0),
  };

  // Reserve atomically: whoever flips a place from available first gets it. If another
  // creator took this one a moment ago, or its terms don't fit, try the next open place.
  let claimed = null;
  let original = null;
  for (const slot of check.slots) {
    const terms = placementTerms({ campaign, slot, committed, committedViews });
    if (terms.refusal) {
      // A bad commitment is the creator's input, not a full campaign.
      if (terms.refusal.body.code === "INVALID_COMMITTED_VIEWS") return terms.refusal;
      continue;
    }
    try {
      claimed = await Slot.findOneAndUpdate(
        { _id: slot._id, status: "available" },
        { $set: { creatorId, status: "claimed", claimedAt: new Date(), ...terms.set } },
        { new: true }
      );
    } catch (error) {
      // The unique index on (campaign, creator) caught a second join by the same creator.
      if (error.code === 11000) return refuse(409, "ALREADY_JOINED", "You already have a place in this campaign");
      throw error;
    }
    if (claimed) {
      original = slot;
      break;
    }
  }
  if (!claimed) {
    return refuse(409, "CAMPAIGN_FULL", requested ? "This place was just taken by another creator" : "This campaign just filled up");
  }

  // The pool check read other reservations before this one was written, so two joins at the
  // same moment could both fit. Re-check with this one in place and give it back if the
  // pool is now over-promised or this creator somehow holds two.
  const [totals] = await Slot.aggregate([
    { $match: { campaignId: campaign._id, status: { $in: HELD_PLACEMENT_STATUSES } } },
    { $group: { _id: null, reward: { $sum: "$reward" }, mine: { $sum: { $cond: [{ $eq: ["$creatorId", creatorId] }, 1, 0] } } } },
  ]);
  if (totals && (totals.reward > (campaign.creatorPool || 0) || totals.mine > 1)) {
    await release(claimed, original, creatorId);
    await emitPlacesLeft(campaign._id);
    return totals.mine > 1
      ? refuse(409, "ALREADY_JOINED", "You already have a place in this campaign")
      : refuse(409, "CAMPAIGN_FULL", "This campaign's creator pool just filled up. Refresh to see what's left.");
  }

  // A code failure must never cost the creator their placement; backfill repairs it.
  let referralCode = null;
  if (campaign.referral && campaign.referral.enabled && campaign.referral.codeSource === "easilypromote") {
    try {
      const { createReferralCode } = require("../utils/referralCodes");
      const code = await createReferralCode({ slot: claimed, campaign });
      referralCode = code ? code.code : null;
    } catch (error) {
      console.error(`[Referral] Code generation failed for slot ${claimed._id}:`, error.message);
    }
  }

  const placesLeft = await emitPlacesLeft(campaign._id);

  return {
    status: 200,
    body: {
      id: claimed._id,
      campaignId: claimed.campaignId,
      status: claimed.status,
      kind: claimed.kind || "views",
      viewTarget: claimed.viewTarget,
      reward: claimed.reward,
      referralCode,
      placesLeft,
      brief: fullBrief(campaign),
    },
  };
}

module.exports = { joinCampaign, reservePlacementFor, loadJoiner, JOIN_ORDER };
