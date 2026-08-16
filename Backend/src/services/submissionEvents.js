const SubmissionEvent = require("../models/SubmissionEvent");

const EVENT_LABELS = {
  submitted: "Content submitted",
  resubmitted: "Content resubmitted",
  content_edited: "Content edited",
  approved: "Content approved",
  rejected: "Changes requested",
  posted: "Posted on socials",
  views_synced: "Views updated",
  appealed: "Appeal submitted",
  appeal_approved: "Appeal approved",
  appeal_rejected: "Appeal rejected",
  paid: "Payout released",
};

function labelFor(type) {
  return EVENT_LABELS[type] || type;
}

// Never let an audit write break the request that triggered it — the event log is
// a record of what happened, not a precondition for it happening.
async function recordEvent(submission, { type, actor, actorId, actorName, reason, metadata }) {
  try {
    if (!submission) return null;
    return await SubmissionEvent.create({
      submissionId: submission._id,
      campaignId: submission.campaignId,
      creatorId: submission.creatorId,
      type,
      actor,
      actorId: actorId || null,
      actorName: actorName || null,
      statusAfter: submission.status || null,
      reason: reason || null,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error("[Events] Failed to record", type, "for submission", String(submission?._id), error.message);
    return null;
  }
}

async function listEventsForCampaign(campaignId) {
  return SubmissionEvent.find({ campaignId })
    .sort({ createdAt: -1 })
    .populate("creatorId", "name email")
    .populate("actorId", "name email");
}

async function listEventsForSubmissions(submissionIds) {
  return SubmissionEvent.find({ submissionId: { $in: submissionIds } }).sort({ createdAt: 1 });
}

module.exports = {
  EVENT_LABELS,
  labelFor,
  recordEvent,
  listEventsForCampaign,
  listEventsForSubmissions,
};
