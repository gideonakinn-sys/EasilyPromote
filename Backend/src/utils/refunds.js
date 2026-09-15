const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const paystack = require("../services/paystack");

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function bucketFilter(bucket) {
  return bucket === "referral" ? "referral" : { $ne: "referral" };
}

// Paystack refunds go back against the payments that funded the campaign, and a refund
// can't exceed its payment. Splits the amount across the bucket's payments, newest first.
async function buildRefundParts({ campaignId, bucket, amount }) {
  const charges = await Transaction.find({
    campaignId,
    type: { $in: ["escrow_deposit", "topup"] },
    status: "escrow_deposit",
    bucket: bucketFilter(bucket),
  })
    .sort({ date: -1, createdAt: -1 })
    .lean();

  const parts = [];
  let remaining = roundMoney(amount);
  for (const charge of charges) {
    if (remaining <= 0) break;
    if (!charge.reference) continue;
    const take = roundMoney(Math.min(remaining, charge.amount || 0));
    if (take <= 0) continue;
    parts.push({ chargeReference: charge.reference, amount: take, status: "pending" });
    remaining = roundMoney(remaining - take);
  }
  if (remaining > 0) {
    parts.push({
      chargeReference: null,
      amount: remaining,
      status: "failed",
      error: "No Paystack payment on record to refund against",
    });
  }
  return parts;
}

function refundStatusFromParts(parts) {
  if (parts.length > 0 && parts.every((part) => part.status === "processed")) return "refunded";
  if (parts.some((part) => part.status === "failed")) return "refund_failed";
  return "refund_pending";
}

function describeFailures(parts) {
  const failed = parts.filter((part) => part.status === "failed");
  if (failed.length === 0) return null;
  const items = failed.map(
    (part) =>
      `₦${part.amount.toLocaleString()}${part.chargeReference ? ` against ${part.chargeReference}` : ""} (${part.error || "failed"})`
  );
  return `Refund manually in Paystack: ${items.join("; ")}`;
}

// Asks Paystack to refund every part that hasn't been sent yet. A part stays "pending"
// until Paystack's refund.processed webhook confirms it.
async function sendRefundParts(refund, note) {
  for (const part of refund.refundParts) {
    if (part.status !== "pending" || part.paystackRefundId || !part.chargeReference) continue;
    try {
      const result = await paystack.createRefund({
        transaction: part.chargeReference,
        amount: part.amount,
        merchant_note: note,
      });
      part.paystackRefundId = result && result.id != null ? String(result.id) : null;
      if (result && result.status === "processed") part.status = "processed";
    } catch (error) {
      part.status = "failed";
      part.error = error.message;
      console.error(`[Refunds] Paystack refund failed for ${part.chargeReference}:`, error.message);
    }
  }
  refund.status = refundStatusFromParts(refund.refundParts);
  refund.adminNotes = describeFailures(refund.refundParts);
  await refund.save();
  return refund;
}

// Refunds a campaign's bucket once. The ledger row is claimed first under a fixed
// reference, so a brand cancel and an admin cancel at the same moment can't both send
// money back. Returns the refund row, or null when another request already claimed it.
async function refundCampaignBucket({ campaignId, bucket, amount, note }) {
  const pot = bucket === "referral" ? "referral" : "views";
  const parts = await buildRefundParts({ campaignId, bucket: pot, amount });

  let refund;
  try {
    refund = await Transaction.create({
      campaignId,
      type: "refund",
      bucket: pot,
      amount: roundMoney(amount),
      status: refundStatusFromParts(parts),
      reference: `refund_${pot}_${campaignId}`,
      refundParts: parts,
      adminNotes: describeFailures(parts),
      date: new Date(),
    });
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }

  return sendRefundParts(refund, note);
}

// Applies Paystack's refund.processed / refund.failed webhooks. Matched on the refund id
// Paystack returned when we created it, falling back to the original payment reference.
async function applyRefundEvent(event, data) {
  const outcome = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : null;
  if (!outcome || !data) return false;

  const refundId = data.id != null ? String(data.id) : null;
  const chargeReference = data.transaction_reference || (data.transaction && data.transaction.reference) || null;
  const matchers = [];
  if (refundId) matchers.push({ "refundParts.paystackRefundId": refundId });
  if (chargeReference) matchers.push({ "refundParts.chargeReference": chargeReference });
  if (matchers.length === 0) return false;

  const refund = await Transaction.findOne({ type: "refund", $or: matchers });
  if (!refund) return false;

  const part =
    refund.refundParts.find((p) => refundId && p.paystackRefundId === refundId) ||
    refund.refundParts.find((p) => chargeReference && p.chargeReference === chargeReference && p.status === "pending");
  if (!part || part.status === outcome) return false;

  part.status = outcome;
  if (outcome === "failed") part.error = "Paystack reported the refund failed";
  refund.status = refundStatusFromParts(refund.refundParts);
  refund.adminNotes = describeFailures(refund.refundParts);
  await refund.save();
  return true;
}

// Money Paystack collected that we couldn't apply: the wrong amount or currency, a second
// checkout, or a payment that landed after the campaign moved on. Recorded once per
// reference for an admin to refund; it never counts toward escrow.
async function recordUnmatchedPayment({ campaignId, reference, amount, currency, reason }) {
  if (!reference || !mongoose.isValidObjectId(campaignId)) {
    console.error("[Payments] Unmatched payment could not be recorded:", reference, reason);
    return false;
  }
  try {
    await Transaction.create({
      campaignId,
      type: "unmatched_payment",
      amount: roundMoney(amount),
      status: "under_review",
      reference,
      adminNotes: `${reason} Paid ${roundMoney(amount).toLocaleString()} ${currency || "(unknown currency)"}. Refund it in Paystack or apply it manually.`,
      date: new Date(),
    });
    console.warn(`[Payments] Unmatched payment ${reference} recorded for admin review: ${reason}`);
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

module.exports = {
  refundCampaignBucket,
  sendRefundParts,
  applyRefundEvent,
  recordUnmatchedPayment,
  refundStatusFromParts,
};
