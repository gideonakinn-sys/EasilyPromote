// A creator's request to take part in an Application Required campaign (ticket 06).
// Creator Approval lives here and never on a Submission (ADR 0002).
const mongoose = require("mongoose");

const APPLICATION_STATUSES = ["pending", "approved", "rejected", "withdrawn", "expired"];
const MAX_PITCH_LENGTH = 500;

const campaignApplicationSchema = new mongoose.Schema(
  {
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: "pending" },
    pitch: { type: String, trim: true, maxlength: MAX_PITCH_LENGTH, default: "" },
    // Brand-safe profile frozen at apply time; later profile edits don't change it.
    applicantSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    // Match Score against the campaign's targeting when the creator applied.
    matchScore: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, trim: true, default: "" },
    // Set when the brand was reminded about this pending application (day 3, once).
    remindedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One application per creator per campaign; withdrawn or expired ones are reopened.
campaignApplicationSchema.index({ campaign: 1, creator: 1 }, { unique: true });
campaignApplicationSchema.index({ campaign: 1, status: 1, matchScore: -1 });
campaignApplicationSchema.index({ status: 1, appliedAt: 1 });

const CampaignApplication = mongoose.model("CampaignApplication", campaignApplicationSchema);

module.exports = CampaignApplication;
module.exports.APPLICATION_STATUSES = APPLICATION_STATUSES;
module.exports.MAX_PITCH_LENGTH = MAX_PITCH_LENGTH;
