// Fixed pay for content campaigns (ticket 09). Fixed pay is the third pot beside views and
// referral: the brand's checkout books the whole payment (creator budget + platform fee) into the
// "fixed" pot, each deliverable is credited from it, and credits go out in the weekly
// per-campaign withdrawal like the other pots.
//
// When fixed pay is credited, and when it can be withdrawn:
// - The credit lands when D1 says pay is due: on content approval for brand-page delivery, once
//   the live post is verified for creator page / both. It reserves the placement's reward from
//   the campaign's creator pool at that moment, so the money is promised to the creator.
// - It becomes withdrawable only once the submission is completed (the brand confirmed receipt
//   or the live post, by hand or automatically after 72 hours) AND the 7-day hold has passed
//   since completion. Before completion it shows as waiting for the brand to confirm delivery;
//   during the hold it shows the date it unlocks. The submission's completedAt is the source of
//   truth, and it's checked again when a withdrawal is paid.
// - Approved brand-page content never delivered can have its credit voided by admin (14 days
//   after approval, or at once on a cancelled campaign): a reversing ledger row, the amount back
//   in the pool, the submission marked not_delivered.
//
// Invariants, each enforced by one conditional update on the campaign:
// - A submission is credited at most once (creditedSubmissions; unique ledger reference).
// - Deliverables credited + deliverables held by refunds never exceed deliverables bought, and
//   credited + refunded creator budget never exceeds the creator pool.
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const paystack = require("../services/paystack");
const { isContentCampaign } = require("./campaignPay");
const { toKobo, fromKobo, roundMoney } = require("./money");
const rules = require("./fixedPayRules");

const { FIXED_HOLD_MS, UNDELIVERED_VOID_AFTER_MS, fixedCreditState, canStillEarn, unusedBudgetRefund, refundFor } = rules;

const REFUNDABLE_CAMPAIGN_STATUSES = ["completed", "cancelled"];
// Owed pay stays withdrawable after a campaign is cancelled, as referral earnings do.
const FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES = ["live", "paused", "completed", "cancelled"];
const COMMITTED_RELEASE_STATUSES = ["escrow_deposit", "released"];
// Refund rows that hold budget: sending, sent, or done. Failed rows hold nothing.
const HOLDING_REFUND_STATUSES = ["refund_pending", "refunded"];
const SEND_LOCK_MS = 5 * 60 * 1000;

// Test seam: runs after a refund row is written and reserved, before anything is sent to Paystack.
const refundHooks = { beforeSend: null, afterPaystackAccepted: null };

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

const creditReference = (submissionId) => `fixed_${submissionId}`;
const voidReference = (submissionId) => `fixed_void_${submissionId}`;

// Aggregation expressions over the campaign document.
const reservedDeliverablesExpr = { $sum: { $ifNull: ["$fixedPay.refundReservations.deliverables", []] } };
const reservedBudgetExpr = { $sum: { $ifNull: ["$fixedPay.refundReservations.creatorBudget", []] } };
const creditedCountExpr = { $size: { $ifNull: ["$fixedPay.creditedSubmissions", []] } };

// Capacity left for one more deliverable of `amount`, read from the campaign document.
function hasRoomFor(campaign, amount, deliverables = 1) {
  const fixedPay = campaign.fixedPay || {};
  const reservations = fixedPay.refundReservations || [];
  const bought = (campaign.contentPay && campaign.contentPay.deliverables) || 0;
  const used = (fixedPay.creditedSubmissions || []).length + reservations.reduce((sum, r) => sum + r.deliverables, 0);
  const budget = toKobo(fixedPay.credited) + reservations.reduce((sum, r) => sum + toKobo(r.creatorBudget), 0);
  return used + deliverables <= bought && budget + toKobo(amount) <= toKobo(campaign.creatorPool);
}

// ── Crediting ───────────────────────────────────────────────────────────────

async function placementReward(submission, campaign) {
  const slot = submission.slotId
    ? await Slot.findById(submission.slotId).select("reward").lean()
    : await Slot.findOne({ campaignId: campaign._id, creatorId: submission.creatorId, kind: "deliverable" }).select("reward").lean();
  const reward = slot ? slot.reward : campaign.contentPay && campaign.contentPay.ratePerDeliverable;
  return roundMoney(reward);
}

// Whether the campaign can still pay one more deliverable at its rate (appeal decisions check this).
async function canPayAnotherDeliverable(campaignId) {
  const campaign = await Campaign.findById(campaignId).select("contentPay creatorPool fixedPay").lean();
  if (!campaign) return false;
  return hasRoomFor(campaign, campaign.contentPay && campaign.contentPay.ratePerDeliverable);
}

// Credits one submission's fixed pay from the campaign's creator pool. Safe to call any number of
// times, at once or after a crash part-way: the reservation is keyed on the submission, and the
// ledger row is an upsert on its unique reference. Returns { credited, amount, reason? }.
async function creditFixedPay({ submission, campaign, trigger = null, now = new Date() }) {
  if (!submission || !isContentCampaign(campaign)) return { credited: false, reason: "not_content" };
  const amount = await placementReward(submission, campaign);
  if (!(amount > 0)) return { credited: false, reason: "no_reward" };

  const submissionId = toObjectId(submission._id);
  const existingVoid = await Transaction.exists({ reference: voidReference(submissionId), type: "fixed_void" });
  if (existingVoid) return { credited: false, amount, reason: "voided" };

  const reserved = await Campaign.findOneAndUpdate(
    {
      _id: campaign._id,
      "fixedPay.creditedSubmissions": { $ne: submissionId },
      $expr: {
        $and: [
          { $lt: [{ $add: [creditedCountExpr, reservedDeliverablesExpr] }, { $ifNull: ["$contentPay.deliverables", 0] }] },
          { $lte: [{ $add: [{ $ifNull: ["$fixedPay.credited", 0] }, reservedBudgetExpr, amount] }, "$creatorPool"] },
        ],
      },
    },
    { $push: { "fixedPay.creditedSubmissions": submissionId }, $inc: { "fixedPay.credited": amount } },
    { new: true, projection: { _id: 1 } }
  );
  if (!reserved) {
    const alreadyReserved = await Campaign.exists({ _id: campaign._id, "fixedPay.creditedSubmissions": submissionId });
    if (!alreadyReserved) {
      console.error(`[FixedPay] No creator budget left to credit submission ${submissionId} on campaign ${campaign._id}`);
      return { credited: false, amount, reason: "budget_exhausted" };
    }
  }

  const existing = await Transaction.findOneAndUpdate(
    { reference: creditReference(submissionId), type: "fixed_credit" },
    {
      $setOnInsert: {
        campaignId: campaign._id,
        submissionId,
        creatorId: submission.creatorId,
        creatorHandle: submission.creatorHandle || null,
        type: "fixed_credit",
        bucket: "fixed",
        amount,
        status: "credited",
        reference: creditReference(submissionId),
        adminNotes: trigger ? `Fixed pay due: ${trigger}` : null,
        date: now,
      },
    },
    { upsert: true, new: false, setDefaultsOnInsert: true }
  );
  return { credited: !existing, alreadyCredited: Boolean(existing), amount };
}

// Repairs a credit whose pay became due but was interrupted before the ledger row was written.
async function ensureFixedCredit(submission, campaign, now = new Date()) {
  if (!submission || !submission.fixedPayDueAt || !isContentCampaign(campaign)) return null;
  const exists = await Transaction.exists({ reference: creditReference(submission._id), type: "fixed_credit" });
  if (exists) return null;
  return creditFixedPay({ submission, campaign, trigger: "repair", now });
}

// ── Voiding undelivered pay ─────────────────────────────────────────────────

class FixedPayError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
// Kept for callers of the refund API.
const RefundError = FixedPayError;

// Admin voids fixed pay for approved brand-page (or both) content still waiting to be delivered 14
// days after approval, or on a cancelled campaign. Idempotent: every step is conditional, so a
// repeat (or a retry after a crash part-way) finishes what's left. Returns { voided, amount,
// submission, campaign } where voided is true only for the call that marked it not delivered.
async function voidUndeliveredPay({ submissionId, now = new Date() }) {
  if (!mongoose.isValidObjectId(submissionId)) throw new FixedPayError(404, "NOT_FOUND", "Submission not found");
  const submission = await Submission.findById(submissionId);
  if (!submission) throw new FixedPayError(404, "NOT_FOUND", "Submission not found");
  const campaign = await Campaign.findById(submission.campaignId);
  if (!campaign || !isContentCampaign(campaign)) throw new FixedPayError(400, "NOT_CONTENT_CAMPAIGN", "This only applies to content campaigns");
  if (!["brand_page", "both"].includes(campaign.contentDestination)) {
    throw new FixedPayError(400, "NO_BRAND_DELIVERY", "Only content delivered to the brand can be voided as not delivered");
  }

  let voided = false;
  if (submission.status !== "not_delivered") {
    if (submission.status !== "awaiting_delivery") {
      throw new FixedPayError(409, "NOT_AWAITING_DELIVERY", "Only approved content still waiting to be delivered can be voided");
    }
    const approvedAt = submission.reviewedAt || submission.fixedPayDueAt;
    const overdue = approvedAt && now.getTime() - new Date(approvedAt).getTime() >= UNDELIVERED_VOID_AFTER_MS;
    if (campaign.status !== "cancelled" && !overdue) {
      throw new FixedPayError(409, "NOT_VOIDABLE_YET", "The creator has 14 days after approval to deliver before their pay can be voided");
    }
    const claimed = await Submission.findOneAndUpdate(
      { _id: submission._id, status: "awaiting_delivery" },
      { $set: { status: "not_delivered", notDeliveredAt: now }, $unset: { awaitingBrandSince: 1 } },
      { new: true }
    );
    if (claimed) voided = true;
    else {
      const current = await Submission.findById(submission._id).select("status").lean();
      if (!current || current.status !== "not_delivered") {
        throw new FixedPayError(409, "STATUS_CHANGED", "This submission changed. Refresh to see where it is now.");
      }
    }
  }

  const credit = await Transaction.findOne({ reference: creditReference(submission._id), type: "fixed_credit" }).lean();
  let amount = 0;
  if (credit) {
    amount = credit.amount;
    try {
      await Transaction.create({
        campaignId: campaign._id,
        submissionId: submission._id,
        creatorId: credit.creatorId,
        creatorHandle: credit.creatorHandle,
        type: "fixed_void",
        bucket: "fixed",
        amount: credit.amount,
        status: "voided",
        reference: voidReference(submission._id),
        adminNotes: "Approved content was never delivered to the brand",
        date: now,
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    await Transaction.updateOne({ _id: credit._id, status: "credited" }, { $set: { status: "voided" } });
    await Campaign.updateOne(
      { _id: campaign._id, "fixedPay.creditedSubmissions": submission._id },
      { $pull: { "fixedPay.creditedSubmissions": submission._id }, $inc: { "fixedPay.credited": -credit.amount } }
    );
  }
  return { voided, amount, submission, campaign };
}

// ── Creator earnings ────────────────────────────────────────────────────────

const lagosDay = (date) => new Date(new Date(date).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

// A creator's fixed pay per campaign: what's credited, what waits for delivery, what's in the
// hold (per unlock date), what can be withdrawn now, and what's been requested or paid.
async function creatorFixedEarnings(creatorId, { campaignIds = null, now = new Date() } = {}) {
  const creator = toObjectId(creatorId);
  const creditFilter = { creatorId: creator, type: "fixed_credit", status: "credited" };
  const withdrawalMatch = {
    creatorId: creator,
    kind: "campaign",
    fixedAmount: { $gt: 0 },
    status: { $in: ["pending", "processing", "released"] },
  };
  if (campaignIds) {
    const ids = campaignIds.map(toObjectId);
    creditFilter.campaignId = { $in: ids };
    withdrawalMatch.campaignId = { $in: ids };
  }

  const [credits, withdrawals] = await Promise.all([
    Transaction.find(creditFilter).select("campaignId submissionId amount").lean(),
    Withdrawal.aggregate([{ $match: withdrawalMatch }, { $group: { _id: "$campaignId", withdrawn: { $sum: "$fixedAmount" } } }]),
  ]);
  const submissions = await Submission.find({ _id: { $in: credits.map((c) => c.submissionId) } })
    .select("status completedAt")
    .lean();
  return fixedEarningsFrom({
    credits,
    submissionById: new Map(submissions.map((s) => [String(s._id), s])),
    withdrawals: withdrawals.map((group) => ({ campaignId: group._id, withdrawn: group.withdrawn })),
    now,
  });
}

// The same result as creatorFixedEarnings, from rows already loaded: the creator's credited fixed
// pay, the submissions it was credited for (status, completedAt), and the fixed part of requested
// or paid withdrawals per campaign ([{ campaignId, withdrawn }]).
function fixedEarningsFrom({ credits, submissionById, withdrawals, now = new Date() }) {
  const byCampaign = new Map();
  const entryFor = (key, campaignId) => {
    if (!byCampaign.has(key)) {
      byCampaign.set(key, { campaignId, deliverables: 0, earnedKobo: 0, awaitingKobo: 0, onHoldKobo: 0, availableKobo: 0, withdrawnKobo: 0, unlocks: new Map() });
    }
    return byCampaign.get(key);
  };

  for (const credit of credits) {
    const entry = entryFor(String(credit.campaignId), credit.campaignId);
    const kobo = toKobo(credit.amount);
    const { state, availableAt } = fixedCreditState(submissionById.get(String(credit.submissionId)), now);
    entry.deliverables += 1;
    entry.earnedKobo += kobo;
    if (state === "awaiting_delivery") entry.awaitingKobo += kobo;
    else if (state === "on_hold") {
      entry.onHoldKobo += kobo;
      const day = lagosDay(availableAt);
      const unlock = entry.unlocks.get(day) || { date: availableAt, kobo: 0 };
      if (availableAt > unlock.date) unlock.date = availableAt;
      unlock.kobo += kobo;
      entry.unlocks.set(day, unlock);
    } else entry.availableKobo += kobo;
  }
  for (const group of withdrawals) {
    entryFor(String(group.campaignId), group.campaignId).withdrawnKobo += toKobo(group.withdrawn);
  }

  const result = new Map();
  for (const [key, e] of byCampaign) {
    const unlocks = [...e.unlocks.values()].sort((a, b) => a.date - b.date).map((u) => ({ date: u.date, amount: fromKobo(u.kobo) }));
    result.set(key, {
      campaignId: e.campaignId,
      deliverables: e.deliverables,
      earned: fromKobo(e.earnedKobo),
      awaitingDelivery: fromKobo(e.awaitingKobo),
      onHold: fromKobo(e.onHoldKobo),
      holdUntil: unlocks.length ? unlocks[0].date : null,
      unlocks,
      available: fromKobo(e.availableKobo),
      withdrawn: fromKobo(e.withdrawnKobo),
      availableToWithdraw: fromKobo(Math.max(e.availableKobo - e.withdrawnKobo, 0)),
    });
  }
  return result;
}

// What a payout may release from the fixed pot for one creator on one campaign right now: credits
// delivered and past their hold, less fixed releases already committed. Checked at payout time.
async function fixedPayableNow({ creatorId, campaignId, now = new Date() }) {
  const creator = toObjectId(creatorId);
  const campaign = toObjectId(campaignId);
  const [credits, released] = await Promise.all([
    Transaction.find({ creatorId: creator, campaignId: campaign, type: "fixed_credit", status: "credited" }).select("submissionId amount").lean(),
    Transaction.find({ creatorId: creator, campaignId: campaign, type: "release", bucket: "fixed", status: { $in: COMMITTED_RELEASE_STATUSES } }).select("amount").lean(),
  ]);
  const submissions = await Submission.find({ _id: { $in: credits.map((c) => c.submissionId) } }).select("status completedAt").lean();
  const byId = new Map(submissions.map((s) => [String(s._id), s]));
  const eligible = credits
    .filter((c) => fixedCreditState(byId.get(String(c.submissionId)), now).state === "available")
    .reduce((sum, c) => sum + toKobo(c.amount), 0);
  const committed = released.reduce((sum, r) => sum + toKobo(r.amount), 0);
  return fromKobo(Math.max(eligible - committed, 0));
}

// ── Unused budget refund (D5) ───────────────────────────────────────────────

// How a refund row stands, for admin: refunded, sent (waiting for Paystack), not sent yet, failed.
function refundView(row) {
  const parts = row.refundParts || [];
  const failed = parts.filter((p) => p.status === "failed");
  const unsent = parts.filter((p) => p.status === "pending" && !p.sentAt && !p.paystackRefundId && p.chargeReference);
  let state = "sent";
  if (row.status === "refunded") state = "refunded";
  else if (row.status === "refund_failed" || failed.length > 0) state = "failed";
  else if (unsent.length > 0) state = "not_sent";
  return {
    id: row._id,
    amount: row.amount,
    deliverables: row.refundBreakdown ? row.refundBreakdown.deliverables : 0,
    creatorBudget: row.refundBreakdown ? row.refundBreakdown.creatorBudget : 0,
    platformFee: row.refundBreakdown ? row.refundBreakdown.platformFee : 0,
    status: row.status,
    state,
    error:
      state === "failed"
        ? failed.map((p) => p.error).filter(Boolean).join("; ") || row.adminNotes || "Refund failed"
        : state === "not_sent"
          ? unsent.map((p) => p.error).filter(Boolean).join("; ") || null
          : null,
    retryable: state === "failed" || state === "not_sent",
    createdAt: row.date || row.createdAt,
  };
}

// What a content campaign has delivered, owes and could refund, from the ledger and submissions.
async function contentBudgetSummary(campaignId, now = new Date()) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || !isContentCampaign(campaign)) return null;

  const [credits, submissions, refundRows, releases] = await Promise.all([
    Transaction.find({ campaignId: campaign._id, type: "fixed_credit", status: "credited" }).select("submissionId amount").lean(),
    Submission.find({ campaignId: campaign._id }).select("status completedAt appealableUntil reviewedAt fixedPayDueAt creatorHandle").lean(),
    Transaction.find({ campaignId: campaign._id, type: "refund", bucket: "fixed" }).sort({ date: 1, createdAt: 1 }).lean(),
    Transaction.find({ campaignId: campaign._id, type: "release", bucket: "fixed", status: { $in: COMMITTED_RELEASE_STATUSES } }).select("amount status").lean(),
  ]);
  const creditedIds = new Set(credits.map((c) => String(c.submissionId)));
  const submissionById = new Map(submissions.map((s) => [String(s._id), s]));
  const completed = credits.filter((c) => {
    const s = submissionById.get(String(c.submissionId));
    return s && s.status === "completed";
  }).length;
  const inProgress = submissions.filter((s) => !creditedIds.has(String(s._id)) && s.status !== "completed" && canStillEarn(s, now)).length;

  const holding = refundRows.filter((r) => HOLDING_REFUND_STATUSES.includes(r.status));
  const refundedDeliverables = holding.reduce((sum, r) => sum + ((r.refundBreakdown && r.refundBreakdown.deliverables) || 0), 0);
  const deliverables = (campaign.contentPay && campaign.contentPay.deliverables) || 0;
  const rate = (campaign.contentPay && campaign.contentPay.ratePerDeliverable) || 0;
  const refund = unusedBudgetRefund({
    deliverables,
    ratePerDeliverable: rate,
    platformFee: campaign.platformFee,
    credited: credits.length,
    inProgress,
    refundedDeliverables,
  });
  const refundAllowed = REFUNDABLE_CAMPAIGN_STATUSES.includes(campaign.status);
  const refunds = refundRows.map(refundView);
  const creditedKobo = credits.reduce((sum, c) => sum + toKobo(c.amount), 0);
  const committedKobo = releases.reduce((sum, r) => sum + toKobo(r.amount), 0);

  return {
    campaign,
    snapshot: { creditedCount: credits.length, refundedDeliverables },
    summary: {
      campaignId: campaign._id,
      status: campaign.status,
      ratePerDeliverable: rate,
      deliverables,
      completed,
      // Credited but the brand hasn't confirmed delivery yet.
      owed: credits.length - completed,
      credited: credits.length,
      creditedAmount: fromKobo(creditedKobo),
      paidOut: fromKobo(releases.filter((r) => r.status === "released").reduce((sum, r) => sum + toKobo(r.amount), 0)),
      owedAmount: fromKobo(Math.max(creditedKobo - committedKobo, 0)),
      inProgress,
      refunded: refundedDeliverables,
      refundedAmount: fromKobo(refundRows.filter((r) => r.status === "refunded").reduce((sum, r) => sum + toKobo(r.amount), 0)),
      refundPendingAmount: fromKobo(refundRows.filter((r) => r.status === "refund_pending").reduce((sum, r) => sum + toKobo(r.amount), 0)),
      unused: refund.deliverables,
      refundAllowed,
      refundable: refundAllowed ? refund : { deliverables: 0, creatorBudget: 0, platformFee: 0, amount: 0 },
      refunds,
      // Approved content still waiting to be delivered to the brand, and when its pay can be voided.
      undelivered: ["brand_page", "both"].includes(campaign.contentDestination)
        ? submissions
            .filter((s) => s.status === "awaiting_delivery")
            .map((s) => {
              const approvedAt = s.reviewedAt || s.fixedPayDueAt || null;
              const voidableFrom = campaign.status === "cancelled" || !approvedAt ? now : new Date(new Date(approvedAt).getTime() + UNDELIVERED_VOID_AFTER_MS);
              return {
                submissionId: s._id,
                creatorHandle: s.creatorHandle || null,
                approvedAt,
                credited: creditedIds.has(String(s._id)),
                voidableFrom,
                voidable: voidableFrom <= now,
              };
            })
        : [],
    },
  };
}

// Holds a refund's deliverables and budget on the campaign, if there's still room for them.
// Idempotent per refund row.
async function reserveRefund(row, campaignId) {
  const b = row.refundBreakdown;
  const reserved = await Campaign.findOneAndUpdate(
    {
      _id: campaignId,
      status: { $in: REFUNDABLE_CAMPAIGN_STATUSES },
      "fixedPay.refundReservations.refundId": { $ne: row._id },
      $expr: {
        $and: [
          { $lte: [{ $add: [creditedCountExpr, reservedDeliverablesExpr, b.deliverables] }, { $ifNull: ["$contentPay.deliverables", 0] }] },
          { $lte: [{ $add: [{ $ifNull: ["$fixedPay.credited", 0] }, reservedBudgetExpr, b.creatorBudget] }, "$creatorPool"] },
        ],
      },
    },
    {
      $push: {
        "fixedPay.refundReservations": { refundId: row._id, deliverables: b.deliverables, creatorBudget: b.creatorBudget, platformFee: b.platformFee },
      },
    },
    { new: true, projection: { _id: 1 } }
  );
  if (reserved) return true;
  return Boolean(await Campaign.exists({ _id: campaignId, "fixedPay.refundReservations.refundId": row._id }));
}

const releaseReservation = (row) =>
  Campaign.updateOne({ _id: row.campaignId }, { $pull: { "fixedPay.refundReservations": { refundId: row._id } } });

// Sets a fixed refund row's status from its parts, releasing its reservation when nothing moved.
async function applyFixedRefundOutcome(row) {
  const parts = row.refundParts || [];
  const processed = parts.filter((p) => p.status === "processed");
  const moving = parts.filter((p) => p.status === "pending" && (p.sentAt || p.paystackRefundId));
  const failed = parts.filter((p) => p.status === "failed");
  if (parts.length > 0 && processed.length === parts.length) row.status = "refunded";
  else if (failed.length > 0 && processed.length === 0 && moving.length === 0) row.status = "refund_failed";
  else row.status = "refund_pending";
  const unchecked = parts.filter((p) => p.status === "pending" && !p.sentAt && !p.paystackRefundId && p.error);
  row.adminNotes = failed.length
    ? `Refund failed: ${failed.map((p) => `₦${p.amount.toLocaleString()} (${p.error || "failed"})`).join("; ")}`
    : unchecked.length
      ? `Not sent: ${unchecked.map((p) => p.error).join("; ")}`
      : null;
  row.refundSendingUntil = undefined;
  await row.save();
  if (row.status === "refund_failed") await releaseReservation(row);
  return row;
}

const LOOKUP_FAILED = "Couldn't check Paystack, try again";

// Sends every part of a fixed refund row that hasn't gone to Paystack yet. The caller holds the
// row's send lock. Before sending, Paystack's refunds for the payment are checked: a crash after
// Paystack accepted a refund but before it was saved here leaves a refund we don't know about, so a
// matching one (same amount, created since this row, not already recorded on another row) is
// adopted instead of sent again. If that check fails nothing is sent and the part stays retryable.
async function sendFixedRefund(row, note) {
  const rowCreatedAt = new Date(row.createdAt || row.date);
  for (const part of row.refundParts) {
    if (part.status !== "pending" || part.sentAt || part.paystackRefundId || !part.chargeReference) continue;

    let existing;
    try {
      existing = await paystack.listRefunds({ transaction: part.chargeReference });
    } catch (error) {
      part.error = LOOKUP_FAILED;
      console.error(`[FixedPay] Couldn't list Paystack refunds for ${part.chargeReference}:`, error.message);
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
      console.warn(`[FixedPay] Adopted Paystack refund ${match.id} for ${part.chargeReference} instead of sending it again`);
      continue;
    }

    let result;
    try {
      result = await paystack.createRefund({ transaction: part.chargeReference, amount: part.amount, merchant_note: note });
    } catch (error) {
      part.status = "failed";
      part.error = error.message;
      console.error(`[FixedPay] Paystack refund failed for ${part.chargeReference}:`, error.message);
      continue;
    }
    // Test seam: a crash after Paystack accepted the refund, before it's saved here.
    if (refundHooks.afterPaystackAccepted) await refundHooks.afterPaystackAccepted(row);
    part.sentAt = new Date();
    part.error = null;
    part.paystackRefundId = result && result.id != null ? String(result.id) : null;
    if (result && result.status === "processed") part.status = "processed";
  }
  return applyFixedRefundOutcome(row);
}

const lockFilter = (now) => ({ $or: [{ refundSendingUntil: null }, { refundSendingUntil: { $lt: now } }] });

// Refunds a finished content campaign's unused deliverables to the brand's Paystack payment.
// Crash-safe order: (1) the refund row is written as refund_pending under a unique reference per
// campaign and attempt, (2) its deliverables are reserved on the campaign, checking nothing was
// credited or refunded since the amount was worked out, (3) Paystack is called, (4) the row is
// marked sent, refunded or failed. A failed row releases its reservation and can be retried; a row
// interrupted before step 4 stays reserved and is retried from the same row.
async function refundUnusedContentBudget({ campaignId, expectedAmount = null, note = null, now = new Date() }) {
  const { buildRefundParts } = require("./refunds");
  const loaded = await contentBudgetSummary(campaignId, now);
  if (!loaded) throw new FixedPayError(404, "NOT_CONTENT_CAMPAIGN", "Content campaign not found");
  const { campaign, snapshot, summary } = loaded;
  if (!summary.refundAllowed) {
    throw new FixedPayError(400, "CAMPAIGN_NOT_FINISHED", "Unused budget can only be refunded once the campaign is completed or cancelled");
  }
  if (summary.refunds.some((r) => r.retryable)) {
    throw new FixedPayError(409, "REFUND_NEEDS_RETRY", "An earlier refund for this campaign didn't go through. Retry it before starting another.", { summary });
  }
  const refund = summary.refundable;
  if (!(refund.amount > 0)) throw new FixedPayError(400, "NOTHING_TO_REFUND", "This campaign has no unused budget to refund");
  if (expectedAmount !== null && toKobo(expectedAmount) !== toKobo(refund.amount)) {
    throw new FixedPayError(409, "REFUND_CHANGED", "The refundable amount changed. Check the new amount and confirm again.", { summary });
  }

  const attempt = summary.refunds.length + 1;
  const parts = await buildRefundParts({ campaignId: campaign._id, bucket: "fixed", amount: refund.amount });
  let row;
  try {
    row = await Transaction.create({
      campaignId: campaign._id,
      type: "refund",
      bucket: "fixed",
      amount: refund.amount,
      status: "refund_pending",
      reference: `refund_fixed_${campaign._id}_${attempt}`,
      refundBreakdown: { deliverables: refund.deliverables, creatorBudget: refund.creatorBudget, platformFee: refund.platformFee },
      refundParts: parts,
      date: now,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new FixedPayError(409, "REFUND_CHANGED", "Another refund for this campaign was just started. Refresh to see it.");
    }
    throw error;
  }

  // Nothing may have been credited or refunded since the amount was worked out.
  const fresh = await Campaign.findOne({
    _id: campaign._id,
    $expr: { $and: [{ $eq: [creditedCountExpr, snapshot.creditedCount] }] },
  })
    .select("_id")
    .lean();
  const reserved = fresh ? await reserveRefund(row, campaign._id) : false;
  if (!reserved) {
    row.refundParts.forEach((part) => {
      if (part.status === "pending") {
        part.status = "failed";
        part.error = "Not sent: the campaign changed while the refund was being issued";
      }
    });
    await applyFixedRefundOutcome(row);
    throw new FixedPayError(409, "REFUND_CHANGED", "This campaign changed while the refund was being issued. Refresh and try again.");
  }

  if (refundHooks.beforeSend) await refundHooks.beforeSend(row);
  // Take the send lock; a retry that got there first is already sending this row.
  const locked = await Transaction.findOneAndUpdate(
    { _id: row._id, status: "refund_pending", ...lockFilter(now) },
    { $set: { refundSendingUntil: new Date(now.getTime() + SEND_LOCK_MS) } },
    { new: true }
  );
  if (!locked) {
    const current = await Transaction.findById(row._id);
    return { refund: refundView(current), transaction: current, campaign };
  }
  await sendFixedRefund(locked, note || `Unused budget from content campaign ${campaign._id}`);
  return { refund: refundView(locked), transaction: locked, campaign };
}

// Retries a failed or interrupted fixed refund, reusing its row. The row's send lock is taken in
// the same update that reopens it, so concurrent retries send at most once.
async function retryContentRefund({ campaignId, refundId, note = null, now = new Date() }) {
  if (!mongoose.isValidObjectId(refundId)) throw new FixedPayError(404, "NOT_FOUND", "Refund not found");
  const row = await Transaction.findOne({ _id: refundId, campaignId, type: "refund", bucket: "fixed" });
  if (!row) throw new FixedPayError(404, "NOT_FOUND", "Refund not found");
  const lockUntil = new Date(now.getTime() + SEND_LOCK_MS);

  let claimed = null;
  if (row.status === "refund_failed") {
    // A failed row held nothing: check it's still unused before reserving it again.
    const loaded = await contentBudgetSummary(campaignId, now);
    const unused = loaded ? loaded.summary.unused : 0;
    if (!loaded || !loaded.summary.refundAllowed || (row.refundBreakdown && row.refundBreakdown.deliverables > unused)) {
      throw new FixedPayError(409, "NO_LONGER_REFUNDABLE", "Those deliverables aren't unused any more, so this refund can't be retried");
    }
    claimed = await Transaction.findOneAndUpdate(
      { _id: row._id, status: "refund_failed", ...lockFilter(now) },
      {
        $set: {
          status: "refund_pending",
          refundSendingUntil: lockUntil,
          "refundParts.$[f].status": "pending",
          "refundParts.$[f].error": null,
        },
      },
      { new: true, arrayFilters: [{ "f.status": "failed", "f.chargeReference": { $ne: null } }] }
    );
  } else if (row.status === "refund_pending") {
    const unsent = (row.refundParts || []).some((p) => p.status === "failed" || (p.status === "pending" && !p.sentAt && !p.paystackRefundId && p.chargeReference));
    if (!unsent) throw new FixedPayError(409, "NOT_RETRYABLE", "This refund has already been sent to Paystack");
    claimed = await Transaction.findOneAndUpdate(
      { _id: row._id, status: "refund_pending", ...lockFilter(now) },
      { $set: { refundSendingUntil: lockUntil, "refundParts.$[f].status": "pending", "refundParts.$[f].error": null } },
      { new: true, arrayFilters: [{ "f.status": "failed", "f.chargeReference": { $ne: null } }] }
    );
  } else {
    throw new FixedPayError(409, "NOT_RETRYABLE", "This refund is already complete");
  }
  if (!claimed) throw new FixedPayError(409, "REFUND_IN_PROGRESS", "This refund is being sent right now. Refresh in a moment.");

  if (!(await reserveRefund(claimed, campaignId))) {
    claimed.refundParts.forEach((part) => {
      if (part.status === "pending" && !part.sentAt && !part.paystackRefundId) {
        part.status = "failed";
        part.error = "Not sent: that budget is now owed to creators";
      }
    });
    await applyFixedRefundOutcome(claimed);
    throw new FixedPayError(409, "NO_LONGER_REFUNDABLE", "That budget is now owed to creators, so this refund can't be sent");
  }
  await sendFixedRefund(claimed, note || `Unused budget from content campaign ${campaignId}`);
  return { refund: refundView(claimed), transaction: claimed };
}

module.exports = {
  FIXED_HOLD_MS,
  FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES,
  REFUNDABLE_CAMPAIGN_STATUSES,
  FixedPayError,
  RefundError,
  refundHooks,
  creditReference,
  fixedCreditState: rules.fixedCreditState,
  unusedBudgetRefund: rules.unusedBudgetRefund,
  refundFor,
  canPayAnotherDeliverable,
  creditFixedPay,
  ensureFixedCredit,
  voidUndeliveredPay,
  creatorFixedEarnings,
  fixedEarningsFrom,
  fixedPayableNow,
  contentBudgetSummary,
  refundUnusedContentBudget,
  retryContentRefund,
  applyFixedRefundOutcome,
};
