// Follower counts read from a connected platform (Instagram's followers_count) replace the
// self-reported number on the creator profile; campaigns' follower minimums read that field.
const CreatorProfile = require("../models/CreatorProfile");
const MetaConnection = require("../models/MetaConnection");
const meta = require("../services/meta");

const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;

async function setPlatformFollowers(userId, platform, followers, now = new Date()) {
  if (!Number.isInteger(followers) || followers < 0) return false;
  const profile = await CreatorProfile.findOne({ userId });
  if (!profile) return false;
  const account = profile.socialAccounts.find((a) => a.platform === platform);
  if (!account) return false;
  account.followers = followers;
  account.followersSource = "api";
  account.followersSyncedAt = now;
  await profile.save();
  return true;
}

// Once a day per connected Instagram account, whether or not the creator has posts to sync.
async function refreshInstagramFollowers(connections, now = new Date()) {
  for (const connection of connections) {
    if (connection.provider !== "instagram") continue;
    if (connection.needsReconnect) continue; // D32: waits for the creator to reconnect
    if (connection.followersSyncedAt && now - connection.followersSyncedAt < REFRESH_EVERY_MS) continue;
    try {
      const token = await meta.getValidAccessToken(connection.userId, "instagram");
      const profile = await meta.getInstagramProfile(token);
      await setPlatformFollowers(connection.userId, "instagram", profile.followers_count, now);
      await MetaConnection.updateOne({ _id: connection._id }, { $set: { followersSyncedAt: now } });
    } catch (error) {
      if (await require("../services/socialReconnect").handleMetaError(connection.userId, "instagram", error)) continue;
      console.warn(`[Meta Sync] Followers not refreshed for user ${connection.userId}:`, error.message);
    }
  }
}

module.exports = { setPlatformFollowers, refreshInstagramFollowers };
