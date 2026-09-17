// Joining a campaign: the one path that reserves a Placement for a creator, for every
// campaign model. Used by POST /api/campaigns/:id/join and the older POST /api/slots/claim.
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const { loadCreatorAccounts } = require("../utils/creatorAccounts");
const { joinEligibility } = require("./joinRules");
const { campaignTerms, fullBrief } = require("../utils/campaignPay");
const { emitPlacesLeft } = require("../utils/campaignUpdates");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS } = require("../utils/placementStatuses");

// Open places in the order joins take them; the marketplace prices cards from the same order.
const JOIN_ORDER = { createdAt: 1, _id: 1 };

// The creator's profile and which platforms they've connected: all joining needs.
async function loadJoiner(userId) {
  const { profile, tiktok, metaConnections } = await loadCreatorAccounts(userId);
  const metaProviders = [...new Set(metaConnections.map((c) => c.provider))];
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
async function joinCampaign({ user, campaignId, slotId, committedViews, usageRightsAccepted }) {
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

  // Rejected (or appealed) content frees the place for someone else; the creator appeals
  // instead of taking a new place they couldn't submit to. Only Open Call joins check this:
  // an approved application can't be approved again, and approval never reads submissions (ADR 0002).
  const earlier = await Submission.findOne({ campaignId: campaign._id, creatorId, status: { $in: ["rejected", "appealed", "not_delivered"] } })
    .select("status")
    .lean();
  if (earlier && earlier.status === "not_delivered") {
    // Their pay was voided and the place given to someone else.
    return refuse(409, "CONTENT_NOT_DELIVERED", "Your approved content for this campaign was never delivered, so you can't join it again");
  }
  if (earlier) {
    return refuse(409, "CONTENT_REJECTED", "Your content for this campaign was rejected. You can appeal the decision instead of joining again");
  }

  // M8 batch 7: validate usage rights acceptance (SPEC D30).
  const rightsSet = campaign.usageRights && campaign.usageRights.type === "custom";
  if (rightsSet) {
    if (!usageRightsAccepted || usageRightsAccepted.version !== campaign.usageRights.version) {
      return refuse(400, "USAGE_TERMS_NOT_ACCEPTED", "Accept the campaign's usage rights terms before joining");
    }
  }

  return takePlacement({ creatorId, campaign, requested, committedViews, usageRightsAccepted: rightsSet ? usageRightsAccepted : null });
}

// Campaign engine: applications (ticket 06)
// Seams for tests only: `afterTake` runs right after a place is taken, to prove a failure
// there gives the place back; `beforeReserve` runs before an approval reads the campaign.
const testHooks = { afterTake: null, beforeReserve: null };

// Everything joining or applying needs to know about this creator and campaign.
// `requested` limits the open places to one (older clients).
// The campaign's open and held places come from one query: open ones in join order, held ones
// for this creator's own place and for what the pool has already promised.
async function loadJoinContext({ creatorId, campaign, requested = null }) {
  const [joiner, activeSlots, campaignSlots] = await Promise.all([
    loadJoiner(creatorId),
    Slot.countDocuments({ creatorId, status: { $in: ACTIVE_PLACEMENT_STATUSES } }),
    Slot.find({ campaignId: campaign._id, status: { $in: ["available", ...HELD_PLACEMENT_STATUSES] } }).sort(JOIN_ORDER).lean(),
  ]);
  const held = campaignSlots.filter((s) => HELD_PLACEMENT_STATUSES.includes(s.status));
  const heldSlot = held.find((s) => s.creatorId && String(s.creatorId) === String(creatorId)) || null;
  const openSlots = campaignSlots.filter((s) => s.status === "available");
  const available = requested ? (requested.status === "available" ? [requested] : []) : openSlots;
  return { joiner, activeSlots, heldSlot, held, available };
}

// The join eligibility check. A creator the brand picked isn't held to a place's rank
// requirement; the campaign's own Creator Eligibility and account-wide limits still apply.
function checkJoiner({ context, campaign, pickedByBrand = false }) {
  const slots = pickedByBrand ? context.available.map((s) => ({ ...s, rankRequired: null })) : context.available;
  return joinEligibility({
    profile: context.joiner.profile,
    connectedPlatforms: context.joiner.connectedPlatforms,
    hasSocial: context.joiner.hasSocial,
    activeSlots: context.activeSlots,
    campaign,
    availableSlots: slots,
  });
}

async function placementBody(slot, campaign, referralCode, placesLeft) {
  let code = referralCode;
  if (code === undefined) {
    const ReferralCode = require("../models/ReferralCode");
    const existing = await ReferralCode.findOne({ slotId: slot._id }).select("code").lean();
    code = existing ? existing.code : null;
  }
  return {
    id: slot._id,
    campaignId: slot.campaignId,
    status: slot.status,
    kind: slot.kind || "views",
    viewTarget: slot.viewTarget,
    reward: slot.reward,
    referralCode: code,
    placesLeft: placesLeft !== undefined ? placesLeft : await Slot.countDocuments({ campaignId: campaign._id, status: "available" }),
    brief: fullBrief(campaign),
  };
}

// Approving an application takes the creator's place through the same guarded path as
// joining; the Open Call access check and place rank requirements are skipped because the
// brand picked this creator. A place the creator already holds here is returned as theirs
// (e.g. left by an earlier approval that failed part-way). Returns { status, body }.
async function reservePlacementFor({ creatorId, campaignId }) {
  if (testHooks.beforeReserve) await testHooks.beforeReserve({ creatorId, campaignId });
  // Always read fresh: the caller's copy may be from before a pause. takePlacement checks the
  // status again once the place is taken.
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== "live") return refuse(404, "CAMPAIGN_NOT_LIVE", "Campaign not found or not live");
  const result = await takePlacement({ creatorId, campaign, pickedByBrand: true });
  if (result.status === 409 && result.body.code === "ALREADY_JOINED") {
    const held = await Slot.findOne({ campaignId: campaign._id, creatorId, status: { $in: HELD_PLACEMENT_STATUSES } }).lean();
    if (held) return { status: 200, body: await placementBody(held, campaign) };
  }
  return result;
}

async function takePlacement({ creatorId, campaign, requested = null, committedViews, pickedByBrand = false, usageRightsAccepted = null }) {
  const context = await loadJoinContext({ creatorId, campaign, requested });
  if (context.heldSlot) return refuse(409, "ALREADY_JOINED", "You already have a place in this campaign");
  const { available } = context;

  if (available.length === 0) {
    return requested
      ? refuse(409, "CAMPAIGN_FULL", "This place was just taken by another creator")
      : refuse(409, "CAMPAIGN_FULL", "This campaign just filled up");
  }

  const check = checkJoiner({ context, campaign, pickedByBrand });
  if (!check.eligible) {
    return refuse(403, "NOT_ELIGIBLE", check.failures[0].message, { failures: check.failures });
  }

  const others = context.held;
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
        { $set: { creatorId, status: "claimed", claimedAt: new Date(), ...terms.set, ...(usageRightsAccepted ? { usageRightsAccepted: { version: usageRightsAccepted.version, acceptedAt: new Date() } } : {}) } },
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

  // From here the place is taken: anything that throws gives it back before rethrowing, so
  // a failure can never leave a creator holding a place nobody knows about.
  let body;
  try {
    if (testHooks.afterTake) await testHooks.afterTake({ slot: claimed, creatorId, campaign });

    // The pool check read other reservations before this one was written, so two joins at the
    // same moment could both fit. Re-check with this one in place, against the campaign as it is
    // now, and give it back if the campaign stopped being live, the pool is over-promised or this
    // creator somehow holds two. The same read counts the places left for the response and the
    // live update.
    // The same goes for the creator's placement limit: joins to different campaigns at the same
    // moment all counted the active placements before any was taken (the load test found a creator
    // holding 6). The creator's oldest active placements up to the limit are the ones that stand, so
    // whichever joins check, exactly the later ones give their place back.
    const isHeld = { $in: ["$status", HELD_PLACEMENT_STATUSES] };
    const [current, [totals], keptActive] = await Promise.all([
      Campaign.findById(campaign._id).select("status creatorPool").lean(),
      Slot.aggregate([
        { $match: { campaignId: campaign._id, status: { $in: ["available", ...HELD_PLACEMENT_STATUSES] } } },
        {
          $group: {
            _id: null,
            reward: { $sum: { $cond: [isHeld, "$reward", 0] } },
            mine: { $sum: { $cond: [{ $and: [isHeld, { $eq: ["$creatorId", creatorId] }] }, 1, 0] } },
            available: { $sum: { $cond: [{ $eq: ["$status", "available"] }, 1, 0] } },
          },
        },
      ]),
      Slot.find({ creatorId, status: { $in: ACTIVE_PLACEMENT_STATUSES } })
        .sort({ claimedAt: 1, _id: 1 })
        .limit(MAX_ACTIVE_PLACEMENTS)
        .select("_id")
        .lean(),
    ]);
    if (!current || current.status !== "live") {
      await release(claimed, original, creatorId);
      announcePlacesLeft(campaign._id);
      return refuse(409, "CAMPAIGN_NOT_LIVE", "This campaign isn't live any more, so no place was reserved");
    }
    if (totals && (totals.reward > (current.creatorPool || 0) || totals.mine > 1)) {
      await release(claimed, original, creatorId);
      announcePlacesLeft(campaign._id);
      return totals.mine > 1
        ? refuse(409, "ALREADY_JOINED", "You already have a place in this campaign")
        : refuse(409, "CAMPAIGN_FULL", "This campaign's creator pool just filled up. Refresh to see what's left.");
    }
    if (ACTIVE_PLACEMENT_STATUSES.includes(claimed.status) && !keptActive.some((s) => String(s._id) === String(claimed._id))) {
      await release(claimed, original, creatorId);
      announcePlacesLeft(campaign._id);
      const message = `You have ${MAX_ACTIVE_PLACEMENTS} active placements. Finish one to join another`;
      return refuse(403, "NOT_ELIGIBLE", message, { failures: [{ criterion: "placementLimit", message }] });
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

    body = await placementBody(claimed, campaign, referralCode, totals ? totals.available : 0);
  } catch (error) {
    await release(claimed, original, creatorId);
    announcePlacesLeft(campaign._id);
    throw error;
  }

  announcePlacesLeft(campaign._id, body.placesLeft);
  return { status: 200, body };
}

// Live places-left update for creators; never allowed to fail a join. `placesLeft`, when this
// request already counted it on a live campaign, saves the lookup.
function announcePlacesLeft(campaignId, placesLeft) {
  emitPlacesLeft(campaignId, { placesLeft }).catch((error) => console.error(`[Placements] Places-left update for ${campaignId} failed:`, error.message));
}

module.exports = {
  joinCampaign,
  reservePlacementFor,
  loadJoinContext,
  checkJoiner,
  refuse,
  testHooks,
  JOIN_ORDER,
};
