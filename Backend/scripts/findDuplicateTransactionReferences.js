#!/usr/bin/env node
// Read-only pre-deploy check for the unique {reference, type} index on transactions.
// If any duplicates exist, MongoDB can't build the index; resolve them first.
//
//   MONGODB_URI=<connection string> node scripts/findDuplicateTransactionReferences.js

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const duplicates = await mongoose.connection
    .collection("transactions")
    .aggregate([
      { $match: { reference: { $type: "string" } } },
      {
        $group: {
          _id: { reference: "$reference", type: "$type" },
          count: { $sum: 1 },
          ids: { $push: "$_id" },
          campaignIds: { $addToSet: "$campaignId" },
          amounts: { $push: "$amount" },
          statuses: { $push: "$status" },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  if (duplicates.length === 0) {
    console.log("No duplicate {reference, type} transactions. The unique index can be built.");
  } else {
    console.log(`${duplicates.length} duplicated {reference, type} pair(s) — resolve before deploying:`);
    for (const d of duplicates) {
      console.log(JSON.stringify({ reference: d._id.reference, type: d._id.type, count: d.count, ids: d.ids, campaignIds: d.campaignIds, amounts: d.amounts, statuses: d.statuses }));
    }
  }

  await mongoose.disconnect();
  process.exit(duplicates.length === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
