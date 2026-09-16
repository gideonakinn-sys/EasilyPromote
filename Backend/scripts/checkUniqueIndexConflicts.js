#!/usr/bin/env node
// Read-only pre-deploy check for the unique indexes on transactions, withdrawals and
// placements (slots). MongoDB can't build a unique index over existing duplicates;
// resolve any found first.
//
// Placements: slots have a unique { campaignId, creatorId } index for slots that have a
// creator (Slot model). A creator holding more than one placement in a campaign blocks
// it; the listed slot ids and statuses show which placement to release or merge.
//
//   MONGODB_URI=<connection string> node scripts/checkUniqueIndexConflicts.js

require("dotenv").config();
const mongoose = require("mongoose");

async function duplicates(collection, match, groupId, extra) {
  return mongoose.connection
    .collection(collection)
    .aggregate([
      { $match: match },
      { $group: { _id: groupId, count: { $sum: 1 }, ids: { $push: "$_id" }, ...extra } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const checks = [
    {
      label: "transactions {reference, type}",
      rows: await duplicates(
        "transactions",
        { reference: { $type: "string" } },
        { reference: "$reference", type: "$type" },
        { amounts: { $push: "$amount" }, statuses: { $push: "$status" } }
      ),
    },
  ];
  checks.push({
    label: "slots {campaignId, creatorId} with a creator",
    rows: await duplicates(
      "slots",
      { creatorId: { $type: "objectId" } },
      { campaignId: "$campaignId", creatorId: "$creatorId" },
      { statuses: { $push: "$status" }, rewards: { $push: "$reward" } }
    ),
  });
  for (const status of ["pending", "processing"]) {
    checks.push({
      label: `withdrawals ${status} {creatorId, campaignId, kind}`,
      rows: await duplicates(
        "withdrawals",
        { status },
        { creatorId: "$creatorId", campaignId: "$campaignId", kind: { $ifNull: ["$kind", "views"] } },
        { amounts: { $push: "$amount" } }
      ),
    });
  }

  let conflicts = 0;
  for (const check of checks) {
    if (check.rows.length === 0) {
      console.log(`OK  ${check.label}`);
      continue;
    }
    conflicts += check.rows.length;
    console.log(`CONFLICT  ${check.label}: ${check.rows.length} duplicated group(s)`);
    for (const row of check.rows) console.log("   ", JSON.stringify(row));
  }

  await mongoose.disconnect();
  process.exit(conflicts === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
