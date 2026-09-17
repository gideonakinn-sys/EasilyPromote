#!/usr/bin/env node
// Read-only money check for every campaign with money on record: paid in = creator payouts
// (released and in flight) + owed to creators + platform fee kept + refunds (succeeded and pending)
// + what's left in the pools, to the kobo, per pot (views, referral, fixed), with the fee, per-creator
// payouts and content refunds checked independently. Lists every campaign that doesn't balance
// and why. Writes nothing. Exits 1 when any campaign has a problem.
//
//   MONGODB_URI=<connection string> node scripts/reconcileCampaigns.js [--all]
//
// --all also prints the campaigns that balance.

require("dotenv").config();
// Before any model loads: nothing may build an index or create a collection.
const { connectReadOnly, disableAutoBuild } = require("./scriptConnection");
disableAutoBuild();
const mongoose = require("mongoose");
const { reconcileAllCampaigns } = require("../src/services/campaignReconciliation");

const money = (value) => `₦${Number(value).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI");
    process.exit(2);
  }
  const showAll = process.argv.includes("--all");
  await connectReadOnly(uri);

  let checked = 0;
  let failing = 0;
  await reconcileAllCampaigns({
    onResult(result) {
      checked += 1;
      if (!result.ok) failing += 1;
      if (result.ok && !showAll) return;
      console.log(`${result.ok ? "OK  " : "FAIL"} ${result.campaignId} ${result.name || ""} (${result.status})`);
      console.log(
        `     paid in ${money(result.paidIn)} = released ${money(result.released)} + in flight ${money(result.inFlight)} + owed ${money(result.owed)}` +
          ` + fee ${money(result.platformFee)} + refunds ${money(result.refunds)} + refunds pending ${money(result.pendingRefunds)}` +
          ` + left ${money(result.left)}${result.failedRefunds > 0 ? ` (failed refunds ${money(result.failedRefunds)})` : ""}`
      );
      for (const problem of result.problems) console.log(`     - ${problem}`);
    },
  });

  console.log(`\nChecked ${checked} campaign${checked === 1 ? "" : "s"}; ${failing} don't balance.`);
  await mongoose.disconnect();
  process.exit(failing > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(2);
});
