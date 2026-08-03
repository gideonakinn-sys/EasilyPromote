const crypto = require("crypto");
const TikTokConnection = require("../models/TikTokConnection");
const { encrypt, decrypt } = require("../utils/crypto");

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const VIDEO_LIST_URL = "https://open.tiktokapis.com/v2/video/list/";
const VIDEO_QUERY_URL = "https://open.tiktokapis.com/v2/video/query/";

const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const QUERY_BATCH_SIZE = 20;

function hasTikTokError(json) {
  const code = json?.error?.code;
  return Boolean(code) && code !== "ok" && code !== 0;
}

function getConfig() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set");
  }
  return { clientKey, clientSecret };
}

function getRedirectUri() {
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("TIKTOK_REDIRECT_URI must be set");
  }
  return redirectUri;
}

function getScopes() {
  return (process.env.TIKTOK_SCOPES || "user.info.basic,user.info.profile,video.list")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function generateAuthUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    client_key: getConfig().clientKey,
    response_type: "code",
    scope: getScopes().join(","),
    redirect_uri: getRedirectUri(),
    state,
  });
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return `${AUTH_URL}?${params.toString()}`;
}

function base64UrlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generatePkce() {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

async function postForm(url, fields) {
  const body = new URLSearchParams(fields).toString();
  console.log("[TikTok API] POST", url.replace("https://", ""), "grant_type=", fields.grant_type);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.error && json.error.code !== 0 && json.error.message)) {
    console.error("[TikTok API] FAILED", res.status, JSON.stringify(json));
    throw new Error(json.error?.message || json.message || `TikTok API error ${res.status}`);
  }
  console.log(
    "[TikTok API] OK",
    res.status,
    "keys=",
    Object.keys(json).join(","),
    "| open_id=",
    json.open_id ? "yes" : "no",
    "| access_token=",
    json.access_token ? "yes" : "no",
    "| refresh_token=",
    json.refresh_token ? "yes" : "no"
  );
  return json;
}

async function exchangeCode(code, codeVerifier) {
  const { clientKey, clientSecret } = getConfig();
  const fields = {
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getRedirectUri(),
  };
  if (codeVerifier) {
    fields.code_verifier = codeVerifier;
  }
  return postForm(TOKEN_URL, fields);
}

async function refreshAccessToken(refreshToken) {
  const { clientKey, clientSecret } = getConfig();
  return postForm(TOKEN_URL, {
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

async function revokeAccess(accessToken) {
  const { clientKey, clientSecret } = getConfig();
  return postForm(REVOKE_URL, {
    client_key: clientKey,
    client_secret: clientSecret,
    token: accessToken,
  });
}

async function getUserInfo(accessToken, fields) {
  const params = new URLSearchParams({ fields: fields.join(",") });
  const res = await fetch(`${USER_INFO_URL}?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || hasTikTokError(json)) {
    console.error("[TikTok API] user/info FAILED", res.status, JSON.stringify(json));
    throw new Error(json.error?.message || `TikTok API error ${res.status}`);
  }
  console.log("[TikTok API] user/info OK", res.status, "user=", json.data?.user ? "yes" : "no");
  return json.data.user || {};
}

async function listVideos(accessToken, { cursor = 0, maxCount = 20 } = {}) {
  const params = new URLSearchParams({
    fields: "id,title,create_time,duration,view_count,like_count,comment_count,share_count",
  });
  const res = await fetch(`${VIDEO_LIST_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ max_count: maxCount, cursor }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || hasTikTokError(json)) {
    console.error("[TikTok API] video/list FAILED", res.status, JSON.stringify(json));
    throw new Error(json.error?.message || `TikTok API error ${res.status}`);
  }
  console.log("[TikTok API] video/list OK", res.status, "videos=", json.data?.videos?.length || 0);
  return json.data;
}

async function queryVideos(accessToken, videoIds, fields) {
  const safeFields = fields || [
    "id",
    "title",
    "create_time",
    "duration",
    "view_count",
    "like_count",
    "comment_count",
    "share_count",
  ];
  const params = new URLSearchParams({ fields: safeFields.join(",") });
  const res = await fetch(`${VIDEO_QUERY_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filters: { video_ids: videoIds.slice(0, QUERY_BATCH_SIZE) } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || hasTikTokError(json)) {
    console.error("[TikTok API] video/query FAILED", res.status, JSON.stringify(json));
    throw new Error(json.error?.message || `TikTok API error ${res.status}`);
  }
  console.log("[TikTok API] video/query OK", res.status, "videos=", json.data?.videos?.length || 0);
  return json.data.videos || [];
}

async function getConnection(userId) {
  return TikTokConnection.findOne({ userId }).select("+accessTokenEnc +refreshTokenEnc");
}

async function saveTokens(connection, tokens) {
  const now = Date.now();
  if (tokens.access_token) {
    connection.accessTokenEnc = encrypt(tokens.access_token);
    connection.expiresAt = new Date(now + (tokens.expires_in || 86400) * 1000);
  }
  if (tokens.refresh_token) {
    connection.refreshTokenEnc = encrypt(tokens.refresh_token);
    connection.refreshExpiresAt = new Date(now + (tokens.refresh_expires_in || 31536000) * 1000);
  }
  if (tokens.scope) {
    connection.scopes = tokens.scope.split(",").map((s) => s.trim()).filter(Boolean);
  }
  await connection.save();
}

async function getValidAccessToken(userId) {
  const connection = await getConnection(userId);
  if (!connection) {
    throw new Error("TikTok is not connected");
  }

  const accessToken = decrypt(connection.accessTokenEnc);
  const refreshToken = decrypt(connection.refreshTokenEnc);

  if (connection.expiresAt && connection.expiresAt.getTime() > Date.now() + REFRESH_BEFORE_MS && accessToken) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error("TikTok refresh token is missing");
  }

  const refreshed = await refreshAccessToken(refreshToken);
  await saveTokens(connection, refreshed);
  return decrypt(connection.accessTokenEnc);
}

module.exports = {
  AUTH_URL,
  QUERY_BATCH_SIZE,
  generateAuthUrl,
  generatePkce,
  getRedirectUri,
  exchangeCode,
  refreshAccessToken,
  revokeAccess,
  getUserInfo,
  listVideos,
  queryVideos,
  getConnection,
  getValidAccessToken,
  saveTokens,
};
