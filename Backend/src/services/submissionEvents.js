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
  // Campaign engine: content approval (ticket 07)
  changes_requested: "Changes requested",
  delivery_shared: "Download link shared",
  receipt_confirmed: "Brand confirmed receipt",
  post_verified: "Live post verified",
  post_disputed: "Brand couldn't verify the post",
  fixed_pay_due: "Fixed pay due",
  completed: "Completed",
  fixed_pay_voided: "Fixed pay voided: not delivered",
};

// Content campaigns reject for good (appealable); views campaigns treat a rejection as a
// request for changes, which is what the label above says.
function contentLabelFor(type, metadata) {
  if (type === "approved" && metadata && metadata.auto) return "Approved automatically";
  if (type === "rejected") return "Content rejected";
  return EVENT_LABELS[type] || type;
}

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
  contentLabelFor,
  recordEvent,
  listEventsForCampaign,
  listEventsForSubmissions,
};
