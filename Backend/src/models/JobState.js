const mongoose = require("mongoose");

// What a background job needs to remember across restarts, one document per job (_id is the
// job's name), e.g. when the ops alerts job last ran its daily full reconciliation pass.
const jobStateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    lastFullPassAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JobState", jobStateSchema);
