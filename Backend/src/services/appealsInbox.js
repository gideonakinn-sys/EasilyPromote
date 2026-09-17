// The admin appeals inbox (D23): content appeals (a brand's rejection of content, decided through
// PATCH /api/admin/submissions/:id/appeal) and payout appeals (a rejected withdrawal or voided pay,
// services/payoutAppeals.js) in one list, filtered by kind, status, campaign and a search. Read-only.
const mongoose = require("mongoose");
const Campaign = require("../models/Campaign");
const PayoutAppeal = require("../models/PayoutAppeal");
const Submission = require("../models/Submission");
const SubmissionEvent = require("../models/SubmissionEvent");
const User = require("../models/User");

const MAX_ROWS = 300;

async function namesFor({ campaignIds, userIds }) {
  const [campaigns, users] = await Promise.all([
    Campaign.find({ _id: { $in: [...new Set(campaignIds.map(String))] } }).select("name status").lean(),
    User.find({ _id: { $in: [...new Set(userIds.filter(Boolean).map(String))] } }).select("name email").lean(),
  ]);
  return {
    campaign: new Map(campaigns.map((c) => [String(c._id), c])),
    user: new Map(users.map((u) => [String(u._id), u.name || u.email])),
  };
}

async function contentAppeals({ status, campaignId }) {
  const scope = campaignId ? { campaignId } : {};
  const items = [];
  if (status !== "resolved") {
    const open = await Submission.find({ status: "appealed", ...scope }).sort({ updatedAt: -1 }).limit(MAX_ROWS).lean();
    const appealedAt = new Map(
      (
        await SubmissionEvent.aggregate([
          { $match: { submissionId: { $in: open.map((s) => s._id) }, type: "appealed" } },
          { $group: { _id: "$submissionId", at: { $max: "$createdAt" } } },
        ])
      ).map((e) => [String(e._id), e.at])
    );
    for (const s of open) {
      items.push({ submission: s, status: "open", createdAt: appealedAt.get(String(s._id)) || s.updatedAt, decision: null });
    }
  }
  if (status !== "open") {
    const decisions = await SubmissionEvent.find({ type: { $in: ["appeal_approved", "appeal_rejected"] }, ...scope }).sort({ createdAt: -1 }).limit(MAX_ROWS).lean();
    const submissions = new Map((await Submission.find({ _id: { $in: decisions.map((d) => d.submissionId) } }).lean()).map((s) => [String(s._id), s]));
    const appealedAt = new Map(
      (
        await SubmissionEvent.aggregate([
          { $match: { submissionId: { $in: decisions.map((d) => d.submissionId) }, type: "appealed" } },
          { $group: { _id: "$submissionId", at: { $max: "$createdAt" } } },
        ])
      ).map((e) => [String(e._id), e.at])
    );
    for (const d of decisions) {
      const s = submissions.get(String(d.submissionId));
      if (!s) continue;
      items.push({ submission: s, status: d.type === "appeal_approved" ? "granted" : "denied", createdAt: appealedAt.get(String(s._id)) || d.createdAt, decision: d });
    }
  }
  return items.map(({ submission: s, status: itemStatus, createdAt, decision }) => ({
    key: `content:${s._id}`,
    kind: "content",
    id: s._id,
    subjectType: "content",
    status: itemStatus,
    campaignId: s.campaignId,
    creatorId: s.creatorId,
    creatorHandle: s.creatorHandle || null,
    amount: null,
    reason: s.appealReason || null,
    decisionReason: s.rejectionReason || null,
    videoUrl: s.videoUrl || null,
    caption: s.caption || null,
    createdAt,
    resolvedAt: decision ? decision.createdAt : null,
    resolutionNote: decision ? decision.reason || null : null,
    resolvedByName: decision ? decision.actorName || null : null,
    resolving: false,
    moneyMoving: false,
  }));
}

async function payoutAppeals({ status, campaignId }) {
  const filter = {};
  if (status === "open") filter.status = { $in: ["open", "resolving"] };
  else if (status === "resolved") filter.status = { $in: ["granted", "denied"] };
  if (campaignId) filter.campaignId = campaignId;
  const appeals = await PayoutAppeal.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean();
  return appeals.map((a) => ({
    key: `payout:${a._id}`,
    kind: "payout",
    id: a._id,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    status: a.status === "resolving" ? "open" : a.status,
    campaignId: a.campaignId,
    creatorId: a.creatorId,
    creatorHandle: null,
    amount: a.amount,
    reason: a.reason,
    decisionReason: a.decisionReason || null,
    videoUrl: null,
    caption: null,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt,
    resolutionNote: a.resolutionNote,
    resolvedByName: a.resolvedByName,
    resolving: a.status === "resolving",
    // Granting puts money back in a creator's hands: finance or super admin only.
    moneyMoving: true,
    outcome: a.outcome || null,
  }));
}

// { appeals, counts: { content, payout } } newest first. kind: all | content | payout; status: open |
// resolved | all; q matches the creator, campaign or reason.
async function listAppeals({ kind = "all", status = "open", q = "", campaignId = null, limit = 100 } = {}) {
  const wantedStatus = ["open", "resolved", "all"].includes(status) ? status : "open";
  const scope = campaignId && mongoose.isValidObjectId(campaignId) ? new mongoose.Types.ObjectId(String(campaignId)) : null;
  const [content, payout, openContent, openPayout] = await Promise.all([
    kind === "payout" ? [] : contentAppeals({ status: wantedStatus, campaignId: scope }),
    kind === "content" ? [] : payoutAppeals({ status: wantedStatus, campaignId: scope }),
    Submission.countDocuments({ status: "appealed" }),
    PayoutAppeal.countDocuments({ status: { $in: ["open", "resolving"] } }),
  ]);
  const rows = [...content, ...payout];
  const names = await namesFor({ campaignIds: rows.map((r) => r.campaignId), userIds: rows.map((r) => r.creatorId) });
  const needle = String(q || "").trim().toLowerCase();
  const appeals = rows
    .map((r) => {
      const campaign = names.campaign.get(String(r.campaignId));
      return {
        ...r,
        campaignName: campaign ? campaign.name : "Campaign",
        campaignStatus: campaign ? campaign.status : null,
        creatorName: names.user.get(String(r.creatorId)) || r.creatorHandle || "Creator",
      };
    })
    .filter((r) => !needle || [r.creatorName, r.creatorHandle, r.campaignName, r.reason].some((v) => v && String(v).toLowerCase().includes(needle)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), MAX_ROWS));
  return { appeals, counts: { content: openContent, payout: openPayout } };
}

module.exports = { listAppeals };
