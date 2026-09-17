const mongoose = require("mongoose");

// A running total of views gained per campaign per UTC day, written each time a
// platform sync moves a submission's view count. Feeds the brand dashboard's
// monthly view series and per-campaign rankings without a heavyweight log.
const viewSnapshotSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Submission",
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// One row per campaign per day; deltas accumulate into it.
viewSnapshotSchema.index({ campaignId: 1, date: 1 }, { unique: true });
// Brand-level queries across a date range.
viewSnapshotSchema.index({ businessId: 1, date: 1 });
viewSnapshotSchema.index({ date: 1 });

module.exports = mongoose.model("ViewSnapshot", viewSnapshotSchema);