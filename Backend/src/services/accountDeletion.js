const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const BusinessProfile = require("../models/BusinessProfile");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const Submission = require("../models/Submission");
const SubmissionEvent = require("../models/SubmissionEvent");
const Notification = require("../models/Notification");
const Withdrawal = require("../models/Withdrawal");
const Transaction = require("../models/Transaction");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");
const tiktok = require("./tiktok");
const { decrypt } = require("../utils/crypto");

// Work that has not produced views yet — releasing these costs the brand nothing.
const UNDELIVERED_SLOT_STATUSES = ["reserved", "claimed", "submitted"];
// Work already delivered stays attached to the campaign; the brand got the views.
const ACTIVE_SLOT_STATUSES = ["claimed", "submitted", "verifying", "approved"];
const ACTIVE_CAMPAIGN_STATUSES = ["pending_payment", "under_review", "live", "paused"];

// Deleting an account must always be possible. The only hard stop is a transfer
// already moving at Paystack, which would break settlement if the records
// vanished mid-flight — and that resolves itself within half an hour via
// reconciliation. Everything else is handled as part of the deletion.
async function deletionBlockers(user) {
  const blockers = [];

  const inFlight = await Withdrawal.countDocuments({
    creatorId: user._id,
    status: "processing",
  });
  if (inFlight > 0) {
    blockers.push(
      "A payout is currently being sent to your bank. Once it lands — usually within an hour — you can delete your account."
    );
  }

  if (user.role === "business") {
    const activeCampaigns = await Campaign.countDocuments({
      businessId: user._id,
      status: { $in: ACTIVE_CAMPAIGN_STATUSES },
    });
    if (activeCampaigns > 0) {
      blockers.push(
        `You have ${activeCampaigns} active campaign${activeCampaigns === 1 ? "" : "s"}. Cancel them first so creators are released and your escrow is refunded.`
      );
    }
  }

  return blockers;
}

// What the user gives up by deleting. Shown before they confirm — these do not
// prevent deletion, they just should not come as a surprise.
async function deletionWarnings(user) {
  const warnings = [];
  if (user.role !== "creator") return warnings;

  const activeSlots = await Slot.countDocuments({
    creatorId: user._id,
    status: { $in: ACTIVE_SLOT_STATUSES },
  });
  if (activeSlots > 0) {
    warnings.push(
      `You'll drop ${activeSlots} campaign${activeSlots === 1 ? "" : "s"} you're working on, and they'll be offered to other creators.`
    );
  }

  const pending = await Withdrawal.find({ creatorId: user._id, status: "pending" });
  const pendingTotal = pending.reduce((sum, w) => sum + (w.amount || 0), 0);
  if (pendingTotal > 0) {
    warnings.push(
      `Your withdrawal request for ₦${pendingTotal.toLocaleString()} will be cancelled and cannot be reinstated.`
    );
  }

  return warnings;
}

async function disconnectSocials(userId) {
  const tiktokConnection = await TikTokConnection.findOne({ userId }).select("+accessTokenEnc");
  if (tiktokConnection) {
    try {
      const token = decrypt(tiktokConnection.accessTokenEnc);
      if (token) await tiktok.revokeAccess(token).catch(() => {});
    } catch {
      // Best effort: a token we cannot revoke still gets deleted below.
    }
  }
  await TikTokConnection.deleteMany({ userId });
  await MetaConnection.deleteMany({ userId });
}

// Financial and campaign records are kept — a brand paid for that work and the
// books have to survive — but they are stripped of anything identifying.
async function anonymizeRecords(user) {
  const anonymousHandle = "deleted_creator";

  await Submission.updateMany({ creatorId: user._id }, { $set: { creatorHandle: anonymousHandle } });
  await SubmissionEvent.updateMany({ creatorId: user._id }, { $set: { actorName: anonymousHandle } });

  const submissionIds = await Submission.distinct("_id", { creatorId: user._id });
  if (submissionIds.length > 0) {
    await Transaction.updateMany(
      { submissionId: { $in: submissionIds } },
      { $set: { creatorHandle: anonymousHandle } }
    );
  }

  await Withdrawal.updateMany(
    { creatorId: user._id },
    { $set: { adminNotes: "Account deleted by user" } }
  );
}

async function deleteAccount(user) {
  const blockers = await deletionBlockers(user);
  if (blockers.length > 0) return { deleted: false, blockers };

  await disconnectSocials(user._id);
  await anonymizeRecords(user);

  // A pending request is a claim on money that nobody can now pay out to, since
  // the payout account goes with the account.
  await Withdrawal.updateMany(
    { creatorId: user._id, status: "pending" },
    { $set: { status: "rejected", adminNotes: "Cancelled — creator deleted their account" } }
  );

  // Release work that produced nothing so the slot can be refilled. Slots that
  // already delivered views stay put: the brand paid for those and got them.
  await Slot.updateMany(
    { creatorId: user._id, status: { $in: UNDELIVERED_SLOT_STATUSES } },
    { $set: { creatorId: null, status: "available", claimedAt: null, submissionUrl: null } }
  );

  await Notification.deleteMany({ $or: [{ creatorId: user._id }, { businessId: user._id }] });
  await CreatorProfile.deleteOne({ userId: user._id });
  await BusinessProfile.deleteOne({ userId: user._id });
  await User.deleteOne({ _id: user._id });

  console.log("[Account] Deleted account", String(user._id), "| role:", user.role);
  return { deleted: true, blockers: [] };
}

module.exports = { deleteAccount, deletionBlockers, deletionWarnings };
