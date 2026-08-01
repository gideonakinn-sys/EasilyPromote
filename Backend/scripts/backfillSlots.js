// One-time backfill: generate slots for all existing live campaigns.
// Usage: node scripts/backfillSlots.js
require("dotenv").config();
const mongoose = require("mongoose");
const Campaign = require("../src/models/Campaign");
const { ensureCampaignSlots } = require("../src/utils/ensureSlots");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI not set. Aborting.");
    process.exit(1);
  }

  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected to MongoDB.");

  const campaigns = await Campaign.find({ status: { $in: ["live", "paused", "under_review"] } });
  let created = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    const slots = await ensureCampaignSlots(campaign);
    if (slots.length > 0) {
      created += slots.length;
      console.log(`  ${campaign.name}: +${slots.length} slots`);
    } else {
      skipped += 1;
      console.log(`  ${campaign.name}: already has slots, skipped`);
    }
  }

  console.log(`Done. Created ${created} slots across ${campaigns.length} campaigns (${skipped} skipped).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
