const MetaConnection = require("../models/MetaConnection");
const { encrypt, decrypt } = require("../utils/crypto");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

// Instagram API with Instagram Login (direct professional-account login).
const IG_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const IG_GRAPH = "https://graph.instagram.com";

// Facebook Login + Graph API (Pages).
const FB_GRAPH = "https://graph.facebook.com";
function fbAuthUrl() {
  return `https://www.facebook.com/${graphVersion()}/dialog/oauth`;
}

const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000; // refresh IG long-lived token when < 7 days left

function getInstagramConfig() {
  const clientId = process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET must be set");
  }
  return { clientId, clientSecret };
}

function getFacebookConfig() {
  const clientId = process.env.FACEBOOK_APP_ID;
  const clientSecret = process.env.FACEBOOK_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set");
  }
  return { clientId, clientSecret };
}

function getRedirectUri(provider) {
  const uri =
    provider === "instagram"
      ? process.env.INSTAGRAM_REDIRECT_URI
      : process.env.FACEBOOK_REDIRECT_URI;
  if (!uri) {
    throw new Error(`Redirect URI for ${provider} is not set`);
  }
  return uri;
}

function getScopes(provider) {
  const raw =
    provider === "instagram"
      ? process.env.INSTAGRAM_SCOPES || "instagram_business_basic,instagram_business_manage_insights"
      : process.env.FACEBOOK_SCOPES ||
        "public_profile,pages_show_list,pages_read_engagement,read_insights,business_management";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Whether this deployment has credentials for a provider at all. Lets the UI
// hide a connect button that could only ever fail.
function isProviderConfigured(provider) {
  if (provider === "instagram") {
    return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  }
  if (provider === "facebook") {
    return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  }
  return false;
}

function isValidProvider(provider) {
  return provider === "instagram" || provider === "facebook";
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function graphRequest(url, { method = "GET", body, headers } = {}) {
  const res = await fetch(url, { method, body, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error?.message || json.error_message || `Meta API error ${res.status}`;
    console.error("[Meta API] FAILED", method, url.split("?")[0].replace("https://", ""), res.status, JSON.stringify(json.error || json));
    throw new Error(msg);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Authorization URLs
// ---------------------------------------------------------------------------

function generateAuthUrl(provider, state) {
  if (provider === "instagram") {
    const { clientId } = getInstagramConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getRedirectUri("instagram"),
      response_type: "code",
      scope: getScopes("instagram").join(","),
      state,
    });
    return `${IG_AUTH_URL}?${params.toString()}`;
  }
  const { clientId } = getFacebookConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri("facebook"),
    response_type: "code",
    scope: getScopes("facebook").join(","),
    state,
  });
  return `${fbAuthUrl()}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Instagram token exchange
// ---------------------------------------------------------------------------

async function exchangeInstagramCode(code) {
  const { clientId, clientSecret } = getInstagramConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: getRedirectUri("instagram"),
    code,
  }).toString();
  // Short-lived token (~1h) + user_id + permissions.
  const json = await graphRequest(IG_TOKEN_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  console.log("[Meta API] IG code exchange OK | user_id=", json.user_id ? "yes" : "no");
  return json; // { access_token, user_id, permissions }
}

async function getInstagramLongLivedToken(shortLivedToken) {
  const { clientSecret } = getInstagramConfig();
  const params = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: clientSecret,
    access_token: shortLivedToken,
  });
  const json = await graphRequest(`${IG_GRAPH}/access_token?${params.toString()}`);
  console.log("[Meta API] IG long-lived token OK | expires_in=", json.expires_in);
  return json; // { access_token, token_type, expires_in }
}

async function refreshInstagramToken(longLivedToken) {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: longLivedToken,
  });
  const json = await graphRequest(`${IG_GRAPH}/refresh_access_token?${params.toString()}`);
  console.log("[Meta API] IG token refreshed OK | expires_in=", json.expires_in);
  return json; // { access_token, token_type, expires_in }
}

async function getInstagramProfile(accessToken) {
  const params = new URLSearchParams({
    fields: "user_id,username,account_type,profile_picture_url",
    access_token: accessToken,
  });
  const json = await graphRequest(`${IG_GRAPH}/${graphVersion()}/me?${params.toString()}`);
  return json; // { user_id, username, account_type, profile_picture_url }
}

// ---------------------------------------------------------------------------
// Facebook token exchange
// ---------------------------------------------------------------------------

async function exchangeFacebookCode(code) {
  const { clientId, clientSecret } = getFacebookConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri("facebook"),
    code,
  });
  const json = await graphRequest(`${FB_GRAPH}/${graphVersion()}/oauth/access_token?${params.toString()}`);
  console.log("[Meta API] FB code exchange OK | access_token=", json.access_token ? "yes" : "no");
  return json; // { access_token, token_type, expires_in }
}

async function getFacebookLongLivedToken(shortLivedToken) {
  const { clientId, clientSecret } = getFacebookConfig();
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: shortLivedToken,
  });
  const json = await graphRequest(`${FB_GRAPH}/${graphVersion()}/oauth/access_token?${params.toString()}`);
  console.log("[Meta API] FB long-lived token OK | expires_in=", json.expires_in);
  return json; // { access_token, token_type, expires_in }
}

async function getFacebookProfile(accessToken) {
  const params = new URLSearchParams({
    fields: "id,name,picture",
    access_token: accessToken,
  });
  const json = await graphRequest(`${FB_GRAPH}/${graphVersion()}/me?${params.toString()}`);
  return json; // { id, name, picture: { data: { url } } }
}

// Pages the user manages, with per-page tokens and any linked IG business account.
async function getFacebookPages(userAccessToken) {
  const params = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account",
    access_token: userAccessToken,
  });
  const json = await graphRequest(`${FB_GRAPH}/${graphVersion()}/me/accounts?${params.toString()}`);
  const pages = json.data || [];
  console.log("[Meta API] FB pages OK | count=", pages.length);
  return pages;
}

// ---------------------------------------------------------------------------
// Media / insights
// ---------------------------------------------------------------------------

// Instagram media list for the connected professional account.
async function getInstagramMedia(accessToken, { limit = 25 } = {}) {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
    limit: String(limit),
    access_token: accessToken,
  });
  const json = await graphRequest(`${IG_GRAPH}/${graphVersion()}/me/media?${params.toString()}`);
  return json.data || [];
}

// Insights for a single Instagram media object. Returns a flat metrics map.
async function getInstagramMediaInsights(mediaId, accessToken) {
  // `views` covers reels/video plays; reach/likes/comments/saved/shares apply broadly.
  const metric = "reach,likes,comments,saved,shares,views";
  const params = new URLSearchParams({ metric, access_token: accessToken });
  try {
    const json = await graphRequest(
      `${IG_GRAPH}/${graphVersion()}/${mediaId}/insights?${params.toString()}`
    );
    return normalizeInsights(json.data);
  } catch (err) {
    // Some media types reject certain metrics; retry with the safe subset.
    const safe = new URLSearchParams({ metric: "reach,likes,comments", access_token: accessToken });
    const json = await graphRequest(
      `${IG_GRAPH}/${graphVersion()}/${mediaId}/insights?${safe.toString()}`
    );
    return normalizeInsights(json.data);
  }
}

// Facebook video insights (total views) for a video owned by a page.
async function getFacebookVideoInsights(videoId, pageAccessToken) {
  const params = new URLSearchParams({
    metric: "total_video_views",
    access_token: pageAccessToken,
  });
  const json = await graphRequest(
    `${FB_GRAPH}/${graphVersion()}/${videoId}/video_insights?${params.toString()}`
  );
  return normalizeInsights(json.data);
}

// Combined views + like/comment counts for a Facebook video.
async function getFacebookVideoStats(videoId, pageAccessToken) {
  const insights = await getFacebookVideoInsights(videoId, pageAccessToken).catch(() => ({}));
  const params = new URLSearchParams({
    fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)",
    access_token: pageAccessToken,
  });
  let engagement = {};
  try {
    engagement = await graphRequest(`${FB_GRAPH}/${graphVersion()}/${videoId}?${params.toString()}`);
  } catch (err) {
    console.warn("[Meta API] FB video engagement fetch failed for", videoId, err.message);
  }
  return {
    views: insights.total_video_views || 0,
    likes: engagement.likes?.summary?.total_count || 0,
    comments: engagement.comments?.summary?.total_count || 0,
  };
}

// Turn Graph "insights" data arrays into a flat { metric: value } map.
function normalizeInsights(data) {
  const out = {};
  for (const item of data || []) {
    const name = item.name;
    let value = 0;
    if (Array.isArray(item.values) && item.values.length > 0) {
      value = item.values[item.values.length - 1].value || 0;
    } else if (typeof item.total_value?.value === "number") {
      value = item.total_value.value;
    }
    out[name] = typeof value === "number" ? value : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function getConnection(userId, provider) {
  return MetaConnection.findOne({ userId, provider }).select("+accessTokenEnc +pages.accessTokenEnc");
}

// Store a long-lived token + expiry on a connection document (does not save()).
function applyToken(connection, token, expiresInSeconds) {
  connection.accessTokenEnc = encrypt(token);
  if (expiresInSeconds) {
    connection.expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  }
}

async function getValidAccessToken(userId, provider) {
  const connection = await getConnection(userId, provider);
  if (!connection) {
    throw new Error(`${provider} is not connected`);
  }
  const accessToken = decrypt(connection.accessTokenEnc);
  if (!accessToken) {
    throw new Error(`${provider} access token is missing`);
  }

  // Instagram long-lived tokens can be refreshed; Facebook long-lived tokens cannot
  // (the user must reconnect), and its page tokens don't expire.
  if (
    provider === "instagram" &&
    connection.expiresAt &&
    connection.expiresAt.getTime() < Date.now() + REFRESH_BEFORE_MS
  ) {
    try {
      const refreshed = await refreshInstagramToken(accessToken);
      applyToken(connection, refreshed.access_token, refreshed.expires_in);
      await connection.save();
      return refreshed.access_token;
    } catch (err) {
      console.error("[Meta] IG token refresh failed:", err.message);
    }
  }

  return accessToken;
}

module.exports = {
  graphVersion,
  isValidProvider,
  isProviderConfigured,
  getScopes,
  getRedirectUri,
  generateAuthUrl,
  // Instagram
  exchangeInstagramCode,
  getInstagramLongLivedToken,
  refreshInstagramToken,
  getInstagramProfile,
  getInstagramMedia,
  getInstagramMediaInsights,
  // Facebook
  exchangeFacebookCode,
  getFacebookLongLivedToken,
  getFacebookProfile,
  getFacebookPages,
  getFacebookVideoInsights,
  getFacebookVideoStats,
  // Persistence
  getConnection,
  applyToken,
  getValidAccessToken,
};
