const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const CreatorProfile = require("../models/CreatorProfile");
const MetaConnection = require("../models/MetaConnection");
const { protect, authorizeRoles } = require("../middleware/auth");
const meta = require("../services/meta");
const { encrypt } = require("../utils/crypto");

const router = express.Router();

const STATE_SECRET = () => process.env.META_STATE_SECRET || process.env.JWT_SECRET;

function getFrontendReturnUrl() {
  return process.env.META_FRONTEND_RETURN_URL || "http://localhost:3001";
}

function getAllowedReturnOrigins() {
  return (
    process.env.CLIENT_URL ||
    "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function normalizeReturnTo(returnTo) {
  if (typeof returnTo !== "string" || !returnTo) return null;
  const allowed = getAllowedReturnOrigins();
  const ok = allowed.some(
    (origin) => returnTo === origin || returnTo.startsWith(origin + "/") || returnTo.startsWith(origin + "?")
  );
  return ok ? returnTo : null;
}

function redirectToFrontend(res, result, returnTo, provider) {
  const base = normalizeReturnTo(returnTo) || getFrontendReturnUrl();
  const separator = base.includes("?") ? "&" : "?";
  const suffix = provider ? `&meta_provider=${provider}` : "";
  res.redirect(`${base}${separator}meta=${result}${suffix}`);
}

// Upsert the generic socialAccounts entry on the creator profile.
async function upsertSocialAccount(userId, platform, handle) {
  const profile = await CreatorProfile.findOne({ userId });
  if (!profile) return;
  const social = profile.socialAccounts.find((s) => s.platform === platform);
  if (social) {
    social.handle = handle;
    social.verified = true;
  } else {
    profile.socialAccounts.push({ platform, handle, verified: true });
  }
  await profile.save();
}

// ---------------------------------------------------------------------------
// Connect — returns the provider authorize URL for the browser to redirect to.
// ---------------------------------------------------------------------------
router.post("/connect/:provider", protect, authorizeRoles("creator"), (req, res) => {
  const { provider } = req.params;
  if (!meta.isValidProvider(provider)) {
    return res.status(400).json({ error: "Unsupported provider" });
  }
  const { returnTo } = req.body || {};
  const state = jwt.sign(
    { id: req.user._id, provider, returnTo: normalizeReturnTo(returnTo) },
    STATE_SECRET(),
    { expiresIn: "10m" }
  );
  const url = meta.generateAuthUrl(provider, state);
  console.log("[Meta] Connect requested", provider, "for user", req.user._id, "| redirect_uri=", meta.getRedirectUri(provider));
  res.json({ url });
});

// ---------------------------------------------------------------------------
// Callback — Meta redirects the browser here after the user authorizes.
// ---------------------------------------------------------------------------
router.get("/callback/:provider", async (req, res) => {
  const { provider } = req.params;
  const { code, state, error, error_description: errorDescription } = req.query;

  console.log("[Meta] Callback received", provider, {
    hasCode: !!code,
    hasState: !!state,
    error: error || null,
    errorDescription: errorDescription || null,
  });

  const fail = (returnTo) => redirectToFrontend(res, "error", returnTo, provider);

  if (!meta.isValidProvider(provider)) return fail();
  if (error) {
    console.error("[Meta] Callback error:", error, errorDescription);
    return fail();
  }
  if (!code || !state) return fail();

  let decoded;
  try {
    decoded = jwt.verify(state, STATE_SECRET());
  } catch {
    console.error("[Meta] Invalid state");
    return fail();
  }
  if (!decoded || !decoded.id || decoded.provider !== provider) {
    return fail();
  }

  try {
    if (provider === "instagram") {
      await handleInstagramConnect(decoded.id, code);
    } else {
      await handleFacebookConnect(decoded.id, code);
    }
    console.log("[Meta] Connection saved", provider, "for user", decoded.id);
    redirectToFrontend(res, "connected", decoded.returnTo, provider);
  } catch (err) {
    console.error("[Meta] Callback failed:", provider, err.message);
    redirectToFrontend(res, "error", decoded.returnTo, provider);
  }
});

async function handleInstagramConnect(userId, code) {
  const short = await meta.exchangeInstagramCode(code);
  const long = await meta.getInstagramLongLivedToken(short.access_token);
  const profile = await meta.getInstagramProfile(long.access_token);

  const providerUserId = String(profile.user_id || short.user_id);
  const scopes = Array.isArray(short.permissions)
    ? short.permissions
    : String(short.permissions || "").split(",").map((s) => s.trim()).filter(Boolean);

  const update = {
    providerUserId,
    username: profile.username,
    displayName: profile.username,
    avatarUrl: profile.profile_picture_url,
    accessTokenEnc: encrypt(long.access_token),
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
    scopes,
    connectedAt: new Date(),
  };

  await MetaConnection.findOneAndUpdate(
    { userId, provider: "instagram" },
    { $set: update, $setOnInsert: { userId, provider: "instagram" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await upsertSocialAccount(userId, "instagram", profile.username ? `@${profile.username}` : `@${providerUserId}`);
}

async function handleFacebookConnect(userId, code) {
  const short = await meta.exchangeFacebookCode(code);
  const long = await meta.getFacebookLongLivedToken(short.access_token);
  const profile = await meta.getFacebookProfile(long.access_token);

  let pages = [];
  try {
    pages = await meta.getFacebookPages(long.access_token);
  } catch (err) {
    console.warn("[Meta] Could not list FB pages:", err.message);
  }

  const providerUserId = String(profile.id);
  const update = {
    providerUserId,
    username: profile.name,
    displayName: profile.name,
    avatarUrl: profile.picture?.data?.url,
    accessTokenEnc: encrypt(long.access_token),
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined,
    scopes: meta.getScopes("facebook"),
    pages: pages.map((p) => ({
      pageId: p.id,
      name: p.name,
      accessTokenEnc: encrypt(p.access_token),
      igBusinessId: p.instagram_business_account?.id,
    })),
    connectedAt: new Date(),
  };

  await MetaConnection.findOneAndUpdate(
    { userId, provider: "facebook" },
    { $set: update, $setOnInsert: { userId, provider: "facebook" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await upsertSocialAccount(userId, "facebook", profile.name || providerUserId);
}

// ---------------------------------------------------------------------------
// Status — connection state for both providers.
// ---------------------------------------------------------------------------
router.get("/status", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const connections = await MetaConnection.find({ userId: req.user._id });
    const byProvider = {};
    for (const c of connections) {
      byProvider[c.provider] = {
        connected: true,
        username: c.username,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        scopes: c.scopes,
        expiresAt: c.expiresAt,
        connectedAt: c.connectedAt,
        pages: (c.pages || []).map((p) => ({ pageId: p.pageId, name: p.name, igBusinessId: p.igBusinessId })),
      };
    }
    res.json({
      instagram: byProvider.instagram || { connected: false },
      facebook: byProvider.facebook || { connected: false },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Disconnect — remove a provider connection.
// ---------------------------------------------------------------------------
router.post("/disconnect/:provider", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!meta.isValidProvider(provider)) {
      return res.status(400).json({ error: "Unsupported provider" });
    }
    await MetaConnection.deleteOne({ userId: req.user._id, provider });

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (profile) {
      profile.socialAccounts = profile.socialAccounts.filter((s) => s.platform !== provider);
      await profile.save();
    }

    res.json({ message: `${provider} disconnected` });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Media — list connected Instagram media (used to link submissions / debug).
// ---------------------------------------------------------------------------
router.get("/instagram/media", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const accessToken = await meta.getValidAccessToken(req.user._id, "instagram");
    const media = await meta.getInstagramMedia(accessToken);
    res.json({ media });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Sync — trigger a metrics sync (admins + the creator themselves).
// ---------------------------------------------------------------------------
router.post("/sync", protect, authorizeRoles("admin", "super_admin", "creator"), async (req, res, next) => {
  try {
    const { syncMetaViews } = require("../utils/syncMetaViews");
    await syncMetaViews();
    res.json({ success: true, message: "Meta sync completed" });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Signed-request helpers — Meta signs deauthorize / data-deletion callbacks
// with the app secret (format: "<base64url sig>.<base64url json payload>").
// ---------------------------------------------------------------------------
function base64UrlDecode(input) {
  const s = String(input).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}

function parseSignedRequest(signedRequest, appSecret) {
  if (!signedRequest || typeof signedRequest !== "string" || !signedRequest.includes(".") || !appSecret) {
    return null;
  }
  const [encodedSig, payload] = signedRequest.split(".", 2);
  let data;
  try {
    data = JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", appSecret).update(payload).digest();
  const actual = base64UrlDecode(encodedSig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  return data;
}

// The callback may come from either the Instagram or Facebook app, so try both secrets.
function verifySignedRequest(signedRequest) {
  for (const secret of [process.env.INSTAGRAM_APP_SECRET, process.env.FACEBOOK_APP_SECRET]) {
    const data = parseSignedRequest(signedRequest, secret);
    if (data) return data;
  }
  return null;
}

// Remove every trace of a Meta user: their connection(s) + the profile badge.
async function purgeMetaUser(providerUserId) {
  const connections = await MetaConnection.find({ providerUserId: String(providerUserId) });
  for (const c of connections) {
    await CreatorProfile.updateOne(
      { userId: c.userId },
      { $pull: { socialAccounts: { platform: c.provider } } }
    );
  }
  await MetaConnection.deleteMany({ providerUserId: String(providerUserId) });
  return connections.length;
}

// Deauthorize callback — Meta calls this when a user removes the app from their settings.
router.post("/deauthorize", async (req, res) => {
  const data = verifySignedRequest(req.body?.signed_request);
  if (!data || !data.user_id) {
    return res.status(400).json({ error: "Invalid signed_request" });
  }
  try {
    const removed = await purgeMetaUser(data.user_id);
    console.log("[Meta] Deauthorize for user", data.user_id, "| removed connections:", removed);
    res.json({ success: true });
  } catch (err) {
    console.error("[Meta] Deauthorize failed:", err.message);
    res.status(500).json({ error: "Deauthorize failed" });
  }
});

// Data deletion request (GDPR) — delete the user's data and return a status URL + code.
router.post("/data-deletion", async (req, res) => {
  const data = verifySignedRequest(req.body?.signed_request);
  if (!data || !data.user_id) {
    return res.status(400).json({ error: "Invalid signed_request" });
  }
  try {
    await purgeMetaUser(data.user_id);
  } catch (err) {
    console.error("[Meta] Data deletion failed:", err.message);
  }
  const confirmationCode = crypto
    .createHash("sha256")
    .update(String(data.user_id) + (process.env.META_STATE_SECRET || ""))
    .digest("hex")
    .slice(0, 16);
  const base = `https://${req.get("host")}`;
  console.log("[Meta] Data deletion for user", data.user_id, "| code:", confirmationCode);
  res.json({
    url: `${base}/api/meta/data-deletion/status?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

// Human-readable status page the data-deletion `url` points to.
router.get("/data-deletion/status", (req, res) => {
  const code = String(req.query.code || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
  res.status(200).send(
    `<!doctype html><html><head><meta charset="utf-8"><title>Data deletion</title></head>` +
      `<body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:0 16px">` +
      `<h1>Data deletion completed</h1>` +
      `<p>All Instagram and Facebook data connected to EasilyPromote for this account has been deleted.</p>` +
      (code ? `<p>Confirmation code: <code>${code}</code></p>` : "") +
      `</body></html>`
  );
});

module.exports = router;
