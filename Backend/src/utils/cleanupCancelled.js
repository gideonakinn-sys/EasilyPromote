const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run every hour
const CANCELLED_TTL_MS = 24 * 60 * 60 * 1000; // delete cancelled campaigns after 24h

async function cleanupCancelledCampaigns() {
  try {
    const cutoff = new Date(Date.now() - CANCELLED_TTL_MS);
    const stale = await Campaign.find({
      status: "cancelled",
      updatedAt: { $lt: cutoff },
    });

    for (const campaign of stale) {
      await Slot.deleteMany({ campaignId: campaign._id });
      await Submission.deleteMany({ campaignId: campaign._id });
      await campaign.deleteOne();
      console.log(`[Cleanup] Deleted cancelled campaign ${campaign._id}`);
    }
  } catch (error) {
    console.error("[Cleanup] Failed to clean cancelled campaigns:", error.message);
  }
}

function startCancelledCleanup() {
  cleanupCancelledCampaigns();
  setInterval(cleanupCancelledCampaigns, CLEANUP_INTERVAL_MS);
}

module.exports = { startCancelledCleanup };
