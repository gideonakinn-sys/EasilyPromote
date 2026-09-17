// Ops alerts (M7): things that went wrong quietly and need a person. collectAlerts reads the
// database and returns what's wrong right now; runOpsAlerts records each alert once (one active
// alert per kind + subject), resolves the ones whose condition cleared, and emails new ones to
// OPS_ALERT_EMAIL. The job runs every 15 minutes; reconciliation checks campaigns with money
// movement in the last 48 hours on each run and every campaign once a day.
//
// Kinds and thresholds:
//   payout_failed             a withdrawal back in the queue after its latest transfer failed
//   withdrawal_stuck          a withdrawal in processing for more than 24 hours
//   refund_stuck              a views, referral or fixed refund pending, failed or unsent for more than 1 hour
//   webhook_failing           5+ rejected conversion webhooks for one brand key in the last hour
//   content_deadline_stuck    content waiting on the brand more than 72 hours + 1 hour grace (auto job stuck)
//   application_expiry_stuck  applications pending more than 7 days + 2 hours grace (expiry job stuck)
//   reconciliation_mismatch   a live, paused, completed or cancelled campaign whose books don't balance
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const CampaignApplication = require("../models/CampaignApplication");
const OpsAlert = require("../models/OpsAlert");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const WebhookDelivery = require("../models/WebhookDelivery");
const Withdrawal = require("../models/Withdrawal");
const { reconcileCampaigns } = require("./campaignReconciliation");
const { isContentCampaign } = require("../utils/campaignPay");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const THRESHOLDS = {
  withdrawalProcessingMs: 24 * HOUR,
  refundMs: HOUR,
  failedPayoutLookbackMs: 30 * DAY,
  webhookWindowMs: HOUR,
  webhookRejections: 5,
  contentDeadlineMs: 72 * HOUR + HOUR,
  applicationExpiryMs: 7 * DAY + 2 * HOUR,
  recentMoneyMs: 48 * HOUR,
  finishedCampaignLookbackMs: 30 * DAY,
};
const JOB_INTERVAL_MS = 15 * MINUTE;
const FULL_PASS_INTERVAL_MS = DAY;
const RECONCILED_STATUSES = ["live", "paused", "completed", "cancelled"];
const WAITING_ON_BRAND = ["new", "awaiting_receipt", "verifying"];

const TITLES = {
  payout_failed: "Payout Transfer Failed",
  withdrawal_stuck: "Withdrawal Stuck In Processing",
  refund_stuck: "Refund Not Completed",
  webhook_failing: "Conversion Webhooks Failing",
  content_deadline_stuck: "Content Deadline Not Processed",
  application_expiry_stuck: "Applications Not Expired",
  reconciliation_mismatch: "Campaign Books Don't Balance",
};

const naira = (amount) => `₦${Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const hoursSince = (date, now) => Math.floor((now.getTime() - new Date(date).getTime()) / HOUR);
const campaignLink = (campaignId) => `/verifications/campaign/${campaignId}`;

function alert({ kind, subjectType, subjectId, campaignId = null, message, link }) {
  return { kind, key: `${kind}:${subjectId}`, subjectType, subjectId: String(subjectId), campaignId: campaignId ? String(campaignId) : null, message, link };
}

async function failedPayouts(now) {
  const failedReferences = await Transaction.distinct("transferReference", {
    type: "release",
    status: "failed",
    updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.failedPayoutLookbackMs) },
    transferReference: { $type: "string" },
  });
  if (failedReferences.length === 0) return [];
  const waiting = await Withdrawal.find({ status: "pending", reference: { $in: failedReferences } })
    .select("amount reference campaignId payoutAttempts adminNotes")
    .lean();
  if (waiting.length === 0) return [];
  // Only when the latest attempt failed outright: every release row of that transfer is failed.
  const stillMoving = new Set(
    await Transaction.distinct("transferReference", {
      type: "release",
      transferReference: { $in: waiting.map((w) => w.reference) },
      status: { $ne: "failed" },
    })
  );
  return waiting
    .filter((w) => !stillMoving.has(w.reference))
    .map((w) => {
      const reason = String(w.adminNotes || "").split(" | ").pop();
      return alert({
        kind: "payout_failed",
        subjectType: "withdrawal",
        subjectId: w._id,
        campaignId: w.campaignId,
        message: `A ${naira(w.amount)} payout failed at Paystack (attempt ${w.payoutAttempts || 1}) and is back in the queue.${reason ? ` ${reason}` : ""}`,
        link: "/withdrawals",
      });
    });
}

async function stuckWithdrawals(now) {
  const cutoff = new Date(now.getTime() - THRESHOLDS.withdrawalProcessingMs);
  const stuck = await Withdrawal.find({
    status: "processing",
    $or: [{ reviewedAt: { $lte: cutoff } }, { reviewedAt: null, updatedAt: { $lte: cutoff } }],
  })
    .select("amount reference campaignId reviewedAt updatedAt")
    .lean();
  return stuck.map((w) =>
    alert({
      kind: "withdrawal_stuck",
      subjectType: "withdrawal",
      subjectId: w._id,
      campaignId: w.campaignId,
      message: `A ${naira(w.amount)} payout (${w.reference || "no transfer reference"}) has been processing for ${hoursSince(w.reviewedAt || w.updatedAt, now)} hours. Check it in Paystack.`,
      link: "/withdrawals",
    })
  );
}

async function stuckRefunds(now) {
  const refunds = await Transaction.find({
    type: "refund",
    status: { $in: ["refund_pending", "refund_failed"] },
    createdAt: { $lte: new Date(now.getTime() - THRESHOLDS.refundMs) },
  })
    .select("campaignId bucket amount status refundParts createdAt")
    .lean();
  return refunds.map((r) => {
    const parts = r.refundParts || [];
    const unsent = parts.some((p) => p.status === "pending" && !p.sentAt && !p.paystackRefundId);
    const state = r.status === "refund_failed" ? "failed" : unsent ? "not sent to Paystack" : "waiting for Paystack";
    const pot = r.bucket === "referral" ? "referral" : r.bucket === "fixed" ? "fixed pay" : "views";
    return alert({
      kind: "refund_stuck",
      subjectType: "transaction",
      subjectId: r._id,
      campaignId: r.campaignId,
      message: `A ${pot} refund of ${naira(r.amount)} is ${state} after ${hoursSince(r.createdAt, now)} hours.`,
      link: campaignLink(r.campaignId),
    });
  });
}

async function failingWebhooks(now) {
  const groups = await WebhookDelivery.aggregate([
    {
      $match: {
        source: "webhook",
        result: "rejected",
        createdAt: { $gt: new Date(now.getTime() - THRESHOLDS.webhookWindowMs), $lte: now },
      },
    },
    { $group: { _id: { businessId: "$businessId", keyId: "$keyId" }, count: { $sum: 1 }, lastError: { $last: "$error" } } },
    { $match: { count: { $gte: THRESHOLDS.webhookRejections } } },
  ]);
  // One alert per brand; a brand with several failing keys lists them.
  const byBrand = new Map();
  for (const group of groups) {
    const key = String(group._id.businessId);
    if (!byBrand.has(key)) byBrand.set(key, []);
    byBrand.get(key).push(group);
  }
  return [...byBrand.entries()].map(([businessId, keys]) => {
    const total = keys.reduce((sum, k) => sum + k.count, 0);
    const detail = keys.map((k) => `${k.keyId || "unknown key"}: ${k.count}${k.lastError ? ` (${k.lastError})` : ""}`).join("; ");
    return alert({
      kind: "webhook_failing",
      subjectType: "business",
      subjectId: businessId,
      message: `${total} rejected conversion webhooks in the last hour. ${detail}`,
      link: "/referrals",
    });
  });
}

async function stuckContentDeadlines(now) {
  const stale = await Submission.aggregate([
    { $match: { status: { $in: WAITING_ON_BRAND }, awaitingBrandSince: { $lte: new Date(now.getTime() - THRESHOLDS.contentDeadlineMs) } } },
    { $group: { _id: { campaignId: "$campaignId", status: "$status" }, count: { $sum: 1 }, oldest: { $min: "$awaitingBrandSince" } } },
  ]);
  if (stale.length === 0) return [];
  const campaigns = new Map(
    (await Campaign.find({ _id: { $in: [...new Set(stale.map((s) => String(s._id.campaignId)))] } })
      .select("name status campaignModel campaignObjective")
      .lean()).map((c) => [String(c._id), c])
  );
  const byCampaign = new Map();
  for (const group of stale) {
    const campaign = campaigns.get(String(group._id.campaignId));
    // The deadline job only handles content campaigns, and never reviews new content on cancelled ones.
    if (!campaign || !isContentCampaign(campaign)) continue;
    if (group._id.status === "new" && campaign.status === "cancelled") continue;
    const entry = byCampaign.get(String(campaign._id)) || { campaign, count: 0, oldest: group.oldest };
    entry.count += group.count;
    if (group.oldest < entry.oldest) entry.oldest = group.oldest;
    byCampaign.set(String(campaign._id), entry);
  }
  return [...byCampaign.values()].map(({ campaign, count, oldest }) =>
    alert({
      kind: "content_deadline_stuck",
      subjectType: "campaign",
      subjectId: campaign._id,
      campaignId: campaign._id,
      message: `${count} submission${count === 1 ? " has" : "s have"} waited on the brand for ${hoursSince(oldest, now)} hours on "${campaign.name}" without being confirmed automatically. The 72-hour deadline job may be stuck.`,
      link: campaignLink(campaign._id),
    })
  );
}

async function stuckApplicationExpiries(now) {
  const stale = await CampaignApplication.aggregate([
    { $match: { status: "pending", appliedAt: { $lte: new Date(now.getTime() - THRESHOLDS.applicationExpiryMs) } } },
    { $group: { _id: "$campaign", count: { $sum: 1 }, oldest: { $min: "$appliedAt" } } },
  ]);
  if (stale.length === 0) return [];
  const names = new Map((await Campaign.find({ _id: { $in: stale.map((s) => s._id) } }).select("name").lean()).map((c) => [String(c._id), c.name]));
  return stale.map((group) =>
    alert({
      kind: "application_expiry_stuck",
      subjectType: "campaign",
      subjectId: group._id,
      campaignId: group._id,
      message: `${group.count} application${group.count === 1 ? " is" : "s are"} still pending ${Math.floor((now.getTime() - group.oldest.getTime()) / DAY)} days after applying on "${names.get(String(group._id)) || "a campaign"}". The 7-day expiry job may be stuck.`,
      link: campaignLink(group._id),
    })
  );
}

// Which campaigns to reconcile: money moved in the last 48 hours, or already flagged (so a fixed
// campaign resolves); every live, paused or recently finished campaign on the full pass.
async function campaignsToReconcile(now, full) {
  const statusFilter = {
    $or: [
      { status: { $in: ["live", "paused"] } },
      { status: { $in: ["completed", "cancelled"] }, updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.finishedCampaignLookbackMs) } },
    ],
  };
  if (full) {
    const withMoney = await Transaction.distinct("campaignId");
    return Campaign.distinct("_id", { _id: { $in: withMoney }, ...statusFilter });
  }
  const [recent, flagged] = await Promise.all([
    Transaction.distinct("campaignId", { updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.recentMoneyMs) } }),
    OpsAlert.distinct("subjectId", { kind: "reconciliation_mismatch", active: true }),
  ]);
  const ids = [...new Set([...recent, ...flagged].map(String))].map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return [];
  return Campaign.distinct("_id", { _id: { $in: ids }, status: { $in: RECONCILED_STATUSES } });
}

async function unbalancedCampaigns(now, full) {
  const ids = await campaignsToReconcile(now, full);
  if (ids.length === 0) return [];
  const results = await reconcileCampaigns(ids, { now });
  return results
    .filter((result) => !result.ok)
    .map((result) =>
      alert({
        kind: "reconciliation_mismatch",
        subjectType: "campaign",
        subjectId: result.campaignId,
        campaignId: result.campaignId,
        message: `"${result.name || "Campaign"}" (${result.status}) doesn't balance: ${result.problems.slice(0, 3).join("; ")}${result.problems.length > 3 ? ` (+${result.problems.length - 3} more)` : ""}`.slice(0, 2000),
        link: campaignLink(result.campaignId),
      })
    );
}

const DETECTORS = [failedPayouts, stuckWithdrawals, stuckRefunds, failingWebhooks, stuckContentDeadlines, stuckApplicationExpiries];

// What's wrong right now. Read-only. `full` reconciles every eligible campaign instead of the recent ones.
async function collectAlerts({ now = new Date(), full = false } = {}) {
  const groups = await Promise.all([...DETECTORS.map((detect) => detect(now)), unbalancedCampaigns(now, full)]);
  return groups.flat();
}

function alertEmail(alerts) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const lines = alerts.map((a) => `${TITLES[a.kind]}: ${a.message}`);
  return {
    subject: `EasilyPromote: ${alerts.length} new ops alert${alerts.length === 1 ? "" : "s"}`,
    text: `${lines.join("\n\n")}\n\nOpen the admin overview to resolve them.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;"><h2 style="color:#111;">${alerts.length} new ops alert${alerts.length === 1 ? "" : "s"}</h2>${alerts
      .map((a) => `<p style="color:#333;font-size:14px;"><strong>${escape(TITLES[a.kind])}</strong><br/>${escape(a.message)}</p>`)
      .join("")}<p style="color:#666;font-size:13px;">Open the admin overview to resolve them.</p></div>`,
  };
}

async function emailAlerts(alerts) {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to || alerts.length === 0) return;
  const { sendEmail } = require("./email");
  const result = await sendEmail({ to: to.split(",").map((s) => s.trim()).filter(Boolean), ...alertEmail(alerts) });
  if (!result.sent) console.error("[OpsAlerts] Alert email not sent:", result.error || result.reason);
}

// Records what collectAlerts found: new alerts once, seen ones touched, cleared ones resolved.
// Emails new alerts without waiting for the email. Returns counts.
async function runOpsAlerts({ now = new Date(), full = false, notify = null } = {}) {
  const current = await collectAlerts({ now, full });
  const currentKeys = new Set(current.map((a) => a.key));
  const created = [];

  for (const found of current) {
    const seen = await OpsAlert.findOneAndUpdate(
      { key: found.key, active: true },
      { $set: { lastSeenAt: now, message: found.message, link: found.link } },
      { new: true }
    ).lean();
    if (seen) continue;
    try {
      const doc = await OpsAlert.create({ ...found, firstSeenAt: now, lastSeenAt: now, active: true });
      created.push(doc.toObject());
    } catch (error) {
      // Another run recorded it at the same moment.
      if (error.code !== 11000) throw error;
    }
  }

  // Scope what can clear: a partial reconciliation pass only speaks for the campaigns it checked,
  // and those always include every flagged one, so every active alert not found now has cleared.
  const active = await OpsAlert.find({ active: true }).select("key resolvedAt").lean();
  const cleared = active.filter((a) => !currentKeys.has(a.key));
  if (cleared.length > 0) {
    const ids = cleared.map((a) => a._id);
    await OpsAlert.updateMany({ _id: { $in: ids }, resolvedAt: null }, { $set: { resolvedAt: now } });
    await OpsAlert.updateMany({ _id: { $in: ids } }, { $set: { active: false, clearedAt: now } });
  }

  const notifier = notify || (process.env.OPS_ALERT_EMAIL ? emailAlerts : null);
  if (notifier && created.length > 0) {
    await OpsAlert.updateMany({ _id: { $in: created.map((a) => a._id) } }, { $set: { emailedAt: now } });
    // Never waits on the email: a slow provider can't hold up the job.
    Promise.resolve()
      .then(() => notifier(created))
      .catch((error) => console.error("[OpsAlerts] Alert email failed:", error.message));
  }

  return { found: current.length, created: created.length, resolved: cleared.length };
}

function alertView(alert) {
  return {
    id: String(alert._id),
    kind: alert.kind,
    title: TITLES[alert.kind] || alert.kind,
    subjectType: alert.subjectType,
    subjectId: String(alert.subjectId),
    campaignId: alert.campaignId ? String(alert.campaignId) : null,
    message: alert.message,
    link: alert.link,
    firstSeenAt: alert.firstSeenAt,
    lastSeenAt: alert.lastSeenAt,
    active: alert.active,
    resolvedAt: alert.resolvedAt,
    resolvedBy: alert.resolvedBy ? String(alert.resolvedBy) : null,
  };
}

function startOpsAlerts() {
  let lastFullAt = 0;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    const now = new Date();
    const full = now.getTime() - lastFullAt >= FULL_PASS_INTERVAL_MS;
    try {
      const summary = await runOpsAlerts({ now, full });
      if (full) lastFullAt = now.getTime();
      if (summary.created || summary.resolved) {
        console.log(`[OpsAlerts] ${summary.found} open, ${summary.created} new, ${summary.resolved} resolved${full ? " (full pass)" : ""}`);
      }
    } catch (error) {
      console.error("[OpsAlerts] Run failed:", error.message);
    } finally {
      running = false;
    }
  };
  run();
  setInterval(run, JOB_INTERVAL_MS);
}

module.exports = { THRESHOLDS, TITLES, collectAlerts, runOpsAlerts, alertView, startOpsAlerts };
