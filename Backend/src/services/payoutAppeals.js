// Payout appeals (D23). A creator can appeal, within 7 days, an admin's decision that took pay away:
// a rejected withdrawal, or fixed pay voided because approved content was never delivered to the brand.
// Admins see them beside content appeals in one inbox (services/appealsInbox.js) and decide:
//
// - Deny (any admin role): the decision stands, with a note. Final; the creator is told.
// - Grant (finance / super admin only, D19, because it moves money):
//   - withdrawal: it goes back in the payout queue as it was, if every part of it is still available to
//     withdraw and no other withdrawal for that campaign is in flight. It keeps its request date, so
//     it's due in the next payout run, where escrow and holds are checked again as for any withdrawal.
//   - voided pay: the content goes back to awaiting delivery and the pay is credited again from the
//     creator pool (utils/fixedPay.restoreVoidedPay), if the creator's place and the budget are still there.
//
// While a voided-pay appeal is open or can still be filed, its deliverable isn't refundable
// (fixedPayRules.canStillEarn), so automatic and admin refunds leave that money alone.
//
// A grant claims the appeal first ("resolving"); a refusal (the money isn't there any more) puts it back
// to open with the reason, and a grant a crash interrupted can be taken over after 5 minutes. Each step
// of a grant is idempotent, so taking one over never pays twice.
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const PayoutAppeal = require("../models/PayoutAppeal");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const { emitToRole } = require("../config/socket");
const { recordAdminActivity } = require("./adminActivity");
const { APPEAL_WINDOW_MS } = require("../utils/fixedPayRules");
const { toKobo } = require("../utils/money");

const MONEY_ROLES = ["finance_admin", "super_admin"];
const RESOLVING_STALE_MS = 5 * 60 * 1000;
const naira = (amount) => `₦${Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

class PayoutAppealError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new PayoutAppealError(status, code, message);
};

function appealView(appeal, campaignName = null) {
  return {
    id: appeal._id,
    subjectType: appeal.subjectType,
    subjectId: appeal.subjectId,
    campaignId: appeal.campaignId,
    campaignName,
    amount: appeal.amount,
    decisionReason: appeal.decisionReason,
    reason: appeal.reason,
    status: appeal.status === "resolving" ? "open" : appeal.status,
    resolving: appeal.status === "resolving",
    resolutionNote: appeal.resolutionNote,
    resolvedAt: appeal.resolvedAt,
    createdAt: appeal.createdAt,
  };
}

// ── Creator ─────────────────────────────────────────────────────────────────

// What a creator can still appeal: rejected withdrawals and voided pay from the last 7 days that have no
// appeal yet, and every appeal they've filed.
async function creatorPayoutAppeals(creatorId, now = new Date()) {
  const since = new Date(now.getTime() - APPEAL_WINDOW_MS);
  const [appeals, rejected, voided] = await Promise.all([
    PayoutAppeal.find({ creatorId }).sort({ createdAt: -1 }).lean(),
    Withdrawal.find({ creatorId, status: "rejected", reviewedAt: { $gt: since } }).select("campaignId amount adminNotes reviewedAt").lean(),
    Submission.find({ creatorId, status: "not_delivered", voidAppealableUntil: { $gt: now }, voidAppealOpen: { $ne: true } })
      .select("campaignId notDeliveredAt voidAppealableUntil")
      .lean(),
  ]);
  const appealed = new Set(appeals.map((a) => `${a.subjectType}:${a.subjectId}`));
  const voidCredits = voided.length
    ? await Transaction.find({ type: "fixed_void", submissionId: { $in: voided.map((s) => s._id) } }).select("submissionId amount").lean()
    : [];
  const voidAmount = new Map(voidCredits.map((v) => [String(v.submissionId), v.amount]));
  const campaignIds = [...new Set([...appeals, ...rejected, ...voided].map((r) => String(r.campaignId)))];
  const names = new Map((await Campaign.find({ _id: { $in: campaignIds } }).select("name").lean()).map((c) => [String(c._id), c.name]));

  const appealable = [
    ...rejected
      .filter((w) => !appealed.has(`withdrawal:${w._id}`))
      .map((w) => ({
        subjectType: "withdrawal",
        subjectId: w._id,
        campaignId: w.campaignId,
        campaignName: names.get(String(w.campaignId)) || "Campaign",
        amount: w.amount,
        decisionReason: w.adminNotes || null,
        decidedAt: w.reviewedAt,
        appealableUntil: new Date(new Date(w.reviewedAt).getTime() + APPEAL_WINDOW_MS),
      })),
    ...voided
      .filter((s) => !appealed.has(`fixed_void:${s._id}`))
      .map((s) => ({
        subjectType: "fixed_void",
        subjectId: s._id,
        campaignId: s.campaignId,
        campaignName: names.get(String(s.campaignId)) || "Campaign",
        amount: voidAmount.get(String(s._id)) || 0,
        decisionReason: "Approved content was never delivered to the brand",
        decidedAt: s.notDeliveredAt,
        appealableUntil: s.voidAppealableUntil,
      })),
  ].sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt));

  return { appeals: appeals.map((a) => appealView(a, names.get(String(a.campaignId)) || "Campaign")), appealable };
}

async function fileAppeal({ creator, subjectType, subjectId, reason, now = new Date() }) {
  const text = String(reason || "").trim();
  if (text.length < 10) fail(400, "REASON_REQUIRED", "Say why the decision should be reviewed (at least 10 characters)");
  if (text.length > 2000) fail(400, "REASON_TOO_LONG", "Keep the reason under 2,000 characters");
  if (!["withdrawal", "fixed_void"].includes(subjectType)) fail(400, "INVALID_SUBJECT", "Choose a rejected withdrawal or voided pay to appeal");
  if (!mongoose.isValidObjectId(subjectId)) fail(404, "NOT_FOUND", "Nothing to appeal was found");
  if (await PayoutAppeal.exists({ subjectType, subjectId, creatorId: creator._id })) fail(409, "ALREADY_APPEALED", "You've already appealed this decision");

  let fields;
  if (subjectType === "withdrawal") {
    const withdrawal = await Withdrawal.findOne({ _id: subjectId, creatorId: creator._id }).lean();
    if (!withdrawal) fail(404, "NOT_FOUND", "Withdrawal not found");
    if (withdrawal.status !== "rejected") fail(409, "NOT_REJECTED", "Only a rejected withdrawal can be appealed");
    if (!withdrawal.reviewedAt || now.getTime() - new Date(withdrawal.reviewedAt).getTime() > APPEAL_WINDOW_MS) {
      fail(409, "APPEAL_WINDOW_CLOSED", "The 7 days to appeal this decision have passed");
    }
    fields = { campaignId: withdrawal.campaignId, businessId: withdrawal.businessId, amount: withdrawal.amount, decisionReason: withdrawal.adminNotes || null };
  } else {
    const submission = await Submission.findOne({ _id: subjectId, creatorId: creator._id }).lean();
    if (!submission) fail(404, "NOT_FOUND", "Content not found");
    if (submission.status !== "not_delivered") fail(409, "NOT_VOIDED", "Only voided pay can be appealed");
    // Marks the deliverable as still earning before the appeal exists, so no refund can take it meanwhile.
    const marked = await Submission.findOneAndUpdate(
      { _id: submission._id, status: "not_delivered", $or: [{ voidAppealOpen: true }, { voidAppealableUntil: { $gt: now } }] },
      { $set: { voidAppealOpen: true } },
      { new: true }
    );
    if (!marked) fail(409, "APPEAL_WINDOW_CLOSED", "The 7 days to appeal this decision have passed");
    const [campaign, reversal] = await Promise.all([
      Campaign.findById(submission.campaignId).select("businessId").lean(),
      Transaction.findOne({ type: "fixed_void", submissionId: submission._id }).select("amount").lean(),
    ]);
    fields = {
      campaignId: submission.campaignId,
      businessId: campaign ? campaign.businessId : null,
      amount: reversal ? reversal.amount : 0,
      decisionReason: "Approved content was never delivered to the brand",
    };
  }

  let appeal;
  try {
    appeal = await PayoutAppeal.create({ creatorId: creator._id, subjectType, subjectId, reason: text, status: "open", ...fields });
  } catch (error) {
    if (error.code === 11000) fail(409, "ALREADY_APPEALED", "You've already appealed this decision");
    throw error;
  }

  const campaign = await Campaign.findById(appeal.campaignId).select("name").lean();
  for (const role of ["admin", "super_admin", "finance_admin", "support"]) {
    emitToRole(role, "payout-appealed", { appealId: appeal._id, campaignId: appeal.campaignId, campaignName: campaign ? campaign.name : null });
  }
  return appealView(appeal.toObject(), campaign ? campaign.name : "Campaign");
}

// ── Admin ───────────────────────────────────────────────────────────────────

// The withdrawal back in the payout queue, if what it pays is still available. Idempotent.
async function reinstateWithdrawal(appeal, now) {
  const withdrawal = await Withdrawal.findById(appeal.subjectId);
  if (!withdrawal) fail(404, "NOT_FOUND", "The withdrawal no longer exists");
  if (withdrawal.appealReinstatedAt) return { withdrawalStatus: withdrawal.status, amount: withdrawal.amount };
  if (withdrawal.status !== "rejected") fail(409, "NOT_REJECTED", "This withdrawal isn't rejected any more");

  const inFlight = await Withdrawal.exists({ creatorId: withdrawal.creatorId, campaignId: withdrawal.campaignId, status: { $in: ["pending", "processing"] } });
  if (inFlight) {
    fail(409, "WITHDRAWAL_IN_FLIGHT", "The creator already has a withdrawal in the queue for this campaign. Deny this appeal or wait until that one is paid or rejected.");
  }

  const campaign = await Campaign.findById(withdrawal.campaignId).select("status").lean();
  const { creatorViewsEarnings } = require("../utils/earnings");
  const { creatorReferralEarnings } = require("../utils/referralEarnings");
  const { creatorFixedEarnings } = require("../utils/fixedPay");
  const { creatorBonusEarnings } = require("../utils/hybridBonus");
  const ids = [withdrawal.campaignId];
  const key = String(withdrawal.campaignId);
  const [views, referral, fixed, bonus] = await Promise.all([
    creatorViewsEarnings(withdrawal.creatorId, { campaignIds: ids }),
    creatorReferralEarnings(withdrawal.creatorId, { campaignIds: ids, now }),
    creatorFixedEarnings(withdrawal.creatorId, { campaignIds: ids, now }),
    creatorBonusEarnings(withdrawal.creatorId, { campaignIds: ids, now }),
  ]);
  const kind = withdrawal.kind || "views";
  const parts = {
    views: kind === "campaign" ? withdrawal.viewsAmount || 0 : kind === "views" ? withdrawal.amount : 0,
    referral: kind === "campaign" ? withdrawal.referralAmount || 0 : kind === "referral" ? withdrawal.amount : 0,
    fixed: kind === "campaign" ? withdrawal.fixedAmount || 0 : 0,
    bonus: kind === "campaign" ? withdrawal.bonusAmount || 0 : 0,
  };
  const viewsWithdrawable = campaign && ["live", "paused", "completed"].includes(campaign.status);
  const available = {
    views: viewsWithdrawable && views.get(key) ? views.get(key).availableToWithdraw : 0,
    referral: referral.get(key) ? referral.get(key).availableToWithdraw : 0,
    fixed: fixed.get(key) ? fixed.get(key).availableToWithdraw : 0,
    bonus: bonus.get(key) ? bonus.get(key).availableToWithdraw : 0,
  };
  const short = Object.keys(parts).filter((pot) => toKobo(parts[pot]) > toKobo(available[pot]));
  if (short.length > 0) {
    fail(
      409,
      "NO_LONGER_AVAILABLE",
      `The creator's ${short.join(" and ")} earnings on this campaign no longer cover this withdrawal (for example they requested it again or earnings were voided). Deny this appeal; they can request what's available.`
    );
  }

  let reinstated;
  try {
    reinstated = await Withdrawal.findOneAndUpdate(
      { _id: withdrawal._id, status: "rejected" },
      {
        $set: {
          status: "pending",
          reviewedAt: null,
          appealReinstatedAt: now,
          adminNotes: `Back in the payout queue after an appeal${appeal.resolutionNote ? `: ${appeal.resolutionNote}` : ""}`,
        },
      },
      { new: true }
    );
  } catch (error) {
    if (error.code === 11000) fail(409, "WITHDRAWAL_IN_FLIGHT", "The creator already has a withdrawal in the queue for this campaign");
    throw error;
  }
  if (!reinstated) fail(409, "NOT_REJECTED", "This withdrawal isn't rejected any more");
  return { withdrawalStatus: reinstated.status, amount: reinstated.amount };
}

async function grant(appeal, now) {
  if (appeal.subjectType === "withdrawal") return reinstateWithdrawal(appeal, now);
  const { restoreVoidedPay, FixedPayError } = require("../utils/fixedPay");
  try {
    const { restoredAmount } = await restoreVoidedPay({ submissionId: appeal.subjectId, now });
    return { restoredAmount };
  } catch (error) {
    if (error instanceof FixedPayError) fail(error.status, error.code, error.message);
    throw error;
  }
}

async function notifyCreator(appeal, campaignName, decision, note) {
  const subject = appeal.subjectType === "withdrawal" ? `withdrawal of ${naira(appeal.amount)}` : "voided pay";
  const body =
    decision === "granted"
      ? appeal.subjectType === "withdrawal"
        ? `Your appeal was granted: your ${subject} on "${campaignName}" is back in the payout queue for the next Friday payout.`
        : `Your appeal was granted: your pay on "${campaignName}" is restored. Deliver your content to the brand to complete it.`
      : `Your appeal about your ${subject} on "${campaignName}" was reviewed and the decision stands.`;
  await Notification.create({
    creatorId: appeal.creatorId,
    campaignId: appeal.campaignId,
    type: decision === "granted" ? "payout_appeal_granted" : "payout_appeal_denied",
    title: decision === "granted" ? "Payout appeal granted" : "Payout appeal denied",
    body: `${body}${note ? ` Note: ${note}` : ""}`,
  });
}

// Admin's decision on a payout appeal. `admin` is req.user; money-moving grants need a money role.
async function resolvePayoutAppeal({ appealId, decision, note, req, now = new Date() }) {
  const admin = req.user;
  if (!["grant", "deny"].includes(decision)) fail(400, "INVALID_DECISION", "Decision must be grant or deny");
  const text = String(note || "").trim().slice(0, 1000);
  if (decision === "deny" && !text) fail(400, "NOTE_REQUIRED", "Add a note saying why the decision stands");
  if (decision === "grant" && !MONEY_ROLES.includes(admin.role)) {
    fail(403, "MONEY_ROLE_REQUIRED", "Only finance admins and super admins can grant a payout appeal, because granting moves money");
  }
  if (!mongoose.isValidObjectId(appealId)) fail(404, "NOT_FOUND", "Appeal not found");
  const existing = await PayoutAppeal.findById(appealId).lean();
  if (!existing) fail(404, "NOT_FOUND", "Appeal not found");
  if (["granted", "denied"].includes(existing.status)) fail(409, "ALREADY_RESOLVED", "This appeal has already been decided");

  const claimable = { _id: existing._id, $or: [{ status: "open" }, { status: "resolving", resolvingAt: { $lt: new Date(now.getTime() - RESOLVING_STALE_MS) } }] };
  const campaign = await Campaign.findById(existing.campaignId).select("name businessId").lean();
  const campaignName = campaign ? campaign.name : "Campaign";
  const decidedBy = { resolvedBy: admin._id, resolvedByName: admin.name || admin.email || null, resolvedAt: now, resolutionNote: text || null };

  let resolved;
  let outcome = null;
  if (decision === "deny") {
    // Only an open appeal can be denied: a grant in progress may already have moved money.
    resolved = await PayoutAppeal.findOneAndUpdate({ _id: existing._id, status: "open" }, { $set: { status: "denied", resolvingAt: null, ...decidedBy } }, { new: true });
    if (!resolved) fail(409, "APPEAL_IN_PROGRESS", "This appeal is being decided right now. Refresh in a moment.");
    if (resolved.subjectType === "fixed_void") {
      // Decided: the voided deliverable is unused from now on.
      await Submission.updateOne({ _id: resolved.subjectId, status: "not_delivered" }, { $unset: { voidAppealOpen: 1, voidAppealableUntil: 1 } });
    }
  } else {
    const claimed = await PayoutAppeal.findOneAndUpdate(claimable, { $set: { status: "resolving", resolvingAt: now, resolutionNote: text || null } }, { new: true });
    if (!claimed) fail(409, "APPEAL_IN_PROGRESS", "This appeal is being decided right now. Refresh in a moment.");
    try {
      outcome = await grant(claimed, now);
    } catch (error) {
      await PayoutAppeal.updateOne({ _id: claimed._id, status: "resolving", resolvingAt: now }, { $set: { status: "open", resolvingAt: null } });
      throw error;
    }
    resolved = await PayoutAppeal.findOneAndUpdate(
      { _id: claimed._id, status: "resolving" },
      { $set: { status: "granted", resolvingAt: null, outcome, ...decidedBy } },
      { new: true }
    );
    if (!resolved) resolved = await PayoutAppeal.findById(claimed._id);
  }

  await notifyCreator(resolved, campaignName, resolved.status, text || null);
  await recordAdminActivity(req, {
    action: decision === "grant" ? "payout_appeal.granted" : "payout_appeal.denied",
    targetType: resolved.subjectType === "withdrawal" ? "withdrawal" : "submission",
    targetId: resolved.subjectId,
    targetLabel: `${resolved.subjectType === "withdrawal" ? "Withdrawal" : "Voided pay"} · ${campaignName}`,
    businessId: campaign ? campaign.businessId : null,
    note: text || null,
    metadata: { appealId: resolved._id, amount: resolved.amount, campaignId: resolved.campaignId, creatorId: resolved.creatorId, outcome },
  });
  return { appeal: appealView(resolved.toObject(), campaignName), outcome };
}

module.exports = { MONEY_ROLES, PayoutAppealError, appealView, creatorPayoutAppeals, fileAppeal, resolvePayoutAppeal };
