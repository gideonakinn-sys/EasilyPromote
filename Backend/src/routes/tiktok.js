const express = require("express");
const jwt = require("jsonwebtoken");
const CreatorProfile = require("../models/CreatorProfile");
const Submission = require("../models/Submission");
const { protect, authorizeRoles } = require("../middleware/auth");
const tiktok = require("../services/tiktok");
const { decrypt } = require("../utils/crypto");
const TikTokConnection = require("../models/TikTokConnection");

const router = express.Router();

const STATE_SECRET = () => process.env.TIKTOK_STATE_SECRET || process.env.JWT_SECRET;

function getFrontendReturnUrl() {
  return process.env.TIKTOK_FRONTEND_RETURN_URL || "http://localhost:3001";
}

function getAllowedReturnOrigins() {
  return (process.env.CLIENT_URL || "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003")
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

function redirectToFrontend(res, result, returnTo) {
  const base = normalizeReturnTo(returnTo) || getFrontendReturnUrl();
  const separator = base.includes("?") ? "&" : "?";
  res.redirect(`${base}${separator}tiktok=${result}`);
}

function extractTikTokVideoId(url) {
  if (!url) return null;
  const match = String(url).match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  return match ? match[1] : null;
}

router.post("/connect", protect, authorizeRoles("creator"), (req, res) => {
  const { returnTo } = req.body || {};
  const { codeVerifier, codeChallenge } = tiktok.generatePkce();
  const state = jwt.sign(
    { id: req.user._id, returnTo: normalizeReturnTo(returnTo), codeVerifier },
    STATE_SECRET(),
    { expiresIn: "10m" }
  );
  const url = tiktok.generateAuthUrl(state, codeChallenge);
  console.log("[TikTok] Connect requested for user", req.user._id, "| redirect_uri=", tiktok.getRedirectUri());
  res.json({ url });
});

router.get("/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  console.log("[TikTok] Callback received", {
    hasCode: !!code,
    codeLength: code ? code.length : 0,
    hasState: !!state,
    stateLength: state ? state.length : 0,
    error: error || null,
    errorDescription: errorDescription || null,
    queryKeys: Object.keys(req.query),
  });

  const fail = (returnTo) => redirectToFrontend(res, "error", returnTo);

  if (error) {
    console.error("[TikTok] Callback error:", error, errorDescription);
    return fail();
  }
  if (!code || !state) {
    return fail();
  }

  let decoded;
  try {
    decoded = jwt.verify(state, STATE_SECRET());
  } catch {
    console.error("[TikTok] Invalid state");
    return fail();
  }
  if (!decoded || !decoded.id) {
    return fail();
  }
  console.log("[TikTok] State valid for user", decoded.id, "| hasCodeVerifier=", !!decoded.codeVerifier);

  try {
    const tokens = await tiktok.exchangeCode(code, decoded.codeVerifier);
    console.log("[TikTok] Token exchange OK | open_id=", tokens.open_id, "| scopes=", tokens.scope);

    const userInfo = await tiktok.getUserInfo(tokens.access_token, [
      "open_id",
      "display_name",
      "username",
      "avatar_url",
    ]);
    console.log("[TikTok] User info fetched | username=", userInfo.username, "| display_name=", userInfo.display_name);

    const existing = await TikTokConnection.findOne({ userId: decoded.id });
    if (existing) {
      existing.openId = tokens.open_id || existing.openId;
      existing.username = userInfo.username || existing.username;
      existing.displayName = userInfo.display_name || existing.displayName;
      existing.avatarUrl = userInfo.avatar_url || existing.avatarUrl;
      await tiktok.saveTokens(existing, tokens);
    } else {
      const connection = new TikTokConnection({
        userId: decoded.id,
        openId: tokens.open_id || userInfo.open_id,
        username: userInfo.username,
        displayName: userInfo.display_name,
        avatarUrl: userInfo.avatar_url,
        connectedAt: new Date(),
      });
      await tiktok.saveTokens(connection, tokens);
    }
    console.log("[TikTok] Connection saved for user", decoded.id);

    const profile = await CreatorProfile.findOne({ userId: decoded.id });
    if (profile) {
      const handle = userInfo.username || userInfo.display_name || `@${userInfo.open_id}`;
      const social = profile.socialAccounts.find((s) => s.platform === "tiktok");
      if (social) {
        social.handle = handle;
        social.verified = true;
      } else {
        profile.socialAccounts.push({ platform: "tiktok", handle, verified: true });
      }
      await profile.save();
    }

    console.log("[TikTok] Redirecting to frontend with connected | returnTo=", decoded.returnTo || "(default)");
    redirectToFrontend(res, "connected", decoded.returnTo);
  } catch (err) {
    console.error("[TikTok] Callback failed:", err.message);
    redirectToFrontend(res, "error", decoded.returnTo);
  }
});

router.get("/status", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const connection = await TikTokConnection.findOne({ userId: req.user._id });
    if (!connection) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      openId: connection.openId,
      username: connection.username,
      displayName: connection.displayName,
      avatarUrl: connection.avatarUrl,
      scopes: connection.scopes,
      expiresAt: connection.expiresAt,
      connectedAt: connection.connectedAt,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/disconnect", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const connection = await TikTokConnection.findOne({ userId: req.user._id }).select("+accessTokenEnc");
    if (connection) {
      try {
        const accessToken = connection.accessTokenEnc;
        if (accessToken) {
          const plain = decrypt(accessToken);
          if (plain) {
            await tiktok.revokeAccess(plain).catch(() => {});
          }
        }
      } catch {
        // Best-effort revocation
      }
      await TikTokConnection.deleteOne({ _id: connection._id });
    }

    const profile = await CreatorProfile.findOne({ userId: req.user._id });
    if (profile) {
      profile.socialAccounts = profile.socialAccounts.filter((s) => s.platform !== "tiktok");
      await profile.save();
    }

    res.json({ message: "TikTok disconnected" });
  } catch (error) {
    next(error);
  }
});

router.get("/videos", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const accessToken = await tiktok.getValidAccessToken(req.user._id);
    const cursor = parseInt(req.query.cursor || "0", 10);
    const data = await tiktok.listVideos(accessToken, { cursor });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/videos/:videoId/metrics", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const accessToken = await tiktok.getValidAccessToken(req.user._id);
    const videos = await tiktok.queryVideos(accessToken, [req.params.videoId]);
    const video = videos.find((v) => String(v.id) === String(req.params.videoId)) || null;
    if (!video) {
      return res.status(404).json({ error: "Video not found or not owned by this user" });
    }
    res.json(video);
  } catch (error) {
    next(error);
  }
});

router.post("/videos/:videoId/link-submission", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const { submissionId } = req.body;
    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const submission = await Submission.findOne({ _id: submissionId, creatorId: req.user._id });
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const videoId = req.params.videoId || extractTikTokVideoId(submission.postedPlatforms?.find((p) => p.platform === "tiktok")?.postUrl);
    submission.tiktokVideoId = videoId || null;
    await submission.save();

    res.json({ tiktokVideoId: submission.tiktokVideoId });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
