const Slot = require("../models/Slot");

const DEFAULT_SLOT_COUNT = 5;

function slotCountFor(campaign) {
  const count = Number(campaign.slotCount) || DEFAULT_SLOT_COUNT;
  return Math.max(1, Math.min(100, Math.floor(count)));
}

function buildSlots(campaign, count) {
  const viewTarget = Math.ceil(campaign.targetViews / count);
  const reward = Math.floor(campaign.creatorPool / count);

  return Array.from({ length: count }, () => ({
    campaignId: campaign._id,
    creatorId: null,
    rankRequired: null,
    viewTarget,
    reward,
    status: "available",
  }));
}

/**
 * Generates available slots for a live campaign. Idempotent — if the campaign
 * already has any slots, it does nothing. Each slot carries an equal share of
 * the campaign's target views and creator pool.
 */
async function ensureCampaignSlots(campaign) {
  if (!campaign) return [];

  const existing = await Slot.countDocuments({ campaignId: campaign._id });
  if (existing > 0) return [];

  const count = slotCountFor(campaign);
  return Slot.insertMany(buildSlots(campaign, count));
}

/**
 * Rebuilds the campaign's available slots to match a new slot count. Deletes
 * only unclaimed (available) slots and recreates them for the given count.
 * Claimed/active slots are preserved. Used by admin when editing slot count.
 */
async function syncCampaignSlots(campaign, count) {
  if (!campaign) return [];

  const target = Math.max(1, Math.min(100, Math.floor(Number(count) || DEFAULT_SLOT_COUNT)));
  campaign.slotCount = target;
  await campaign.save();

  await Slot.deleteMany({
    campaignId: campaign._id,
    status: "available",
  });

  return Slot.insertMany(buildSlots(campaign, target));
}

module.exports = { ensureCampaignSlots, syncCampaignSlots, DEFAULT_SLOT_COUNT };
