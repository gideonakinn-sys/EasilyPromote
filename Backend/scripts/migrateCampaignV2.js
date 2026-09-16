// Gives campaigns created before the campaign engine their Campaign v2 fields (ADR 0001):
// performance model, the objective their `objective`/referral settings stand for, open call,
// creator page. Only those fields are written — budgets, pools, placements and payments are
// never touched — and campaigns that already have them are skipped, so it's safe to re-run.
//
//   node scripts/migrateCampaignV2.js            # dry run: counts only
//   node scripts/migrateCampaignV2.js --apply    # writes
const Campaign = require("../src/models/Campaign");
const { OBJECTIVES, objectiveForLegacy } = require("../src/utils/campaignObjectives");

function v2FieldsFor(campaign) {
  const objective = objectiveForLegacy(campaign);
  const definition = OBJECTIVES[objective];
  return {
    campaignObjective: objective,
    campaignModel: definition.campaignModel,
    payShape: "performance",
    rateAuthority: definition.rateAuthority,
    performanceMetric: definition.performanceMetric,
    contentDestination: "creator_page",
    creatorAccess: "open_call",
  };
}

async function migrateCampaignsToV2({ dryRun = true, log = () => {} } = {}) {
  const pending = { campaignObjective: { $exists: false } };
  const campaigns = await Campaign.find(pending).select("_id name objective referral.eventType referral.eventTypes").lean();
  const byObjective = {};
  let migrated = 0;

  for (const campaign of campaigns) {
    const fields = v2FieldsFor(campaign);
    byObjective[fields.campaignObjective] = (byObjective[fields.campaignObjective] || 0) + 1;
    if (dryRun) continue;
    // Raw collection update: no save hooks, so nothing derived (price, fee, pool) is recalculated.
    const result = await Campaign.collection.updateOne({ _id: campaign._id, ...pending }, { $set: fields });
    migrated += result.modifiedCount;
    log(`${campaign._id} ${campaign.name} → ${fields.campaignObjective}`);
  }

  return { toMigrate: campaigns.length, migrated, byObjective, dryRun };
}

module.exports = { migrateCampaignsToV2, v2FieldsFor };

if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const apply = process.argv.includes("--apply");
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => migrateCampaignsToV2({ dryRun: !apply, log: console.log }))
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (!apply) console.log("Dry run only. Re-run with --apply to write.");
    })
    .catch((error) => {
      console.error("Migration failed:", error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
