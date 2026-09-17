// Ops alerts (M7): things that went wrong quietly and need a person. collectAlerts reads the
// database and returns what's wrong right now; runOpsAlerts records each alert once (one active
// alert per kind + subject), resolves the ones whose subject was re-checked and is fine now, and
// emails open alerts that haven't been emailed to OPS_ALERT_EMAIL. The job runs every 15 minutes;
// reconciliation checks campaigns with money movement in the last 48 hours plus every flagged
// campaign on each run, and every campaign with money once a day (the full pass, remembered in
// the database so a restart doesn't repeat it).
//
// Kinds and thresholds:
//   payout_failed             a withdrawal back in the queue after its latest transfer failed
//   withdrawal_stuck          a withdrawal in processing for more than 24 hours
//   refund_stuck              a views, referral or fixed refund pending, failed or unsent for more than 1 hour
//   webhook_failing           5+ rejected conversion webhooks for one brand key in the last hour
//   paystack_webhook_failing  3+ Paystack webhooks that failed to process in the last hour
//   content_deadline_stuck    content waiting on the brand more than 72 hours + 1 hour grace (auto job stuck)
//   application_expiry_stuck  applications pending more than 7 days + 2 hours grace (expiry job stuck)
//   views_submission_stuck    views content on a live or paused campaign approved more than 7 days ago, post link never shared
//   reconciliation_mismatch   a campaign whose books don't balance
//   auto_refund_failed        the automatic unused-budget refund couldn't refund an ended campaign
//   social_reconnect_needed   a creator's Instagram / Facebook / TikTok connection needs reconnecting while they
//                             have a post on a live or paused campaign on that platform (views aren't syncing)
//
// An alert only resolves when its subject is re-checked and the condition is gone. An alert an
// admin resolved while the condition lasts reopens (and is emailed again) when the problem
// changes (amount, status, a count roughly doubling, a new failed attempt, a different kind or order of
// magnitude of reconciliation mismatch) or 24 hours after it was resolved.
const Campaign = require("../models/Campaign");
const CampaignApplication = require("../models/CampaignApplication");
const JobState = require("../models/JobState");
const MetaConnection = require("../models/MetaConnection");
const TikTokConnection = require("../models/TikTokConnection");
const OpsAlert = require("../models/OpsAlert");
const PaystackWebhookFailure = require("../models/PaystackWebhookFailure");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const WebhookDelivery = require("../models/WebhookDelivery");
const Withdrawal = require("../models/Withdrawal");
const { reconcileCampaigns } = require("./campaignReconciliation");
const { isContentCampaign } = require("../utils/campaignPay");
const { toObjectId } = require("../utils/objectId");
const { plural } = require("../utils/plural");
const { sendEmail } = require("./email");
const { retryStrandedBackPay } = require("../utils/referralEarnings");
const { accrueAllViewsBonuses, repairVoidedBonuses, viewsBonusSubmissionFilter } = require("../utils/hybridBonus");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const THRESHOLDS = {
  withdrawalProcessingMs: 24 * HOUR,
  refundMs: HOUR,
  failedPayoutLookbackMs: 30 * DAY,
  webhookWindowMs: HOUR,
  webhookRejections: 5,
  paystackWebhookFailures: 3,
  contentDeadlineMs: 72 * HOUR + HOUR,
  applicationExpiryMs: 7 * DAY + 2 * HOUR,
  viewsPostMs: 7 * DAY,
  recentMoneyMs: 48 * HOUR,
  finishedCampaignLookbackMs: 30 * DAY,
  reopenResolvedAfterMs: 24 * HOUR,
};
const JOB_INTERVAL_MS = 15 * MINUTE;
const FULL_PASS_INTERVAL_MS = DAY;
// A send that hasn't finished after this long is tried again.
const EMAIL_RETRY_MS = 10 * MINUTE;
const JOB_NAME = "ops_alerts";
const RECONCILED_STATUSES = ["live", "paused", "completed", "cancelled"];
const WAITING_ON_BRAND = ["new", "awaiting_receipt", "verifying"];
const SYSTEM_SUBJECT_ID = "000000000000000000000000";

const TITLES = {
  payout_failed: "Payout Transfer Failed",
  withdrawal_stuck: "Withdrawal Stuck In Processing",
  refund_stuck: "Refund Not Completed",
  webhook_failing: "Conversion Webhooks Failing",
  paystack_webhook_failing: "Paystack Webhooks Failing",
  content_deadline_stuck: "Content Deadline Not Processed",
  application_expiry_stuck: "Applications Not Expired",
  views_submission_stuck: "Views Posts Not Shared",
  reconciliation_mismatch: "Campaign Books Don't Balance",
  auto_refund_failed: "Automatic Refund Failed",
  social_reconnect_needed: "Creator Must Reconnect Social Account",
};

const naira = (amount) => `₦${Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const hoursSince = (date, now) => Math.floor((now.getTime() - new Date(date).getTime()) / HOUR);
const daysSince = (date, now) => Math.floor((now.getTime() - new Date(date).getTime()) / DAY);
// Opens the campaign's detail on the admin Campaigns page.
const campaignLink = (campaignId) => `/campaigns?open=${campaignId}`;
// Changes when a count roughly doubles, so a steady trickle doesn't reopen an alert every run.
const countBucket = (count) => `~${2 ** Math.floor(Math.log2(Math.max(count, 1)))}`;

// A reconciliation mismatch's stable signature: which checks fail (their wording with amounts, ids
// and counts taken out) and the order of magnitude of the largest discrepancy. Money moving on the
// campaign changes the amounts in the text but not this, so it doesn't reopen a resolved alert.
function mismatchSignature(problems) {
  const kinds = [
    ...new Set(
      problems.map((p) =>
        p
          .replace(/₦-?[\d,]+(\.\d+)?/g, "₦#")
          .replace(/\b[0-9a-f]{24}\b/g, "<id>")
          .replace(/\d+(\.\d+)?/g, "#")
      )
    ),
  ].sort();
  let largest = 0;
  for (const p of problems) {
    const amounts = [...p.matchAll(/₦(-?[\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    if (amounts.length >= 2) largest = Math.max(largest, Math.abs(amounts[0] - amounts[amounts.length - 1]));
  }
  const magnitude = largest > 0 ? `1e${Math.floor(Math.log10(largest))}` : "0";
  return `${kinds.join("|")}#${magnitude}`.slice(0, 1000);
}

function alert({ kind, subjectType, subjectId, campaignId = null, message, link, signature = null }) {
  return {
    kind,
    key: `${kind}:${subjectId}`,
    subjectType,
    subjectId: String(subjectId),
    campaignId: campaignId ? String(campaignId) : null,
    message,
    link,
    signature: signature === null ? null : String(signature),
  };
}

// Every detector returns { alerts, checked }: `checked` is "all" when it looked at every subject that
// could have an active alert of its kind, or the set of keys it re-checked. Only checked alerts
// that weren't found again resolve.
const everything = (alerts) => ({ alerts, checked: "all" });

const activeSubjects = (kind) => OpsAlert.distinct("subjectId", { kind, active: true });

async function failedPayouts(now) {
  const [recentFailures, flagged] = await Promise.all([
    Transaction.distinct("transferReference", {
      type: "release",
      status: "failed",
      updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.failedPayoutLookbackMs) },
      transferReference: { $type: "string" },
    }),
    // Withdrawals already flagged are re-checked however old their failure is.
    activeSubjects("payout_failed"),
  ]);
  if (recentFailures.length === 0 && flagged.length === 0) return everything([]);
  const waiting = await Withdrawal.find({ status: "pending", $or: [{ reference: { $in: recentFailures } }, { _id: { $in: flagged } }] })
    .select("amount reference campaignId payoutAttempts adminNotes")
    .lean();
  const references = waiting.map((w) => w.reference).filter(Boolean);
  if (references.length === 0) return everything([]);
  // Only when the latest attempt failed outright: every release row of that transfer is failed.
  const rows = await Transaction.aggregate([
    { $match: { type: "release", transferReference: { $in: references } } },
    {
      $group: {
        _id: "$transferReference",
        failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        other: { $sum: { $cond: [{ $ne: ["$status", "failed"] }, 1, 0] } },
      },
    },
  ]);
  const failedOutright = new Set(rows.filter((r) => r.failed > 0 && r.other === 0).map((r) => r._id));
  return everything(
    waiting
      .filter((w) => failedOutright.has(w.reference))
      .map((w) => {
        const reason = String(w.adminNotes || "").split(" | ").pop();
        const attempt = w.payoutAttempts || 1;
        return alert({
          kind: "payout_failed",
          subjectType: "withdrawal",
          subjectId: w._id,
          campaignId: w.campaignId,
          message: `A ${naira(w.amount)} payout failed at Paystack (attempt ${attempt}) and is back in the queue.${reason ? ` ${reason}` : ""}`,
          link: "/withdrawals",
          signature: `${w.amount}:${attempt}:${w.reference}`,
        });
      })
  );
}

async function stuckWithdrawals(now) {
  const cutoff = new Date(now.getTime() - THRESHOLDS.withdrawalProcessingMs);
  const stuck = await Withdrawal.find({
    status: "processing",
    $or: [{ reviewedAt: { $lte: cutoff } }, { reviewedAt: null, updatedAt: { $lte: cutoff } }],
  })
    .select("amount reference campaignId reviewedAt updatedAt")
    .lean();
  return everything(
    stuck.map((w) =>
      alert({
        kind: "withdrawal_stuck",
        subjectType: "withdrawal",
        subjectId: w._id,
        campaignId: w.campaignId,
        message: `A ${naira(w.amount)} payout (${w.reference || "no transfer reference"}) has been processing for ${plural(hoursSince(w.reviewedAt || w.updatedAt, now), "hour")}. Check it in Paystack.`,
        link: "/withdrawals",
        signature: `${w.amount}:${w.reference || ""}`,
      })
    )
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
  return everything(
    refunds.map((r) => {
      const parts = r.refundParts || [];
      const unsent = parts.some((p) => p.status === "pending" && !p.sentAt && !p.paystackRefundId);
      const state = r.status === "refund_failed" ? "failed" : unsent ? "not sent to Paystack" : "waiting for Paystack";
      const pot = r.bucket === "referral" ? "referral" : r.bucket === "fixed" ? "fixed pay" : r.bucket === "bonus" ? "bonus pool" : "views";
      return alert({
        kind: "refund_stuck",
        subjectType: "transaction",
        subjectId: r._id,
        campaignId: r.campaignId,
        message: `A ${pot} refund of ${naira(r.amount)} is ${state} after ${plural(hoursSince(r.createdAt, now), "hour")}.`,
        link: campaignLink(r.campaignId),
        signature: `${r.amount}:${state}`,
      });
    })
  );
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
  return everything(
    [...byBrand.entries()].map(([businessId, keys]) => {
      const total = keys.reduce((sum, k) => sum + k.count, 0);
      const detail = keys.map((k) => `${k.keyId || "unknown key"}: ${k.count}${k.lastError ? ` (${k.lastError})` : ""}`).join("; ");
      return alert({
        kind: "webhook_failing",
        subjectType: "business",
        subjectId: businessId,
        message: `${total} rejected conversion webhooks in the last hour. ${detail}`,
        link: "/referrals",
        signature: `${keys.map((k) => k.keyId || "").sort().join(",")}:${countBucket(total)}`,
      });
    })
  );
}

async function failingPaystackWebhooks(now) {
  const recent = await PaystackWebhookFailure.find({ createdAt: { $gt: new Date(now.getTime() - THRESHOLDS.webhookWindowMs), $lte: now } })
    .sort({ createdAt: -1 })
    .lean();
  if (recent.length < THRESHOLDS.paystackWebhookFailures) return everything([]);
  const latest = recent[0];
  return everything([
    alert({
      kind: "paystack_webhook_failing",
      subjectType: "system",
      subjectId: SYSTEM_SUBJECT_ID,
      message: `${recent.length} Paystack webhooks failed to process in the last hour. Paystack retries them, but payments, transfers or refunds may not be recorded. Latest: ${latest.event || "unknown event"}${latest.reference ? ` ${latest.reference}` : ""}: ${latest.error || "no error message"}. Check the API logs.`.slice(0, 2000),
      link: "/payouts",
      signature: countBucket(recent.length),
    }),
  ]);
}

async function stuckContentDeadlines(now) {
  const stale = await Submission.aggregate([
    { $match: { status: { $in: WAITING_ON_BRAND }, awaitingBrandSince: { $lte: new Date(now.getTime() - THRESHOLDS.contentDeadlineMs) } } },
    { $group: { _id: { campaignId: "$campaignId", status: "$status" }, count: { $sum: 1 }, oldest: { $min: "$awaitingBrandSince" } } },
  ]);
  if (stale.length === 0) return everything([]);
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
  return everything(
    [...byCampaign.values()].map(({ campaign, count, oldest }) =>
      alert({
        kind: "content_deadline_stuck",
        subjectType: "campaign",
        subjectId: campaign._id,
        campaignId: campaign._id,
        message: `${plural(count, "submission")} ${count === 1 ? "has" : "have"} waited on the brand for ${plural(hoursSince(oldest, now), "hour")} on "${campaign.name}" without being confirmed automatically. The 72-hour deadline job may be stuck.`,
        link: campaignLink(campaign._id),
        signature: countBucket(count),
      })
    )
  );
}

async function stuckApplicationExpiries(now) {
  const stale = await CampaignApplication.aggregate([
    { $match: { status: "pending", appliedAt: { $lte: new Date(now.getTime() - THRESHOLDS.applicationExpiryMs) } } },
    { $group: { _id: "$campaign", count: { $sum: 1 }, oldest: { $min: "$appliedAt" } } },
  ]);
  if (stale.length === 0) return everything([]);
  const names = new Map((await Campaign.find({ _id: { $in: stale.map((s) => s._id) } }).select("name").lean()).map((c) => [String(c._id), c.name]));
  return everything(
    stale.map((group) =>
      alert({
        kind: "application_expiry_stuck",
        subjectType: "campaign",
        subjectId: group._id,
        campaignId: group._id,
        message: `${plural(group.count, "application")} ${group.count === 1 ? "is" : "are"} still pending ${plural(daysSince(group.oldest, now), "day")} after applying on "${names.get(String(group._id)) || "a campaign"}". The 7-day expiry job may be stuck.`,
        link: campaignLink(group._id),
        signature: countBucket(group.count),
      })
    )
  );
}

// Views content the brand approved whose creator never shared the live post. Submissions have no
// per-post view sync time, so posts that stopped syncing aren't detected here.
async function stuckViewsSubmissions(now) {
  const stale = await Submission.aggregate([
    { $match: { status: "awaiting_post" } },
    { $addFields: { approvedAt: { $ifNull: ["$reviewedAt", "$updatedAt"] } } },
    { $match: { approvedAt: { $lte: new Date(now.getTime() - THRESHOLDS.viewsPostMs) } } },
    { $group: { _id: "$campaignId", count: { $sum: 1 }, oldest: { $min: "$approvedAt" } } },
  ]);
  if (stale.length === 0) return everything([]);
  const campaigns = await Campaign.find({ _id: { $in: stale.map((s) => s._id) } })
    .select("name status campaignModel campaignObjective")
    .lean();
  // Only campaigns still running: a finished campaign's unshared posts no longer cost anyone views.
  const views = new Map(campaigns.filter((c) => !isContentCampaign(c) && ["live", "paused"].includes(c.status)).map((c) => [String(c._id), c]));
  return everything(
    stale
      .filter((group) => views.has(String(group._id)))
      .map((group) => {
        const campaign = views.get(String(group._id));
        return alert({
          kind: "views_submission_stuck",
          subjectType: "campaign",
          subjectId: campaign._id,
          campaignId: campaign._id,
          message: `${plural(group.count, "submission")} on "${campaign.name}" (${campaign.status}) ${group.count === 1 ? "was" : "were"} approved ${plural(daysSince(group.oldest, now), "day")} ago and the creator never shared the live post. Their placements hold views the campaign can't deliver.`,
          link: campaignLink(campaign._id),
          signature: countBucket(group.count),
        });
      })
  );
}

// Which campaigns to reconcile: money moved in the last 48 hours; every live, paused or recently
// finished campaign with money on the full pass; and on every pass, every flagged campaign whatever
// its age or status, so a flag only clears when the campaign is checked again.
async function campaignsToReconcile(now, full) {
  const flagged = await activeSubjects("reconciliation_mismatch");
  let ids;
  if (full) {
    const withMoney = await Transaction.distinct("campaignId");
    ids = await Campaign.distinct("_id", {
      _id: { $in: withMoney },
      $or: [
        { status: { $in: ["live", "paused"] } },
        { status: { $in: ["completed", "cancelled"] }, updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.finishedCampaignLookbackMs) } },
      ],
    });
  } else {
    const recent = await Transaction.distinct("campaignId", { updatedAt: { $gte: new Date(now.getTime() - THRESHOLDS.recentMoneyMs) } });
    ids = recent.length ? await Campaign.distinct("_id", { _id: { $in: recent }, status: { $in: RECONCILED_STATUSES } }) : [];
  }
  return [...new Set([...ids, ...flagged].map(String))].map(toObjectId);
}

async function unbalancedCampaigns(now, full) {
  const ids = await campaignsToReconcile(now, full);
  // A flagged campaign that no longer exists was checked too: there's nothing left to balance.
  const checked = new Set(ids.map((id) => `reconciliation_mismatch:${id}`));
  if (ids.length === 0) return { alerts: [], checked };
  const results = await reconcileCampaigns(ids, { now });
  return {
    checked,
    alerts: results
      .filter((result) => !result.ok)
      .map((result) =>
        alert({
          kind: "reconciliation_mismatch",
          subjectType: "campaign",
          subjectId: result.campaignId,
          campaignId: result.campaignId,
          message: `"${result.name || "Campaign"}" (${result.status}) doesn't balance: ${result.problems.slice(0, 3).join("; ")}${result.problems.length > 3 ? ` (+${result.problems.length - 3} more)` : ""}`.slice(0, 2000),
          link: campaignLink(result.campaignId),
          signature: mismatchSignature(result.problems),
        })
      ),
  };
}

// Ended campaigns the automatic refund job (services/autoRefunds) couldn't refund. The job clears the
// record once a run for that campaign goes through.
async function failedAutoRefunds() {
  const flagged = await Campaign.find({ "autoRefund.error": { $type: "string" } }).select("name status autoRefund").lean();
  return everything(
    flagged.map((campaign) =>
      alert({
        kind: "auto_refund_failed",
        subjectType: "campaign",
        subjectId: campaign._id,
        campaignId: campaign._id,
        message: `The automatic refund of unused budget on "${campaign.name}" (${campaign.status}) didn't go through: ${campaign.autoRefund.error}`.slice(0, 2000),
        link: campaignLink(campaign._id),
        signature: String(campaign.autoRefund.error).replace(/₦-?[\d,]+(\.\d+)?/g, "₦#").slice(0, 500),
      })
    )
  );
}

// D33: creators whose connection needs reconnecting (D32) while a post of theirs on that platform is live:
// posted or verifying, or a verified views-bonus post. One alert per connection (creator + provider);
// it resolves when they reconnect or nothing live is left.
const PROVIDER_LABELS = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
const POST_MATCHERS = {
  instagram: (s) => (s.postedPlatforms || []).some((p) => p.platform === "instagram" || /instagram\.com/i.test(String(p.postUrl || ""))),
  facebook: (s) => (s.postedPlatforms || []).some((p) => p.platform === "facebook" || /facebook\.com|fb\.watch/i.test(String(p.postUrl || ""))),
  tiktok: (s) => Boolean(s.tiktokVideoId) || (s.postedPlatforms || []).some((p) => p.platform === "tiktok" || /tiktok\.com/i.test(String(p.postUrl || ""))),
};

async function socialReconnectNeeded() {
  const [metaFlagged, tiktokFlagged] = await Promise.all([
    MetaConnection.find({ needsReconnect: true }).select("userId provider username needsReconnectAt needsReconnectReason").lean(),
    TikTokConnection.find({ needsReconnect: true }).select("userId username needsReconnectAt needsReconnectReason").lean(),
  ]);
  const flagged = [...metaFlagged, ...tiktokFlagged.map((c) => ({ ...c, provider: "tiktok" }))];
  if (flagged.length === 0) return everything([]);
  const bonusPosts = await viewsBonusSubmissionFilter();
  const submissions = await Submission.find({
    creatorId: { $in: [...new Set(flagged.map((c) => String(c.userId)))].map(toObjectId) },
    $or: [{ status: { $in: ["posted", "verifying"] } }, ...(bonusPosts ? [bonusPosts] : [])],
  })
    .select("creatorId campaignId creatorHandle postedPlatforms tiktokVideoId")
    .lean();
  if (submissions.length === 0) return everything([]);
  const running = new Map(
    (await Campaign.find({ _id: { $in: [...new Set(submissions.map((s) => String(s.campaignId)))] }, status: { $in: ["live", "paused"] } })
      .select("name")
      .lean()).map((c) => [String(c._id), c])
  );
  const alerts = [];
  for (const connection of flagged) {
    const live = submissions.filter(
      (s) => String(s.creatorId) === String(connection.userId) && running.has(String(s.campaignId)) && POST_MATCHERS[connection.provider](s)
    );
    if (live.length === 0) continue;
    const label = PROVIDER_LABELS[connection.provider];
    const campaignIds = [...new Set(live.map((s) => String(s.campaignId)))];
    const names = campaignIds.slice(0, 3).map((id) => `"${running.get(id).name}"`).join(", ");
    const who = connection.username ? `@${String(connection.username).replace(/^@/, "")}` : live[0].creatorHandle || "A creator";
    const since = connection.needsReconnectAt ? new Date(connection.needsReconnectAt).toISOString().slice(0, 10) : "recently";
    alerts.push(
      alert({
        kind: "social_reconnect_needed",
        subjectType: "connection",
        subjectId: connection._id,
        campaignId: campaignIds.length === 1 ? campaignIds[0] : null,
        message: `${who}'s ${label} connection needs reconnecting since ${since}${connection.needsReconnectReason ? ` (${connection.needsReconnectReason})` : ""}. ${plural(live.length, "live post")} on ${names}${campaignIds.length > 3 ? ` and ${campaignIds.length - 3} more` : ""} ${live.length === 1 ? "isn't" : "aren't"} syncing views. Ask the creator to reconnect ${label}.`.slice(0, 2000),
        link: "/users",
        signature: countBucket(live.length),
      })
    );
  }
  return everything(alerts);
}

const DETECTORS = {
  payout_failed: failedPayouts,
  withdrawal_stuck: stuckWithdrawals,
  refund_stuck: stuckRefunds,
  webhook_failing: failingWebhooks,
  paystack_webhook_failing: failingPaystackWebhooks,
  content_deadline_stuck: stuckContentDeadlines,
  application_expiry_stuck: stuckApplicationExpiries,
  views_submission_stuck: stuckViewsSubmissions,
  auto_refund_failed: failedAutoRefunds,
  social_reconnect_needed: socialReconnectNeeded,
};

// { alerts, checked: { kind: "all" | Set of keys } }. Read-only.
async function detect({ now, full }) {
  const kinds = Object.keys(DETECTORS);
  const results = await Promise.all([...kinds.map((kind) => DETECTORS[kind](now)), unbalancedCampaigns(now, full)]);
  const checked = {};
  kinds.forEach((kind, i) => {
    checked[kind] = results[i].checked;
  });
  checked.reconciliation_mismatch = results[results.length - 1].checked;
  return { alerts: results.flatMap((r) => r.alerts), checked };
}

// What's wrong right now. Read-only. `full` reconciles every eligible campaign instead of the recent ones.
async function collectAlerts({ now = new Date(), full = false } = {}) {
  return (await detect({ now, full })).alerts;
}

function alertEmail(alerts) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const label = (a) => `${TITLES[a.kind] || a.kind}${a.reopenedAt ? " (Reopened)" : ""}`;
  const lines = alerts.map((a) => `${label(a)}: ${a.message}`);
  const heading = `${plural(alerts.length, "ops alert")} need${alerts.length === 1 ? "s" : ""} attention`;
  return {
    subject: `EasilyPromote: ${heading}`,
    text: `${lines.join("\n\n")}\n\nOpen the admin overview to resolve them.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;"><h2 style="color:#111;">${escape(heading)}</h2>${alerts
      .map((a) => `<p style="color:#333;font-size:14px;"><strong>${escape(label(a))}</strong><br/>${escape(a.message)}</p>`)
      .join("")}<p style="color:#666;font-size:13px;">Open the admin overview to resolve them.</p></div>`,
  };
}

// Throws when the email wasn't sent, so the alerts stay unemailed and are tried again.
async function emailAlerts(alerts) {
  const to = process.env.OPS_ALERT_EMAIL;
  if (!to || alerts.length === 0) return;
  const result = await sendEmail({ to: to.split(",").map((s) => s.trim()).filter(Boolean), ...alertEmail(alerts) });
  if (!result.sent) throw new Error(`Alert email not sent: ${result.error || result.reason || "unknown reason"}`);
}

// An admin-resolved alert whose condition lasts: reopen when the problem changed or a day has passed.
function shouldReopen(existing, found, now) {
  if (!existing.resolvedAt) return false;
  if (existing.signature !== null && existing.signature !== undefined && found.signature !== null && existing.signature !== found.signature) return true;
  return now.getTime() - new Date(existing.resolvedAt).getTime() >= THRESHOLDS.reopenResolvedAfterMs;
}

// Claims the open alerts nobody has emailed yet (or whose send failed or never finished).
async function claimPendingEmails(now) {
  const due = await OpsAlert.find({
    active: true,
    resolvedAt: null,
    emailedAt: null,
    $or: [{ emailAttemptAt: null }, { emailAttemptAt: { $lte: new Date(now.getTime() - EMAIL_RETRY_MS) } }],
  }).lean();
  const claimed = [];
  for (const candidate of due) {
    const res = await OpsAlert.updateOne(
      { _id: candidate._id, emailedAt: null, emailAttemptAt: candidate.emailAttemptAt || null },
      { $set: { emailAttemptAt: now } }
    );
    if (res.modifiedCount === 1) claimed.push({ ...candidate, emailAttemptAt: now });
  }
  return claimed;
}

// Sends claimed alerts and marks them emailed only once the send succeeded; a failure leaves them
// for the next run. Resolves to how many were emailed; never rejects.
function deliverEmails(notifier, claimed, now) {
  if (claimed.length === 0) return Promise.resolve(0);
  const ids = claimed.map((a) => a._id);
  return Promise.resolve()
    .then(() => notifier(claimed))
    .then(async () => {
      await OpsAlert.updateMany({ _id: { $in: ids }, emailedAt: null }, { $set: { emailedAt: new Date() } });
      return claimed.length;
    })
    .catch(async (error) => {
      console.error("[OpsAlerts] Alert email failed:", error.message);
      await OpsAlert.updateMany({ _id: { $in: ids }, emailedAt: null, emailAttemptAt: now }, { $set: { emailAttemptAt: null } }).catch(() => {});
      return 0;
    });
}

// Records what the detectors found: new alerts once, seen ones touched (reopened when an admin
// resolved them and the problem changed or a day passed), checked-and-gone ones resolved. Starts
// emailing open unemailed alerts without waiting; `emailing` resolves when that's done.
async function runOpsAlerts({ now = new Date(), full = false, notify = null } = {}) {
  const { alerts: current, checked } = await detect({ now, full });
  const currentKeys = new Set(current.map((a) => a.key));
  let created = 0;
  let reopened = 0;

  for (const found of current) {
    const existing = await OpsAlert.findOne({ key: found.key, active: true }).lean();
    if (existing) {
      const touch = { lastSeenAt: now, message: found.message, link: found.link, signature: found.signature };
      if (shouldReopen(existing, found, now)) {
        const res = await OpsAlert.updateOne(
          { _id: existing._id, active: true, resolvedAt: existing.resolvedAt },
          { $set: { ...touch, resolvedAt: null, resolvedBy: null, reopenedAt: now, emailedAt: null, emailAttemptAt: null } }
        );
        if (res.modifiedCount === 1) reopened += 1;
        continue;
      }
      await OpsAlert.updateOne({ _id: existing._id }, { $set: touch });
      continue;
    }
    try {
      await OpsAlert.create({ ...found, firstSeenAt: now, lastSeenAt: now, active: true });
      created += 1;
    } catch (error) {
      // Another run recorded it at the same moment.
      if (error.code !== 11000) throw error;
    }
  }

  // Only alerts whose subject was checked on this run and not found again have cleared.
  const wasChecked = (a) => checked[a.kind] === "all" || (checked[a.kind] instanceof Set && checked[a.kind].has(a.key));
  const active = await OpsAlert.find({ active: true }).select("key kind").lean();
  const cleared = active.filter((a) => !currentKeys.has(a.key) && wasChecked(a));
  if (cleared.length > 0) {
    const ids = cleared.map((a) => a._id);
    await OpsAlert.updateMany({ _id: { $in: ids }, resolvedAt: null }, { $set: { resolvedAt: now } });
    await OpsAlert.updateMany({ _id: { $in: ids } }, { $set: { active: false, clearedAt: now } });
  }

  const notifier = notify || (process.env.OPS_ALERT_EMAIL ? emailAlerts : null);
  // Never waits on the email itself: a slow provider can't hold up the job.
  const emailing = notifier ? deliverEmails(notifier, await claimPendingEmails(now), now) : Promise.resolve(0);

  return { found: current.length, created, reopened, resolved: cleared.length, emailing };
}

// The job's run: a full reconciliation pass when the last one on record is a day old (or there's none).
async function runScheduledOpsAlerts({ now = new Date(), notify = null } = {}) {
  const state = await JobState.findById(JOB_NAME).lean();
  const full = !state || !state.lastFullPassAt || now.getTime() - new Date(state.lastFullPassAt).getTime() >= FULL_PASS_INTERVAL_MS;
  // Referral back-pay stranded by a crash (or never triggered) is retried here first, through the
  // same claim / reserve path, so it never pays twice. A failure can't stop the alerts.
  const backPay = await retryStrandedBackPay(now).catch((error) => {
    console.error("[OpsAlerts] Referral back-pay retry failed:", error.message);
    return { campaigns: 0, paid: 0, error: error.message };
  });
  // Hybrid views bonuses (ticket 10) are accrued here too, so they don't wait on a social sync running,
  // and any reservation a crash left unwritten is settled on the way.
  const viewsBonus = await accrueAllViewsBonuses(now).catch((error) => {
    console.error("[OpsAlerts] Views bonus accrual failed:", error.message);
    return { campaigns: 0, amount: 0, error: error.message };
  });
  // A voided hybrid bonus whose give-back a crash interrupted goes back to its pool here (once).
  const voidedBonuses = await repairVoidedBonuses().catch((error) => {
    console.error("[OpsAlerts] Returning voided bonuses failed:", error.message);
    return 0;
  });
  const summary = { ...(await runOpsAlerts({ now, full, notify })), backPay, viewsBonus, voidedBonuses };
  if (full) {
    try {
      await JobState.updateOne({ _id: JOB_NAME }, { $set: { lastFullPassAt: now } }, { upsert: true });
    } catch (error) {
      // Another instance recorded its full pass at the same moment.
      if (error.code !== 11000) throw error;
    }
  }
  return { ...summary, full };
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
    reopenedAt: alert.reopenedAt || null,
    resolvedAt: alert.resolvedAt,
    resolvedBy: alert.resolvedBy ? String(alert.resolvedBy) : null,
  };
}

function startOpsAlerts() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runScheduledOpsAlerts({ now: new Date() });
      if (summary.created || summary.reopened || summary.resolved) {
        console.log(
          `[OpsAlerts] ${summary.found} open, ${summary.created} new, ${summary.reopened} reopened, ${summary.resolved} resolved${summary.full ? " (full pass)" : ""}`
        );
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

module.exports = { THRESHOLDS, TITLES, collectAlerts, runOpsAlerts, runScheduledOpsAlerts, alertView, alertEmail, startOpsAlerts };
