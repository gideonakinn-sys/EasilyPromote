const Slot = require("../models/Slot");
const Campaign = require("../models/Campaign");
const { emitToUser } = require("../config/socket");

function mapStatusToCreator(submission, campaign) {
  if (!submission) return "needs_content";

  switch (submission.status) {
    case "new":
      return "under_review";
    case "awaiting_post":
    case "approved":
      return "approved_post";
    case "posted":
      if (submission.viewsDelivered >= campaign.targetViews) {
        return "delivered";
      }
      return "live_tracking";
    case "rejected":
      return "changes_requested";
    default:
      return "under_review";
  }
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

  let status = mapStatusToCreator(submission, campaign);
  if (campaign.status === "cancelled") status = "cancelled";

  const viewTarget = slot ? slot.viewTarget : campaign.targetViews;
  const progress =
    submission.viewsDelivered > 0
      ? Math.min(Number(((submission.viewsDelivered / (viewTarget || campaign.targetViews)) * 100).toFixed(3)), 100)
      : 0;

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

module.exports = { emitCampaignUpdate, emitCampaignStatus, mapStatusToCreator, buildCampaignUpdate };
