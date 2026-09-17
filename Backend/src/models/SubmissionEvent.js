const mongoose = require("mongoose");

const EVENT_TYPES = [
  "submitted",
  "resubmitted",
  "content_edited",
  "approved",
  "rejected",
  "posted",
  "views_synced",
  "appealed",
  "appeal_approved",
  "appeal_rejected",
  "paid",
  // Campaign engine: content approval (ticket 07)
  "changes_requested",
  "delivery_shared",
  "receipt_confirmed",
  "post_verified",
  "post_disputed",
  "fixed_pay_due",
  "completed",
  "fixed_pay_voided",
  // D35: the live post was published before the content was approved; its views aren't counted.
  "post_predates_campaign",
];

const submissionEventSchema = new mongoose.Schema(
  {
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: EVENT_TYPES,
      required: true,
    },
    actor: {
      type: String,
      enum: ["creator", "brand", "admin", "system"],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: {
      type: String,
      default: null,
    },
    // Status the submission moved into, so the feed reads correctly even if the
    // event vocabulary changes later.
    statusAfter: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

submissionEventSchema.index({ campaignId: 1, createdAt: -1 });
submissionEventSchema.index({ submissionId: 1, createdAt: 1 });
// Admin appeals inbox: decided content appeals, newest first.
submissionEventSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("SubmissionEvent", submissionEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
