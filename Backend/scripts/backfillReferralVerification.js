#!/usr/bin/env node
// One-off: brands whose servers already send signed requests shouldn't have to connect
// again. Rebuilds referralVerification from the request log (WebhookDelivery), counting
// only requests from brands' own servers, never the dashboard test sender.
// The request log only keeps recent history, so older brands may still need to send
// one code check and one test conversion.
//
//   MONGODB_URI=<connection string> node scripts/backfillReferralVerification.js          # dry run
//   MONGODB_URI=<connection string> node scripts/backfillReferralVerification.js --apply  # write

require("dotenv").config();
const mongoose = require("mongoose");
const BusinessProfile = require("../src/models/BusinessProfile");
const WebhookDelivery = require("../src/models/WebhookDelivery");

async function firstRequestPerBrand(match) {
  const rows = await WebhookDelivery.aggregate([
    { $match: match },
    { $group: { _id: "$businessId", first: { $min: "$createdAt" } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.first]));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  await mongoose.connect(uri);

  const [codeChecks, conversions] = await Promise.all([
    firstRequestPerBrand({ source: "code_check", statusCode: 200 }),
    firstRequestPerBrand({ source: "webhook", result: { $in: ["test_ok", "recorded", "ignored"] } }),
  ]);

  const brandIds = new Set([...codeChecks.keys(), ...conversions.keys()]);
  let verified = 0;
  let partial = 0;
  for (const brandId of brandIds) {
    const codeCheckAt = codeChecks.get(brandId) || null;
    const conversionAt = conversions.get(brandId) || null;
    const verifiedAt = codeCheckAt && conversionAt ? new Date(Math.max(codeCheckAt, conversionAt)) : null;
    if (verifiedAt) verified += 1;
    else partial += 1;

    console.log(JSON.stringify({ brandId, codeCheckAt, conversionAt, verifiedAt }));
    if (!apply) continue;

    const set = {};
    if (codeCheckAt) set["referralVerification.codeCheckAt"] = codeCheckAt;
    if (conversionAt) set["referralVerification.conversionAt"] = conversionAt;
    if (verifiedAt) set["referralVerification.verifiedAt"] = verifiedAt;
    // Never overwrite a verification the brand already completed.
    await BusinessProfile.updateOne({ userId: brandId, "referralVerification.verifiedAt": null }, { $set: set });
  }

  console.log(`${apply ? "Applied" : "Dry run"}: ${verified} brand(s) verified, ${partial} with one of two checks.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
