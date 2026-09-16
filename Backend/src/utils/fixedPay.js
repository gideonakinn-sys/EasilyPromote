// Fixed pay for content campaigns (ticket 09). Fixed pay is the third pot beside views and
// referral: the brand's checkout books the whole payment (creator budget + platform fee) into the
// "fixed" pot, each completed deliverable is credited from it, and credits go out in the weekly
// per-campaign withdrawal like the other pots.
//
// When fixed pay is credited, and when it can be withdrawn:
// - The credit lands when D1 says pay is due: on content approval for brand-page delivery, once
//   the live post is verified for creator page / both. It reserves the placement's reward from
//   the campaign's creator pool at that moment, so the money is promised to the creator.
// - It becomes withdrawable only once the submission is completed (the brand confirmed receipt
//   or the live post, by hand or automatically after 72 hours) AND the 7-day hold has passed
//   since completion. Before completion it shows as waiting for the brand to confirm delivery;
//   during the hold it shows the date the hold ends. The submission's completedAt is the source
//   of truth for both, so nothing needs to be written at completion for money to unlock.
// - Nothing in the product moves content back after approval (appeal decisions and admin review
//   only act on content waiting for review), so a credit is never voided. If such a path is ever
//   added, it must void the credit row and give its amount back to the pool atomically before
//   the submission completes.
//
// Invariants, each enforced by one conditional update:
// - A submission is credited at most once: the campaign's creditedSubmissions guards the pool
//   reservation and the ledger row's reference (fixed_<submissionId>) is unique.
// - Deliverables credited + deliverables refunded never exceed deliverables bought, and credited
//   + refunded creator budget never exceeds the creator pool.
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const { isContentCampaign } = require("./campaignPay");

const FIXED_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
// Submissions that can still earn their fixed pay; rejected content only comes back by appeal.
const SETTLED_WITHOUT_PAY = ["rejected"];
const REFUNDABLE_CAMPAIGN_STATUSES = ["completed", "cancelled"];
// Owed pay stays withdrawable after a campaign is cancelled, as referral earnings do.
const FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES = ["live", "paused", "completed", "cancelled"];

const toKobo = (value) => Math.round((Number(value) || 0) * 100);
const fromKobo = (kobo) => kobo / 100;
const roundMoney = (value) => fromKobo(toKobo(value));

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

const creditReference = (submissionId) => `fixed_${submissionId}`;

// ── Pure calculations ───────────────────────────────────────────────────────

// Where one credit stands for the creator: waiting for the brand to confirm delivery, in its
// 7-day hold after completion, or available to withdraw.
function fixedCreditState(submission, now = new Date()) {
  const completedAt = submission && submission.status === "completed" && submission.completedAt;
  if (!completedAt) return { state: "awaiting_delivery", availableAt: null };
  const availableAt = new Date(new Date(completedAt).getTime() + FIXED_HOLD_MS);
  return availableAt > now ? { state: "on_hold", availableAt } : { state: "available", availableAt };
}

// The unused part of a content campaign a brand can get back (D5): deliverables bought that are
// neither credited, still in progress, nor refunded already, at the brand's rate plus the platform
// fee charged on them. Paystack fees are not deducted, matching the views and referral refunds.
function unusedBudgetRefund({ deliverables, ratePerDeliverable, platformFee, credited, inProgress, refundedDeliverables }) {
  const bought = Math.max(Number(deliverables) || 0, 0);
  const unused = Math.max(bought - (credited || 0) - (inProgress || 0) - (refundedDeliverables || 0), 0);
  if (unused === 0 || bought === 0) return { deliverables: 0, creatorBudget: 0, platformFee: 0, amount: 0 };
  const creatorBudgetKobo = unused * toKobo(ratePerDeliverable);
  // The fee is charged pro rata per deliverable; rounding never refunds more than was charged.
  const feeKobo = Math.floor((toKobo(platformFee) * unused) / bought);
  return {
    deliverables: unused,
    creatorBudget: fromKobo(creatorBudgetKobo),
    platformFee: fromKobo(feeKobo),
    amount: fromKobo(creatorBudgetKobo + feeKobo),
  };
}

// ── Crediting ───────────────────────────────────────────────────────────────

async function placementReward(submission, campaign) {
  const slot = submission.slotId
    ? await Slot.findById(submission.slotId).select("reward").lean()
    : await Slot.findOne({ campaignId: campaign._id, creatorId: submission.creatorId, kind: "deliverable" }).select("reward").lean();
  const reward = slot ? slot.reward : campaign.contentPay && campaign.contentPay.ratePerDeliverable;
  return roundMoney(reward);
}

// Credits one submission's fixed pay from the campaign's creator pool. Safe to call any number of
// times, at once or after a crash part-way: the reservation is keyed on the submission, and the
// ledger row is an upsert on its unique reference. Returns { credited, amount, reason? }.
async function creditFixedPay({ submission, campaign, trigger = null, now = new Date() }) {
  if (!submission || !isContentCampaign(campaign)) return { credited: false, reason: "not_content" };
  const amount = await placementReward(submission, campaign);
  if (!(amount > 0)) return { credited: false, reason: "no_reward" };

  const submissionId = toObjectId(submission._id);
  const reserved = await Campaign.findOneAndUpdate(
    {
      _id: campaign._id,
      "fixedPay.creditedSubmissions": { $ne: submissionId },
      $expr: {
        $and: [
          {
            $lt: [
              { $add: [{ $size: { $ifNull: ["$fixedPay.creditedSubmissions", []] } }, { $ifNull: ["$fixedPay.refundedDeliverables", 0] }] },
              { $ifNull: ["$contentPay.deliverables", 0] },
            ],
          },
          {
            $lte: [
              { $add: [{ $ifNull: ["$fixedPay.credited", 0] }, { $ifNull: ["$fixedPay.refundedCreatorBudget", 0] }, amount] },
              "$creatorPool",
            ],
          },
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

// ── Creator earnings ────────────────────────────────────────────────────────

// A creator's fixed pay per campaign: what's credited, what waits for delivery, what's in the
// hold (and until when), what can be withdrawn now, and what's been requested or paid.
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
  const submissionById = new Map(submissions.map((s) => [String(s._id), s]));

  const byCampaign = new Map();
  const entryFor = (key, campaignId) => {
    if (!byCampaign.has(key)) {
      byCampaign.set(key, {
        campaignId,
        deliverables: 0,
        earnedKobo: 0,
        awaitingKobo: 0,
        onHoldKobo: 0,
        availableKobo: 0,
        withdrawnKobo: 0,
        holdUntil: null,
      });
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
      // The earliest date more pay unlocks.
      if (!entry.holdUntil || availableAt < entry.holdUntil) entry.holdUntil = availableAt;
    } else entry.availableKobo += kobo;
  }
  for (const group of withdrawals) {
    entryFor(String(group._id), group._id).withdrawnKobo += toKobo(group.withdrawn);
  }

  const result = new Map();
  for (const [key, e] of byCampaign) {
    result.set(key, {
      campaignId: e.campaignId,
      deliverables: e.deliverables,
      earned: fromKobo(e.earnedKobo),
      awaitingDelivery: fromKobo(e.awaitingKobo),
      onHold: fromKobo(e.onHoldKobo),
      holdUntil: e.holdUntil,
      available: fromKobo(e.availableKobo),
      withdrawn: fromKobo(e.withdrawnKobo),
      availableToWithdraw: fromKobo(Math.max(e.availableKobo - e.withdrawnKobo, 0)),
    });
  }
  return result;
}

// ── Unused budget refund (D5) ───────────────────────────────────────────────

// What a content campaign has delivered, owes and could refund, from the ledger and submissions.
async function contentBudgetSummary(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || !isContentCampaign(campaign)) return null;

  const [credits, submissions] = await Promise.all([
    Transaction.find({ campaignId: campaign._id, type: "fixed_credit", status: "credited" }).select("submissionId amount").lean(),
    Submission.find({ campaignId: campaign._id }).select("status completedAt").lean(),
  ]);
  const creditedIds = new Set(credits.map((c) => String(c.submissionId)));
  const submissionById = new Map(submissions.map((s) => [String(s._id), s]));
  const completed = credits.filter((c) => {
    const s = submissionById.get(String(c.submissionId));
    return s && s.status === "completed";
  }).length;
  // Content that can still earn pay: not yet credited and not settled without pay.
  const inProgress = submissions.filter((s) => !creditedIds.has(String(s._id)) && !SETTLED_WITHOUT_PAY.includes(s.status)).length;

  const fixedPay = campaign.fixedPay || {};
  const creditedCount = (fixedPay.creditedSubmissions || []).length;
  const refundedDeliverables = fixedPay.refundedDeliverables || 0;
  const deliverables = (campaign.contentPay && campaign.contentPay.deliverables) || 0;
  const refund = unusedBudgetRefund({
    deliverables,
    ratePerDeliverable: campaign.contentPay && campaign.contentPay.ratePerDeliverable,
    platformFee: campaign.platformFee,
    credited: creditedCount,
    inProgress,
    refundedDeliverables,
  });
  const refundAllowed = REFUNDABLE_CAMPAIGN_STATUSES.includes(campaign.status);

  return {
    campaign,
    snapshot: { creditedCount, refundedDeliverables },
    summary: {
      campaignId: campaign._id,
      status: campaign.status,
      ratePerDeliverable: (campaign.contentPay && campaign.contentPay.ratePerDeliverable) || 0,
      deliverables,
      completed,
      // Credited but the brand hasn't confirmed delivery yet.
      owed: creditedCount - completed,
      credited: creditedCount,
      creditedAmount: roundMoney(fixedPay.credited || 0),
      inProgress,
      refunded: refundedDeliverables,
      refundedAmount: roundMoney((fixedPay.refundedCreatorBudget || 0) + (fixedPay.refundedFee || 0)),
      unused: refund.deliverables,
      refundAllowed,
      refundable: refundAllowed ? refund : { deliverables: 0, creatorBudget: 0, platformFee: 0, amount: 0 },
    },
  };
}

class RefundError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Refunds a finished content campaign's unused deliverables to the brand's Paystack payment. The
// deliverables are claimed on the campaign in one conditional update that also checks nothing was
// credited or refunded since the amount was worked out, so a double click or a credit landing at
// the same moment can't refund twice or refund owed money. `expectedAmount` is the amount the admin
// confirmed; if it no longer matches, nothing is refunded.
async function refundUnusedContentBudget({ campaignId, expectedAmount = null, note = null }) {
  const { refundCampaignBucket } = require("./refunds");
  const loaded = await contentBudgetSummary(campaignId);
  if (!loaded) throw new RefundError(404, "NOT_CONTENT_CAMPAIGN", "Content campaign not found");
  const { campaign, snapshot, summary } = loaded;
  if (!summary.refundAllowed) {
    throw new RefundError(400, "CAMPAIGN_NOT_FINISHED", "Unused budget can only be refunded once the campaign is completed or cancelled");
  }
  const refund = summary.refundable;
  if (!(refund.amount > 0)) throw new RefundError(400, "NOTHING_TO_REFUND", "This campaign has no unused budget to refund");
  if (expectedAmount !== null && toKobo(expectedAmount) !== toKobo(refund.amount)) {
    throw new RefundError(409, "REFUND_CHANGED", "The refundable amount changed. Check the new amount and confirm again.", { summary });
  }

  const claimed = await Campaign.findOneAndUpdate(
    {
      _id: campaign._id,
      status: { $in: REFUNDABLE_CAMPAIGN_STATUSES },
      $expr: {
        $and: [
          { $eq: [{ $size: { $ifNull: ["$fixedPay.creditedSubmissions", []] } }, snapshot.creditedCount] },
          { $eq: [{ $ifNull: ["$fixedPay.refundedDeliverables", 0] }, snapshot.refundedDeliverables] },
        ],
      },
    },
    {
      $inc: {
        "fixedPay.refundedDeliverables": refund.deliverables,
        "fixedPay.refundedCreatorBudget": refund.creatorBudget,
        "fixedPay.refundedFee": refund.platformFee,
      },
    },
    { new: true, projection: { _id: 1 } }
  );
  if (!claimed) {
    throw new RefundError(409, "REFUND_CHANGED", "This campaign changed while the refund was being issued. Refresh and try again.");
  }

  const row = await refundCampaignBucket({
    campaignId: campaign._id,
    bucket: "fixed",
    amount: refund.amount,
    reference: `refund_fixed_${campaign._id}_${snapshot.refundedDeliverables + refund.deliverables}`,
    refundBreakdown: { deliverables: refund.deliverables, creatorBudget: refund.creatorBudget, platformFee: refund.platformFee },
    note: note || `Unused budget from content campaign ${campaign._id}`,
  });
  if (!row) {
    // The reference is unique per claim, so this means the ledger already has this refund.
    console.error(`[FixedPay] Refund row for campaign ${campaign._id} already existed after claiming`);
  }
  return { refund, transaction: row, campaign };
}

module.exports = {
  FIXED_HOLD_MS,
  FIXED_WITHDRAWABLE_CAMPAIGN_STATUSES,
  REFUNDABLE_CAMPAIGN_STATUSES,
  RefundError,
  creditReference,
  fixedCreditState,
  unusedBudgetRefund,
  creditFixedPay,
  ensureFixedCredit,
  creatorFixedEarnings,
  contentBudgetSummary,
  refundUnusedContentBudget,
};
