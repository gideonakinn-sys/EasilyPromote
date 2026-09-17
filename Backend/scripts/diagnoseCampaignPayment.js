#!/usr/bin/env node
// Read-only: why hasn't a paid campaign gone live? Prints the campaign's payment fields, what checkout
// expects, every transaction on it, webhook processing failures for its reference, and what Paystack
// says about that reference. Writes nothing and never prints a secret.
//
//   node scripts/diagnoseCampaignPayment.js <campaignId>
require("dotenv").config();
const mongoose = require("mongoose");
const { connectReadOnly } = require("./scriptConnection");

async function main() {
  const campaignId = process.argv[2];
  if (!/^[a-f0-9]{24}$/i.test(campaignId || "")) {
    console.error("Usage: node scripts/diagnoseCampaignPayment.js <campaignId>");
    process.exitCode = 2;
    return;
  }
  await connectReadOnly(process.env.MONGODB_URI);
  const Campaign = require("../src/models/Campaign");
  const Transaction = require("../src/models/Transaction");
  const PaystackWebhookFailure = require("../src/models/PaystackWebhookFailure");
  const { expectedPaymentAmount, campaignPaymentBooked } = require("../src/utils/campaignPayments");
  const { isReferralsOnly } = require("../src/utils/campaignObjectives");

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    console.log("Campaign not found");
    return;
  }
  console.log("Campaign");
  console.log({
    name: campaign.name,
    status: campaign.status,
    campaignObjective: campaign.campaignObjective,
    campaignModel: campaign.campaignModel,
    objective: campaign.objective,
    payShape: campaign.payShape,
    targetViews: campaign.targetViews,
    budget: campaign.budget,
    creatorPool: campaign.creatorPool,
    referralRequestedBudget: campaign.referral && campaign.referral.requestedBudget,
    paymentReference: campaign.paymentReference,
    paymentAmount: campaign.paymentAmount,
    expectedPaymentAmount: expectedPaymentAmount(campaign),
    referralsOnly: isReferralsOnly(campaign),
    paymentBooked: await campaignPaymentBooked(campaign),
    updatedAt: campaign.updatedAt,
  });

  const validation = campaign.validateSync();
  console.log("\nSchema validation:", validation ? validation.message : "ok");

  const rows = await Transaction.find({ campaignId: campaign._id }).sort({ createdAt: 1 }).lean();
  console.log(`\nTransactions (${rows.length})`);
  for (const row of rows) {
    console.log({ type: row.type, bucket: row.bucket, status: row.status, amount: row.amount, reference: row.reference, note: row.note || row.description || row.reason, createdAt: row.createdAt });
  }

  if (campaign.paymentReference) {
    const byRef = await Transaction.find({ reference: campaign.paymentReference }).lean();
    console.log(`\nTransactions with the payment reference on any campaign: ${byRef.length}`);
    const failures = await PaystackWebhookFailure.find({ reference: campaign.paymentReference }).lean();
    console.log(`Webhook processing failures for the reference: ${failures.length}`);
    for (const f of failures) console.log({ event: f.event, error: f.error || f.message, createdAt: f.createdAt });

    try {
      const { verifyTransaction } = require("../src/services/paystack");
      const data = await verifyTransaction(campaign.paymentReference);
      console.log("\nPaystack says", { status: data.status, amount: (data.amount || 0) / 100, currency: data.currency, paid_at: data.paid_at, metadata: data.metadata });
    } catch (error) {
      console.log("\nPaystack lookup failed:", error.message);
    }
  } else {
    console.log("\nNo paymentReference stored on the campaign (checkout never started, or an edit cleared it).");
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
