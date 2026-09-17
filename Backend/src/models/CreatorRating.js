const mongoose = require("mongoose");

// A brand's rating of one creator's work on one campaign (M8, D24). Written once per creator per
// campaign when their placement is complete, editable by the brand for 7 days, hidden (never
// deleted) by admins. Only visible, i.e. not hidden, ratings count towards the creator's average.
const RATING_TAGS = ["on_brief", "on_time", "communication", "content_quality", "would_work_again"];
const COMMENT_MAX = 500;

const creatorRatingSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // The content the rating is for (content campaigns); none for performance campaigns.
    submissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Submission", default: null },
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: COMMENT_MAX, default: "" },
    tags: { type: [{ type: String, enum: RATING_TAGS }], default: [] },
    // The brand can change the rating until then (7 days after it was first given).
    editableUntil: { type: Date, required: true },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    hiddenReason: { type: String, maxlength: 500, default: null },
  },
  { timestamps: true }
);

// Once per creator per campaign, even when two saves race.
creatorRatingSchema.index({ campaignId: 1, creatorId: 1 }, { unique: true });
// A creator's visible ratings (average and count) and the admin list, newest first.
creatorRatingSchema.index({ creatorId: 1, hiddenAt: 1, createdAt: -1 });
// Admin list of all ratings, newest first.
creatorRatingSchema.index({ createdAt: -1 });

module.exports = mongoose.model("CreatorRating", creatorRatingSchema);
module.exports.RATING_TAGS = RATING_TAGS;
module.exports.COMMENT_MAX = COMMENT_MAX;
