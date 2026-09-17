// Social connections the provider refuses for good (SPEC D32): an Instagram / Facebook token Meta
// rejects with OAuthException 190 or 102, or a TikTok token that can't be refreshed. The connection is
// flagged `needsReconnect` once; the sync jobs skip it until the creator connects again (the connect
// callbacks clear the flag), and the creator gets one in-app notification when the flag is first set.
const MetaConnection = require("../models/MetaConnection");
const TikTokConnection = require("../models/TikTokConnection");
const Notification = require("../models/Notification");
const { emitToUser } = require("../config/socket");

const LABELS = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

// Short and human; never carries token data.
function metaReason(provider, err) {
  const label = LABELS[provider] || "Meta";
  if (err && err.metaSubcode === 460) return `${label} ended the session (password changed or security check)`;
  if (err && err.metaSubcode === 463) return `The ${label} login expired`;
  if (err && err.metaSubcode === 458) return `The app was removed from the ${label} account`;
  return `${label} no longer accepts the connection`;
}

function tiktokReason(err) {
  if (err && /expired/i.test(String(err.message || ""))) return "The TikTok login expired";
  return "TikTok no longer accepts the connection (expired or revoked)";
}

async function flag(Model, filter, provider, userId, reason, now) {
  const res = await Model.updateOne(
    { ...filter, needsReconnect: { $ne: true } },
    { $set: { needsReconnect: true, needsReconnectAt: now, needsReconnectReason: reason } }
  );
  if (res.modifiedCount !== 1) return false;
  const label = LABELS[provider];
  console.warn(`[Social] ${label} connection for user ${userId} needs reconnecting: ${reason}`);
  try {
    const title = `Reconnect ${label}`;
    const body = `Your ${label} connection expired. Reconnect it so your views keep counting and you keep earning.`;
    const notification = await Notification.create({ creatorId: userId, type: "social_reconnect_needed", title, body });
    emitToUser(userId, "notification", { id: notification._id, type: notification.type, title, body, createdAt: notification.createdAt });
  } catch (error) {
    console.error("[Social] Reconnect notification failed for user", String(userId), error.message);
  }
  return true;
}

// Flags the connection when `err` means the token is dead. Returns true when it did (or already was).
async function handleMetaError(userId, provider, err, now = new Date()) {
  const meta = require("./meta");
  if (!meta.isDeadTokenError(err)) return false;
  await flag(MetaConnection, { userId, provider }, provider, userId, metaReason(provider, err), now);
  return true;
}

async function handleTikTokError(userId, err, now = new Date()) {
  const tiktok = require("./tiktok");
  if (!tiktok.isDeadTokenError(err)) return false;
  await flag(TikTokConnection, { userId }, "tiktok", userId, tiktokReason(err), now);
  return true;
}

// $unset for the connect callbacks.
const CLEAR_RECONNECT = { needsReconnect: 1, needsReconnectAt: 1, needsReconnectReason: 1 };

// The fields the status endpoints return.
function reconnectView(connection) {
  return {
    needsReconnect: Boolean(connection && connection.needsReconnect),
    needsReconnectAt: (connection && connection.needsReconnect && connection.needsReconnectAt) || null,
    needsReconnectReason: (connection && connection.needsReconnect && connection.needsReconnectReason) || null,
  };
}

module.exports = { handleMetaError, handleTikTokError, CLEAR_RECONNECT, reconnectView };
