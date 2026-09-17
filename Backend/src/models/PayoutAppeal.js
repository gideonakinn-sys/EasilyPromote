const mongoose = require("mongoose");

// A creator's appeal against a payout decision (D23): a rejected withdrawal, or fixed pay voided because
// approved content was never delivered. One appeal per decision, filed within 7 days of it; admins
// deny it with a note, or grant it (finance / super admin, because granting moves money: the withdrawal
// goes back in the payout queue, or the voided pay is restored). Services: services/payoutAppeals.js.
const payoutAppealSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    // withdrawal: a rejected Withdrawal. fixed_void: a Submission whose fixed pay was voided (not delivered).
    subjectType: { type: String, enum: ["withdrawal", "fixed_void"], required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // What the decision took away: the withdrawal's amount, or the fixed pay voided (0 when none was credited yet).
    amount: { type: Number, default: 0 },
    // Why the payout was rejected or voided, as the creator saw it.
    decisionReason: { type: String, default: null, maxlength: 2000 },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    // open → granted / denied. "resolving" while a grant is being carried out; a grant interrupted by a
    // crash is taken over once it's 5 minutes old.
    status: { type: String, enum: ["open", "resolving", "granted", "denied"], default: "open" },
    resolvingAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null, maxlength: 1000 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedByName: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    // What a grant did, e.g. { withdrawalStatus: "pending" } or { restoredAmount }.
    outcome: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

// One appeal per decision, even when two requests race.
payoutAppealSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });
// Admin appeals inbox: by status, newest first.
payoutAppealSchema.index({ status: 1, createdAt: -1 });
// Creator: their own appeals.
payoutAppealSchema.index({ creatorId: 1, createdAt: -1 });

module.exports = mongoose.model("PayoutAppeal", payoutAppealSchema);
