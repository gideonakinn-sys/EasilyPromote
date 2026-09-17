const CreatorProfile = require("../models/CreatorProfile");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");

// A verified creator must have at least one connected social account (D13).
async function hasConnectedSocial(userId) {
  const [tiktok, meta] = await Promise.all([TikTokConnection.exists({ userId }), MetaConnection.exists({ userId })]);
  return Boolean(tiktok || meta);
}

// Run after a social account is disconnected: the badge goes with the last connection.
async function dropVerificationIfUnconnected(userId) {
  if (await hasConnectedSocial(userId)) return;
  await CreatorProfile.updateOne(
    { userId, verifiedAt: { $ne: null } },
    { $set: { verifiedAt: null, verifiedBy: null } }
  );
}

module.exports = { hasConnectedSocial, dropVerificationIfUnconnected };
