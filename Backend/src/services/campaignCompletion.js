// Admin "Complete Campaign" (M7): ends a live or paused campaign of any model. Creators who hold a
// place keep it and can finish what they started; places nobody took close, so the campaign
// leaves the marketplace and joins and applications are refused (both need a live campaign).
// Pending applications expire on the next application deadline run. For content campaigns,
// completion is what lets finance refund the unused budget.
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const { recordAdminActivity } = require("./adminActivity");
const { emitCampaignStatus } = require("../utils/campaignUpdates");
const { isContentCampaign } = require("../utils/campaignPay");

const COMPLETABLE_STATUSES = ["live", "paused"];
const COMPLETE_ROLES = ["admin", "super_admin", "finance_admin"];

class CompletionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Closes the places nobody holds. A place that a rejected creator's content still points at stays
// open, so an appeal decided later can give it back to them.
async function closeUnclaimedPlaces(campaignId) {
  const referenced = await Submission.distinct("slotId", { campaignId, slotId: { $type: "objectId" } });
  const result = await Slot.updateMany(
    { campaignId, status: "available", creatorId: null, _id: { $nin: referenced } },
    { $set: { status: "closed" } }
  );
  return result.modifiedCount;
}

// Returns { campaign, closedPlaces, previousStatus }. Throws CompletionError for a campaign that
// doesn't exist or isn't live or paused.
async function completeCampaign({ campaignId, req, note = null, now = new Date() }) {
  const existing = await Campaign.findById(campaignId).select("status").lean();
  if (!existing) throw new CompletionError(404, "NOT_FOUND", "Campaign not found");
  const campaign = await Campaign.findOneAndUpdate(
    { _id: campaignId, status: { $in: COMPLETABLE_STATUSES } },
    { $set: { status: "completed", completedAt: now, statusNote: null } },
    { new: true }
  );
  if (!campaign) {
    throw new CompletionError(409, "NOT_COMPLETABLE", `Only live or paused campaigns can be completed; this one is ${existing.status}`);
  }

  const closedPlaces = await closeUnclaimedPlaces(campaign._id);
  await emitCampaignStatus(campaign);

  const cleanNote = String(note || "").trim().slice(0, 1000) || null;
  const content = isContentCampaign(campaign);
  await Notification.create({
    businessId: campaign.businessId,
    campaignId: campaign._id,
    type: "campaign_completed",
    title: "Campaign completed",
    body:
      `Our team marked "${campaign.name}" as completed. Creators who already have a place can finish their work; no new creators can join.` +
      (content ? " Any unused deliverable budget will be refunded to your payment method by our team." : "") +
      (cleanNote ? ` Note: ${cleanNote}` : ""),
  });

  await recordAdminActivity(req, {
    action: "campaign.completed",
    targetType: "campaign",
    targetId: campaign._id,
    targetLabel: campaign.name,
    businessId: campaign.businessId,
    note: cleanNote,
    metadata: { from: existing.status, to: "completed", closedPlaces },
  });

  return { campaign, closedPlaces, previousStatus: existing.status };
}

module.exports = { completeCampaign, closeUnclaimedPlaces, CompletionError, COMPLETE_ROLES, COMPLETABLE_STATUSES };
