// One-time backfill: seed ViewSnapshot from the historical `views_synced`
// SubmissionEvents (which already carry a per-sync `metadata.delta` + timestamp).
// Run manually:  node src/scripts/backfillViewSnapshots.js
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const SubmissionEvent = require("../models/SubmissionEvent");
const Campaign = require("../models/Campaign");
const ViewSnapshot = require("../models/ViewSnapshot");

function startOfUtcDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function run() {
  await connectDB();

  const events = await SubmissionEvent.find({ type: "views_synced" }).lean();
  console.log(`Found ${events.length} views_synced events`);

  const campaignIds = [...new Set(events.map((e) => String(e.campaignId)))];
  const campaigns = await Campaign.find({ _id: { $in: campaignIds } })
    .select("businessId")
    .lean();
  const businessByCampaign = new Map(campaigns.map((c) => [c._id.toString(), c.businessId]));

  const byKey = new Map(); // `${campaignId}|${day}` -> { businessId, views }
  for (const e of events) {
    const delta = e.metadata && Number(e.metadata.delta);
    if (!delta || delta <= 0) continue;
    const businessId = businessByCampaign.get(String(e.campaignId));
    if (!businessId) continue;
    const date = startOfUtcDay(e.createdAt);
    const key = `${e.campaignId}|${date.toISOString().slice(0, 10)}`;
    const existing = byKey.get(key) || { businessId, views: 0 };
    existing.views += delta;
    byKey.set(key, existing);
  }

  let written = 0;
  for (const [key, entry] of byKey) {
    const [campaignId, day] = key.split("|");
    const date = startOfUtcDay(new Date(day));
    await ViewSnapshot.updateOne(
      { campaignId, date },
      { $inc: { views: entry.views }, $setOnInsert: { businessId: entry.businessId } },
      { upsert: true }
    );
    written += 1;
  }

  console.log(`Seeded ${written} daily snapshots`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});