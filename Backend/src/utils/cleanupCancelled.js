const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const ReferralCode = require("../models/ReferralCode");
const ConversionEvent = require("../models/ConversionEvent");
const CampaignApplication = require("../models/CampaignApplication");

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run every hour
const CANCELLED_TTL_MS = 24 * 60 * 60 * 1000; // remove cancelled campaigns after 24h

// A cancelled campaign is only removed when nothing depends on it. Money that moved,
// creators who joined or applied, content and conversions all back refunds, pay owed,
// appeals and the payout history, so those campaigns are kept for good.
async function hasDependents(campaignId) {
  const checks = await Promise.all([
    Transaction.exists({ campaignId }),
    Withdrawal.exists({ campaignId }),
    Slot.exists({ campaignId, creatorId: { $ne: null } }),
    Submission.exists({ campaignId }),
    CampaignApplication.exists({ campaign: campaignId }),
    ReferralCode.exists({ campaignId }),
    ConversionEvent.exists({ campaignId }),
  ]);
  return checks.some(Boolean);
}

async function cleanupCancelledCampaigns({ now = new Date() } = {}) {
  const summary = { removed: 0, kept: 0 };
  try {
    const cutoff = new Date(now.getTime() - CANCELLED_TTL_MS);
    const stale = await Campaign.find({ status: "cancelled", updatedAt: { $lt: cutoff } }).select("_id").lean();

    for (const campaign of stale) {
      if (await hasDependents(campaign._id)) {
        summary.kept += 1;
        continue;
      }
      // Only unclaimed places can be left at this point.
      await Slot.deleteMany({ campaignId: campaign._id, creatorId: null });
      await Campaign.deleteOne({ _id: campaign._id, status: "cancelled" });
      summary.removed += 1;
      console.log(`[Cleanup] Deleted cancelled campaign ${campaign._id}`);
    }
  } catch (error) {
    console.error("[Cleanup] Failed to clean cancelled campaigns:", error.message);
  }
  return summary;
}

function startCancelledCleanup() {
  cleanupCancelledCampaigns();
  setInterval(cleanupCancelledCampaigns, CLEANUP_INTERVAL_MS);
}

module.exports = { startCancelledCleanup, cleanupCancelledCampaigns, hasDependents };
