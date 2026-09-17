const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const { emitToUser, emitToRole } = require("../config/socket");
// Campaign engine: content approval (ticket 07)
const { isContentCampaign } = require("./campaignPay");

const isDeliverable = (slot) => Boolean(slot && slot.kind === "deliverable");

// A posted deliverable is delivered: it pays a fixed rate, not per view.
function mapStatusToCreator(submission, campaign, slot = null) {
  if (!submission) return "needs_content";

  switch (submission.status) {
    case "new":
      return "under_review";
    case "awaiting_post":
    case "approved":
      return "approved_post";
    case "posted":
      if (isDeliverable(slot) || (campaign.targetViews > 0 && submission.viewsDelivered >= campaign.targetViews)) {
        return "delivered";
      }
      return "live_tracking";
    case "rejected":
      // Campaign engine: content approval (ticket 07): content rejection is final (appealable).
      return isContentCampaign(campaign) ? "rejected" : "changes_requested";
    // Campaign engine: content approval (ticket 07). The exact step is in contentApproval.status.
    case "changes_requested":
      return "changes_requested";
    case "awaiting_delivery":
    case "awaiting_receipt":
      return "approved_post";
    case "verifying":
      return isDeliverable(slot) ? "approved_post" : "under_review";
    case "completed":
      return "delivered";
    default:
      return "under_review";
  }
}

// Percent of the placement's view target delivered; deliverable placements have none.
function deliveryProgress(submission, slot, campaign) {
  const target = (slot && slot.viewTarget) || (campaign && campaign.targetViews) || 0;
  if (isDeliverable(slot) || !submission || !(submission.viewsDelivered > 0) || target <= 0) return 0;
  return Math.min(Number(((submission.viewsDelivered / target) * 100).toFixed(3)), 100);
}

function buildDelivery(submission, slot) {
  if (slot && slot.status === "claimed") return "Claimed";
  if (submission && submission.status === "posted") return "Live";
  if (submission && (submission.status === "awaiting_post" || submission.status === "approved")) {
    return "Awaiting Post";
  }
  return "Submitted";
}

async function buildCampaignUpdate(submission) {
  const campaign = await Campaign.findById(submission.campaignId);
  if (!campaign) return null;

  const slot = await Slot.findOne({
    campaignId: campaign._id,
    creatorId: submission.creatorId,
  });

  let status = mapStatusToCreator(submission, campaign, slot);
  if (campaign.status === "cancelled") status = "cancelled";

  const viewTarget = slot ? slot.viewTarget : campaign.targetViews;
  const progress = deliveryProgress(submission, slot, campaign);

  return {
    campaignId: campaign._id,
    slotId: slot ? slot._id : null,
    status,
    reward: slot ? slot.reward : null,
    viewTarget,
    costPerView: campaign.costPerView,
    progress,
    currentViews: submission.viewsDelivered,
    targetViews: campaign.targetViews,
    submissionId: submission._id,
    comment: submission.status === "rejected" ? submission.rejectionReason : undefined,
    delivery: buildDelivery(submission, slot),
    postedPlatforms: submission.postedPlatforms || undefined,
  };
}

async function emitCampaignUpdate(submission) {
  if (!submission || !submission.creatorId) return;

  const payload = await buildCampaignUpdate(submission);
  if (!payload) return;

  emitToUser(submission.creatorId, "campaign-update", payload);

  const campaign = await Campaign.findById(submission.campaignId);
  if (campaign && campaign.businessId) {
    emitToUser(campaign.businessId, "campaign-status", {
      campaignId: campaign._id,
      status: campaign.status,
      viewsDelivered: campaign.viewsDelivered,
      targetViews: campaign.targetViews,
    });
  }
}

async function emitCampaignStatus(campaign) {
  if (!campaign) return;

  // Going live, pausing or cancelling changes how many places creators can take.
  await emitPlacesLeft(campaign._id);

  if (campaign.businessId) {
    emitToUser(campaign.businessId, "campaign-status", {
      campaignId: campaign._id,
      status: campaign.status,
      viewsDelivered: campaign.viewsDelivered,
      targetViews: campaign.targetViews,
    });
  }

  const slots = await Slot.find({ campaignId: campaign._id });
  for (const slot of slots) {
    if (!slot.creatorId) continue;
    emitToUser(slot.creatorId, "campaign-update", {
      campaignId: campaign._id,
      slotId: slot._id,
      status: campaign.status === "cancelled" ? "cancelled" : undefined,
      delivery: slot.status === "claimed" ? "Claimed" : undefined,
    });
  }
}

// Places left on a campaign, sent to creators (who browse the marketplace) whenever it
// changes: a join, a released place, a cancellation, a top-up, an admin resize or a
// deleted account. A campaign that isn't live has no places. Returns the count.
// `known.placesLeft`: a count the caller just made on a campaign it knows is live.
async function emitPlacesLeft(campaignId, known = {}) {
  let placesLeft = known.placesLeft;
  if (placesLeft === undefined) {
    const campaign = await Campaign.findById(campaignId).select("status").lean();
    placesLeft = campaign && campaign.status === "live" ? await Slot.countDocuments({ campaignId, status: "available" }) : 0;
  }
  emitToRole("creator", "campaign-places", { campaignId: String(campaignId), placesLeft });
  return placesLeft;
}

module.exports = { emitCampaignUpdate, emitCampaignStatus, emitPlacesLeft, mapStatusToCreator, deliveryProgress, buildCampaignUpdate };
