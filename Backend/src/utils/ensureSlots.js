const Slot = require("../models/Slot");

const DEFAULT_SLOT_COUNT = 5;

/**
 * Generates available slots for a live campaign. Idempotent — if the campaign
 * already has any slots, it does nothing. Each slot carries an equal share of
 * the campaign's target views and creator pool.
 */
async function ensureCampaignSlots(campaign) {
  if (!campaign) return [];

  const existing = await Slot.countDocuments({ campaignId: campaign._id });
  if (existing > 0) return [];

  const count = DEFAULT_SLOT_COUNT;
  const viewTarget = Math.ceil(campaign.targetViews / count);
  const reward = Math.floor(campaign.creatorPool / count);

  const slots = Array.from({ length: count }, () => ({
    campaignId: campaign._id,
    creatorId: null,
    rankRequired: null,
    viewTarget,
    reward,
    status: "available",
  }));

  return Slot.insertMany(slots);
}

module.exports = { ensureCampaignSlots, DEFAULT_SLOT_COUNT };
