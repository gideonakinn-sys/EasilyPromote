// Automatic unused-budget refunds (ticket 11, D5 amended). Once a campaign has ended, what no creator
// can still earn goes back to the brand's Paystack payment without an admin pressing a button, through
// the same crash-safe refund rows admins use (admins can still refund by hand; whichever runs first
// wins and the other finds nothing left):
//
// - Content base (fixed pot): unused deliverables × rate + the fee on them, as soon as the campaign is
//   completed or cancelled and again whenever more becomes unused (an appeal window closes). Credited
//   pay, content still in review, delivery or appeal, rejected content inside its 7-day appeal window
//   (D17) and voided pay inside its appeal window are never refunded (utils/fixedPayRules).
// - Hybrid bonus pool: the unused pool + the fee on it, once refundable (cancelled; completed for a views
//   bonus; 7 days after completion for sign-ups / downloads) and while no content on the campaign is
//   under appeal or can still be appealed. Credited bonus stays owed.
// - Views: a cancelled campaign's cancel refund if it never happened; a completed campaign's places nobody
//   took, 7 days after completion, holding back every placed creator's full reward (views keep syncing).
// - Referral budget: a cancelled campaign's cancel refund if it never happened (or a crash cut it short);
//   a completed campaign's unearned pool + its fee 7 days after completion (conversions still count
//   until then), never while sign-ups wait for admin's reward or a back-pay is in flight.
//
// Each run also retries refund rows a crash left unsent (after their send lock), checking Paystack's own
// refunds first. Failures are recorded on the campaign (autoRefund) and raised as the
// auto_refund_failed ops alert; a refund Paystack refuses stays failed for finance to retry (D23).
//
// Off unless AUTO_REFUNDS_ENABLED=true (utils/autoRefundSwitch): the first run refunds every campaign
// that ended in the last 90 days, so finance switches it on deliberately.
const mongoose = require("mongoose");
const AdminActivity = require("../models/AdminActivity");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const Notification = require("../models/Notification");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const { isContentCampaign } = require("../utils/campaignPay");
const { contentBudgetSummary, refundUnusedContentBudget, retryContentRefund } = require("../utils/fixedPay");
const { isHybridCampaign, refundUnusedBonusPool } = require("../utils/hybridBonus");
const { CONVERSION_GRACE_MS } = require("../utils/hybridBonusRules");
const { refundViewsEscrow, refundCompletedViewsEscrow } = require("../utils/escrow");
const { refundUnusedReferralBudget } = require("../utils/referralEarnings");
const { retryBucketRefund, refundRowState, lockFilter } = require("../utils/refunds");
const { autoRefundsEnabled } = require("../utils/autoRefundSwitch");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JOB_INTERVAL_MS = HOUR;
// Views and referral refunds on a completed campaign wait this long (conversions still count; appeals).
const COMPLETED_WAIT_MS = CONVERSION_GRACE_MS;
// Campaigns that ended longer ago than this aren't looked at again.
const LOOKBACK_MS = 90 * DAY;
// A refund row left unsent is retried once it's this old (and its send lock has run out).
const UNSENT_RETRY_AFTER_MS = 10 * MINUTE;
// Refusals that only mean someone else got there first or there's nothing to do.
const BENIGN_CODES = new Set(["NOTHING_TO_REFUND", "REFUND_CHANGED", "REFUND_IN_PROGRESS", "CAMPAIGN_NOT_FINISHED", "NOT_RETRYABLE"]);
const SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId("000000000000000000000000");
const POT_LABELS = { fixed: "unused deliverable budget", bonus: "unused bonus pool", views: "unused views budget", referral: "unused referral budget" };

const naira = (amount) => `₦${Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

// Content on the campaign that is under appeal or can still be appealed (content rejections, D17, and
// voided pay): money it could still earn must stay.
function openAppealsFilter(campaignId, now) {
  return {
    campaignId,
    $or: [
      { status: "appealed" },
      { status: "rejected", appealableUntil: { $gt: now } },
      { status: "not_delivered", $or: [{ voidAppealOpen: true }, { voidAppealableUntil: { $gt: now } }] },
    ],
  };
}

async function audit({ campaign, pot, amount, state, error = null }) {
  try {
    await AdminActivity.create({
      actorId: SYSTEM_ACTOR_ID,
      actorName: "Automatic refunds",
      actorRole: "system",
      action: "campaign.unused_budget_auto_refunded",
      targetType: "campaign",
      targetId: campaign._id,
      targetLabel: campaign.name,
      businessId: campaign.businessId,
      metadata: { pot, amount, state, error },
    });
  } catch (err) {
    console.error("[AutoRefunds] Couldn't record activity:", err.message);
  }
}

async function tellBrand(campaign, pot, amount) {
  await Notification.create({
    businessId: campaign.businessId,
    campaignId: campaign._id,
    type: "campaign_refund",
    title: "Unused budget refunded",
    body: `${naira(amount)} of ${POT_LABELS[pot]} on "${campaign.name}" is being refunded to your payment method.`,
  }).catch((error) => console.error("[AutoRefunds] Couldn't notify the brand:", error.message));
}

// The refund row a bucket refund just wrote (views, referral) and how it stands.
async function latestRow(campaignId, bucket) {
  const row = await Transaction.findOne({ campaignId, type: "refund", bucket }).sort({ createdAt: -1 }).lean();
  return row ? { row, ...refundRowState(row) } : null;
}

// One pot's refund on one campaign. `send` returns { amount, state, error } or null when nothing was refunded.
async function attempt(result, campaign, pot, send) {
  try {
    const outcome = await send();
    if (!outcome || !(outcome.amount > 0)) return;
    result.refunds.push({ campaignId: campaign._id, pot, amount: outcome.amount, state: outcome.state });
    await audit({ campaign, pot, amount: outcome.amount, state: outcome.state, error: outcome.error || null });
    if (["sent", "refunded"].includes(outcome.state)) await tellBrand(campaign, pot, outcome.amount);
    else result.failures.push(`${POT_LABELS[pot]} refund of ${naira(outcome.amount)} ${outcome.state === "failed" ? "failed" : "wasn't sent"}: ${outcome.error || "unknown error"}`);
  } catch (error) {
    if (error && BENIGN_CODES.has(error.code)) return;
    if (error && error.code === "REFUND_NEEDS_RETRY") {
      const failed = ((error.extra && error.extra.summary && error.extra.summary.refunds) || []).some((r) => r.state === "failed");
      // An unsent row is retried by this job; a failed one needs finance.
      if (failed) result.failures.push("an earlier content budget refund failed; retry it before more can be refunded");
      return;
    }
    console.error(`[AutoRefunds] ${pot} refund for campaign ${campaign._id} failed:`, error.message);
    result.failures.push(`${POT_LABELS[pot]} refund couldn't run: ${error.message}`);
  }
}

// Every pot of one ended campaign. Returns { refunds, failures }.
async function refundEndedCampaign(campaign, now = new Date()) {
  const result = { refunds: [], failures: [] };
  const cancelled = campaign.status === "cancelled";
  const completedAt = campaign.completedAt ? new Date(campaign.completedAt) : (campaign.updatedAt ? new Date(campaign.updatedAt) : null);
  const waitedAfterCompletion = cancelled || (completedAt && now.getTime() - completedAt.getTime() >= COMPLETED_WAIT_MS);

  if (isContentCampaign(campaign)) {
    const loaded = await contentBudgetSummary(campaign._id, now);
    if (loaded && loaded.summary.refundable.amount > 0) {
      await attempt(result, campaign, "fixed", async () => {
        const { refund } = await refundUnusedContentBudget({ campaignId: campaign._id, note: `Automatic refund: unused budget from content campaign ${campaign._id}`, now });
        return { amount: refund.amount, state: refund.state, error: refund.error };
      });
    } else if (loaded && loaded.summary.refunds.some((r) => r.state === "failed")) {
      result.failures.push("an earlier content budget refund failed; retry it");
    }
  }

  if (isHybridCampaign(campaign) && !(await Submission.exists(openAppealsFilter(campaign._id, now)))) {
    await attempt(result, campaign, "bonus", async () => {
      const { refund } = await refundUnusedBonusPool({ campaignId: campaign._id, note: `Automatic refund: unused bonus pool from hybrid campaign ${campaign._id}`, now });
      return { amount: refund.amount, state: refund.state, error: refund.error };
    });
  }

  const hasViewsMoney = !isContentCampaign(campaign) && (await Transaction.exists({ campaignId: campaign._id, type: { $in: ["escrow_deposit", "topup"] }, bucket: { $nin: ["referral", "fixed", "bonus"] } }));
  if (hasViewsMoney && waitedAfterCompletion && !(await Submission.exists({ campaignId: campaign._id, status: "appealed" }))) {
    await attempt(result, campaign, "views", async () => {
      const amount = cancelled ? await refundViewsEscrow(campaign._id) : await refundCompletedViewsEscrow(campaign._id);
      if (!(amount > 0)) return null;
      const latest = await latestRow(campaign._id, { $nin: ["referral", "fixed", "bonus"] });
      return { amount, state: latest ? latest.state : "sent", error: latest ? latest.error : null };
    });
  }

  const referral = campaign.referral || {};
  if (!isHybridCampaign(campaign) && referral.pool > 0 && waitedAfterCompletion) {
    const [waitingForReward, backPayInFlight] = await Promise.all([
      ConversionEvent.exists({ campaignId: campaign._id, counted: true, voidedAt: null, unpaidReason: "rate_not_set", rewardAmount: { $not: { $gt: 0 } } }),
      ConversionEvent.exists({ campaignId: campaign._id, payingClaim: { $ne: null } }),
    ]);
    if (!cancelled && waitingForReward) {
      result.failures.push("sign-ups are waiting for a reward, so the referral budget isn't refunded; set the reward first");
    } else if (!backPayInFlight && !((referral.payingConversions || []).length > 0)) {
      await attempt(result, campaign, "referral", async () => {
        const amount = await refundUnusedReferralBudget(campaign._id);
        if (!(amount > 0)) return null;
        const latest = await latestRow(campaign._id, "referral");
        return { amount, state: latest ? latest.state : "sent", error: latest ? latest.error : null };
      });
    }
  }
  return result;
}

// Refund rows a crash left with parts never sent, retried from their own rows.
async function retryUnsentRefunds(now) {
  const rows = await Transaction.find({
    type: "refund",
    status: "refund_pending",
    createdAt: { $lte: new Date(now.getTime() - UNSENT_RETRY_AFTER_MS) },
    ...lockFilter(now),
    refundParts: { $elemMatch: { status: "pending", sentAt: null, paystackRefundId: null, chargeReference: { $ne: null } } },
  })
    .select("campaignId bucket")
    .lean();
  let retried = 0;
  for (const row of rows) {
    try {
      if (row.bucket === "fixed") await retryContentRefund({ campaignId: row.campaignId, refundId: row._id, now });
      else await retryBucketRefund({ refundId: row._id, now });
      retried += 1;
    } catch (error) {
      if (!BENIGN_CODES.has(error.code)) console.error(`[AutoRefunds] Retrying unsent refund ${row._id} failed:`, error.message);
    }
  }
  return retried;
}

// Records (or clears) what went wrong on a campaign, without touching its updatedAt.
async function recordOutcome(campaign, failures, now) {
  const had = Boolean(campaign.autoRefund && campaign.autoRefund.error);
  if (failures.length > 0) {
    const error = failures.join("; ").slice(0, 1000);
    if (had && campaign.autoRefund.error === error) return;
    await Campaign.updateOne(
      { _id: campaign._id },
      { $set: { "autoRefund.error": error, "autoRefund.failedAt": had ? campaign.autoRefund.failedAt : now } },
      { timestamps: false }
    );
  } else if (had) {
    await Campaign.updateOne({ _id: campaign._id }, { $unset: { autoRefund: 1 } }, { timestamps: false });
  }
}

// One run over every campaign that ended in the last 90 days. Never throws for one campaign.
// Does nothing (skipped: true) unless AUTO_REFUNDS_ENABLED=true.
async function runAutoRefunds({ now = new Date() } = {}) {
  const summary = { skipped: false, campaigns: 0, refunds: [], failed: 0, retried: 0 };
  if (!autoRefundsEnabled()) return { ...summary, skipped: true };
  summary.retried = await retryUnsentRefunds(now).catch((error) => {
    console.error("[AutoRefunds] Retrying unsent refunds failed:", error.message);
    return 0;
  });

  const since = new Date(now.getTime() - LOOKBACK_MS);
  const campaigns = await Campaign.find({
    $or: [
      { status: "completed", $or: [{ completedAt: { $gte: since } }, { completedAt: null, updatedAt: { $gte: since } }] },
      { status: "cancelled", updatedAt: { $gte: since } },
      // Flagged campaigns are always checked again, so their alert can clear.
      { "autoRefund.error": { $type: "string" } },
    ],
  }).lean();

  for (const campaign of campaigns) {
    // Unpaid drafts cancelled have nothing to refund.
    if (!(await Transaction.exists({ campaignId: campaign._id }))) continue;
    summary.campaigns += 1;
    let result;
    try {
      result = await refundEndedCampaign(campaign, now);
    } catch (error) {
      console.error(`[AutoRefunds] Campaign ${campaign._id} failed:`, error.message);
      result = { refunds: [], failures: [`automatic refund couldn't run: ${error.message}`] };
    }
    summary.refunds.push(...result.refunds);
    if (result.failures.length > 0) summary.failed += 1;
    await recordOutcome(campaign, result.failures, now).catch((error) => console.error(`[AutoRefunds] Couldn't record outcome for ${campaign._id}:`, error.message));
  }
  return summary;
}

function startAutoRefunds() {
  if (!autoRefundsEnabled()) {
    console.log("[AutoRefunds] Off — AUTO_REFUNDS_ENABLED isn't true; nothing is refunded automatically (admin refunds and retries still work)");
    return;
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.log("[AutoRefunds] Skipped — PAYSTACK_SECRET_KEY not set");
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runAutoRefunds({ now: new Date() });
      if (summary.refunds.length || summary.failed || summary.retried) {
        console.log(`[AutoRefunds] ${summary.refunds.length} refunds, ${summary.retried} retried, ${summary.failed} campaigns with problems`);
      }
    } catch (error) {
      console.error("[AutoRefunds] Run failed:", error.message);
    } finally {
      running = false;
    }
  };
  run();
  setInterval(run, JOB_INTERVAL_MS);
}

module.exports = { COMPLETED_WAIT_MS, runAutoRefunds, refundEndedCampaign, openAppealsFilter, startAutoRefunds };
