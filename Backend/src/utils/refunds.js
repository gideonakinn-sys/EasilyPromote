const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");
const paystack = require("../services/paystack");
const { toKobo, roundMoney, bucketFilter } = require("./money");

// Paystack refunds go back against the payments that funded the campaign, and a refund
// can't exceed its payment. Splits the amount across the bucket's payments, newest first,
// net of what earlier refunds from the same pot already sent back against each payment
// (only the fixed pot can be refunded more than once).
async function buildRefundParts({ campaignId, bucket, amount }) {
  const [charges, earlierRefunds] = await Promise.all([
    Transaction.find({
      campaignId,
      type: { $in: ["escrow_deposit", "topup"] },
      status: "escrow_deposit",
      bucket: bucketFilter(bucket),
    })
      .sort({ date: -1, createdAt: -1 })
      .lean(),
    Transaction.find({ campaignId, type: "refund", bucket: bucketFilter(bucket) }).select("refundParts").lean(),
  ]);
  const refundedByCharge = new Map();
  for (const refund of earlierRefunds) {
    for (const part of refund.refundParts || []) {
      if (!part.chargeReference || part.status === "failed") continue;
      refundedByCharge.set(part.chargeReference, roundMoney((refundedByCharge.get(part.chargeReference) || 0) + part.amount));
    }
  }

  const parts = [];
  let remaining = roundMoney(amount);
  for (const charge of charges) {
    if (remaining <= 0) break;
    if (!charge.reference) continue;
    const left = roundMoney((charge.amount || 0) - (refundedByCharge.get(charge.reference) || 0));
    const take = roundMoney(Math.min(remaining, left));
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
  const byHand = failed.some((part) => !part.chargeReference);
  return `Refund failed: ${items.join("; ")}. ${byHand ? "Refund a part with no payment by hand in Paystack; retry the rest." : "Retry it from the admin panel."}`;
}

const LOOKUP_FAILED = "Couldn't check Paystack, try again";
// How long a request sending a refund row holds it before a retry may take over.
const SEND_LOCK_MS = 5 * 60 * 1000;
const lockFilter = (now) => ({ $or: [{ refundSendingUntil: null }, { refundSendingUntil: { $lt: now } }] });

// Whether a part never reached Paystack (a crash before sending, or Paystack couldn't be checked).
const isUnsent = (part) => part.status === "pending" && !part.sentAt && !part.paystackRefundId && Boolean(part.chargeReference);

// Sends every part of a refund row that hasn't gone to Paystack yet, changing the parts in place
// (the caller saves). Before sending, Paystack's refunds for the payment are checked: a crash after
// Paystack accepted a refund but before it was saved here leaves a refund we don't know about, so a
// matching one (same amount, created since this row, not recorded on any refund row) is adopted
// instead of sent again. If that check fails nothing is sent and the part stays retryable.
async function sendUnsentParts(row, note, { afterPaystackAccepted = null } = {}) {
  const rowCreatedAt = new Date(row.createdAt || row.date);
  for (const part of row.refundParts) {
    if (!isUnsent(part)) continue;

    let existing;
    try {
      existing = await paystack.listRefunds({ transaction: part.chargeReference });
    } catch (error) {
      part.error = LOOKUP_FAILED;
      console.error(`[Refunds] Couldn't list Paystack refunds for ${part.chargeReference}:`, error.message);
      continue;
    }
    const recorded = new Set(
      (await Transaction.distinct("refundParts.paystackRefundId", { type: "refund", "refundParts.chargeReference": part.chargeReference })).filter(Boolean).map(String)
    );
    const match = (existing || []).find(
      (refund) =>
        toKobo(refund.amount) === toKobo(part.amount) &&
        refund.status !== "failed" &&
        !recorded.has(String(refund.id)) &&
        (!refund.createdAt || new Date(refund.createdAt) >= new Date(rowCreatedAt.getTime() - 1000))
    );
    if (match) {
      part.sentAt = new Date();
      part.paystackRefundId = String(match.id);
      part.error = null;
      if (match.status === "processed") part.status = "processed";
      console.warn(`[Refunds] Adopted Paystack refund ${match.id} for ${part.chargeReference} instead of sending it again`);
      continue;
    }

    let result;
    try {
      result = await paystack.createRefund({ transaction: part.chargeReference, amount: part.amount, merchant_note: note });
    } catch (error) {
      part.status = "failed";
      part.error = error.message;
      console.error(`[Refunds] Paystack refund failed for ${part.chargeReference}:`, error.message);
      continue;
    }
    // Test seam: a crash after Paystack accepted the refund, before it's saved here.
    if (afterPaystackAccepted) await afterPaystackAccepted(row);
    part.sentAt = new Date();
    part.error = null;
    part.paystackRefundId = result && result.id != null ? String(result.id) : null;
    if (result && result.status === "processed") part.status = "processed";
  }
  return row;
}

// Test seam for views, referral and bonus refunds (fixed refunds have their own in utils/fixedPay).
const bucketRefundHooks = { beforeSend: null, afterPaystackAccepted: null };

// A views, referral or bonus refund row's status and note from its parts. Unlike a fixed refund, the
// row keeps counting as the brand's money whatever Paystack did (reconciliation counts it), so a failed
// part is retried from the same row, never replaced.
function applyBucketRefundOutcome(refund) {
  refund.status = refundStatusFromParts(refund.refundParts);
  const unsent = refund.refundParts.filter((part) => isUnsent(part) && part.error);
  refund.adminNotes = describeFailures(refund.refundParts) || (unsent.length ? `Not sent: ${unsent.map((p) => p.error).join("; ")}` : null);
  refund.refundSendingUntil = undefined;
  return refund;
}

// Asks Paystack to refund every part that hasn't been sent yet. A part stays "pending"
// until Paystack's refund.processed webhook confirms it.
async function sendRefundParts(refund, note) {
  if (bucketRefundHooks.beforeSend) await bucketRefundHooks.beforeSend(refund);
  await sendUnsentParts(refund, note, { afterPaystackAccepted: bucketRefundHooks.afterPaystackAccepted });
  applyBucketRefundOutcome(refund);
  await refund.save();
  return refund;
}

// Refunds a campaign's views or referral bucket once. The ledger row is claimed first under a
// fixed reference, so a brand cancel and an admin cancel at the same moment can't both send
// money back. Returns the refund row, or null when another request already claimed it.
// The fixed pot has its own retryable refund flow (utils/fixedPay).
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
      // Held while this request sends it, so a retry can't send the same parts at once.
      refundSendingUntil: new Date(Date.now() + SEND_LOCK_MS),
      date: new Date(),
    });
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }

  return sendRefundParts(refund, note);
}

class RefundRetryError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// How any refund row stands, for admin: refunded, sent (waiting for Paystack), not sent yet, or failed,
// and whether a retry can send what's missing. A part with no Paystack payment can't be retried.
function refundRowState(row, now = new Date()) {
  const parts = row.refundParts || [];
  const failed = parts.filter((p) => p.status === "failed");
  const unsent = parts.filter(isUnsent);
  let state = "sent";
  if (row.status === "refunded") state = "refunded";
  else if (row.status === "refund_failed" || failed.length > 0) state = "failed";
  else if (unsent.length > 0) state = "not_sent";
  const sending = Boolean(row.refundSendingUntil && new Date(row.refundSendingUntil) > now);
  return {
    state,
    retryable: failed.some((p) => p.chargeReference) || unsent.length > 0,
    sending,
    byHand: fromKoboSum(failed.filter((p) => !p.chargeReference)),
    error:
      state === "failed"
        ? failed.map((p) => p.error).filter(Boolean).join("; ") || row.adminNotes || "Refund failed"
        : state === "not_sent"
          ? unsent.map((p) => p.error).filter(Boolean).join("; ") || null
          : null,
  };
}
const fromKoboSum = (parts) => parts.reduce((kobo, p) => kobo + toKobo(p.amount), 0) / 100;

// Retries a views, referral or bonus refund from its own row (D23): failed parts with a Paystack
// payment go back to pending and every unsent part is sent. The update that reopens the parts takes the
// row's send lock, so two admins (or an admin and the automatic refund job) send at most once, and each
// part is checked against Paystack's own refunds before it's sent, so a refund Paystack already has is
// adopted, never sent twice. The amount never changes: the row already counts as the brand's money.
async function retryBucketRefund({ refundId, note = null, now = new Date() }) {
  if (!mongoose.isValidObjectId(refundId)) throw new RefundRetryError(404, "NOT_FOUND", "Refund not found");
  const row = await Transaction.findOne({ _id: refundId, type: "refund" });
  if (!row) throw new RefundRetryError(404, "NOT_FOUND", "Refund not found");
  if (row.bucket === "fixed") throw new RefundRetryError(400, "FIXED_REFUND", "Content budget refunds are retried from the campaign");
  const view = refundRowState(row, now);
  if (!view.retryable) {
    if (row.status === "refunded") throw new RefundRetryError(409, "NOT_RETRYABLE", "This refund is already complete");
    if (view.byHand > 0) {
      throw new RefundRetryError(409, "REFUND_BY_HAND", "This refund has no Paystack payment to refund against. Refund it by hand in the Paystack dashboard.");
    }
    throw new RefundRetryError(409, "NOT_RETRYABLE", "This refund has already been sent to Paystack");
  }

  const claimed = await Transaction.findOneAndUpdate(
    { _id: row._id, type: "refund", status: { $in: ["refund_failed", "refund_pending"] }, ...lockFilter(now) },
    {
      $set: {
        refundSendingUntil: new Date(now.getTime() + SEND_LOCK_MS),
        "refundParts.$[f].status": "pending",
        "refundParts.$[f].error": null,
        "refundParts.$[f].sentAt": null,
        "refundParts.$[f].paystackRefundId": null,
      },
    },
    { new: true, arrayFilters: [{ "f.status": "failed", "f.chargeReference": { $ne: null } }] }
  );
  if (!claimed) throw new RefundRetryError(409, "REFUND_IN_PROGRESS", "This refund is being sent right now. Refresh in a moment.");
  const pot = claimed.bucket === "referral" ? "referral budget" : claimed.bucket === "bonus" ? "bonus pool" : "views budget";
  await sendRefundParts(claimed, note || `Unused ${pot} from campaign ${claimed.campaignId}`);
  return claimed;
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
  if (refund.bucket === "fixed") {
    // Fixed refunds are retryable; their reservation is released when nothing is left moving.
    await require("./fixedPay").applyFixedRefundOutcome(refund);
    return true;
  }
  applyBucketRefundOutcome(refund);
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
  SEND_LOCK_MS,
  LOOKUP_FAILED,
  RefundRetryError,
  bucketRefundHooks,
  isUnsent,
  lockFilter,
  refundRowState,
  retryBucketRefund,
  sendUnsentParts,
  buildRefundParts,
  describeFailures,
  refundCampaignBucket,
  sendRefundParts,
  applyRefundEvent,
  recordUnmatchedPayment,
  refundStatusFromParts,
};
