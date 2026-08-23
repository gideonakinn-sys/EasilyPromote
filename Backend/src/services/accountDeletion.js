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

const ACTIVE_SLOT_STATUSES = ["claimed", "submitted", "verifying", "approved"];
const OPEN_WITHDRAWAL_STATUSES = ["pending", "processing"];
const ACTIVE_CAMPAIGN_STATUSES = ["pending_payment", "under_review", "live", "paused"];

// Reasons an account cannot simply disappear. Money in flight and work a brand
// has already paid for both need resolving by a human first.
async function deletionBlockers(user) {
  const blockers = [];

  const openWithdrawals = await Withdrawal.countDocuments({
    creatorId: user._id,
    status: { $in: OPEN_WITHDRAWAL_STATUSES },
  });
  if (openWithdrawals > 0) {
    blockers.push(
      "You have a withdrawal being processed. Wait for it to complete before deleting your account."
    );
  }

  if (user.role === "creator") {
    const activeSlots = await Slot.countDocuments({
      creatorId: user._id,
      status: { $in: ACTIVE_SLOT_STATUSES },
    });
    if (activeSlots > 0) {
      blockers.push(
        `You have ${activeSlots} campaign${activeSlots === 1 ? "" : "s"} in progress. Finish or drop them first.`
      );
    }
  }

  if (user.role === "business") {
    const activeCampaigns = await Campaign.countDocuments({
      businessId: user._id,
      status: { $in: ACTIVE_CAMPAIGN_STATUSES },
    });
    if (activeCampaigns > 0) {
      blockers.push(
        `You have ${activeCampaigns} active campaign${activeCampaigns === 1 ? "" : "s"}. Creators may be working on them — cancel or complete them first.`
      );
    }
  }

  return blockers;
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
    { creatorId: user._id, status: { $nin: OPEN_WITHDRAWAL_STATUSES } },
    { $set: { adminNotes: "Account deleted by user" } }
  );
}

async function deleteAccount(user) {
  const blockers = await deletionBlockers(user);
  if (blockers.length > 0) return { deleted: false, blockers };

  await disconnectSocials(user._id);
  await anonymizeRecords(user);

  // Release any slot still held so the campaign can be filled by someone else.
  await Slot.updateMany(
    { creatorId: user._id, status: { $in: ["reserved", "claimed"] } },
    { $set: { creatorId: null, status: "available", claimedAt: null } }
  );

  await Notification.deleteMany({ $or: [{ creatorId: user._id }, { businessId: user._id }] });
  await CreatorProfile.deleteOne({ userId: user._id });
  await BusinessProfile.deleteOne({ userId: user._id });
  await User.deleteOne({ _id: user._id });

  console.log("[Account] Deleted account", String(user._id), "| role:", user.role);
  return { deleted: true, blockers: [] };
}

module.exports = { deleteAccount, deletionBlockers };
