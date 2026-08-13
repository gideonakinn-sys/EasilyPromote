const Submission = require("../models/Submission");
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const MetaConnection = require("../models/MetaConnection");
const meta = require("../services/meta");
const { decrypt } = require("../utils/crypto");
const { emitCampaignUpdate } = require("./campaignUpdates");

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// URL parsing helpers
// ---------------------------------------------------------------------------

function isInstagramUrl(url) {
  return /instagram\.com/i.test(String(url || ""));
}

function isFacebookUrl(url) {
  return /facebook\.com|fb\.watch/i.test(String(url || ""));
}

// The shortcode in /p/<code>/, /reel/<code>/, /tv/<code>/ — matched against media permalinks.
function extractInstagramShortcode(url) {
  const m = String(url || "").match(
    /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i
  );
  return m ? m[1] : null;
}

function extractFacebookVideoId(url) {
  const s = String(url || "");
  let m = s.match(/[?&]v=(\d+)/i);
  if (m) return m[1];
  m = s.match(/\/videos\/(?:[^/]+\/)?(\d+)/i);
  if (m) return m[1];
  m = s.match(/\/reel\/(\d+)/i);
  if (m) return m[1];
  return null;
}

// ---------------------------------------------------------------------------
// Campaign rollup (mirrors the TikTok sync)
// ---------------------------------------------------------------------------

async function updateCampaignFromSubmission(submission) {
  const campaign = await Campaign.findById(submission.campaignId);
  if (!campaign) return;

  const totalViews = await Submission.aggregate([
    { $match: { campaignId: campaign._id, status: { $in: ["posted", "verifying"] } } },
    { $group: { _id: null, total: { $sum: "$viewsDelivered" } } },
  ]);
  campaign.viewsDelivered = totalViews.length > 0 ? totalViews[0].total : 0;

  if (campaign.viewsDelivered >= campaign.targetViews && campaign.status === "live") {
    campaign.status = "completed";
    await Notification.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      type: "completed",
      title: "Completed",
      body: "Campaign hit its target — that's a wrap.",
    });
  }

  await campaign.save();
}

// ---------------------------------------------------------------------------
// Per-provider metric fetching
// ---------------------------------------------------------------------------

// Returns a { shortcode -> media } map for the connected IG account, or null.
async function buildInstagramMediaMap(userId) {
  try {
    const accessToken = await meta.getValidAccessToken(userId, "instagram");
    const media = await meta.getInstagramMedia(accessToken, { limit: 50 });
    const map = new Map();
    for (const item of media) {
      const code = extractInstagramShortcode(item.permalink);
      if (code) map.set(code, item);
    }
    return { accessToken, map };
  } catch (err) {
    console.error("[Meta Sync] IG media list failed for user", userId, err.message);
    return null;
  }
}

async function getInstagramMetrics(ig, url) {
  const code = extractInstagramShortcode(url);
  if (!code || !ig?.map.has(code)) return null;
  const media = ig.map.get(code);
  const insights = await meta.getInstagramMediaInsights(media.id, ig.accessToken).catch(() => ({}));
  return {
    views: insights.views || insights.reach || 0,
    likes: insights.likes ?? media.like_count ?? 0,
    comments: insights.comments ?? media.comments_count ?? 0,
  };
}

// Try each managed page's token until one can read the video's stats.
async function getFacebookMetrics(fbConnection, url) {
  const videoId = extractFacebookVideoId(url);
  if (!videoId) return null;
  const pages = fbConnection.pages || [];
  for (const page of pages) {
    const pageToken = decrypt(page.accessTokenEnc);
    if (!pageToken) continue;
    try {
      const stats = await meta.getFacebookVideoStats(videoId, pageToken);
      if (stats) return stats;
    } catch {
      // Try the next page.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function syncMetaViews() {
  const connections = await MetaConnection.find().select("+accessTokenEnc +pages.accessTokenEnc");
  if (connections.length === 0) {
    console.log("[Meta Sync] Skipped — no Meta connections");
    return;
  }

  const byUser = {};
  for (const c of connections) {
    const key = c.userId.toString();
    if (!byUser[key]) byUser[key] = {};
    byUser[key][c.provider] = c;
  }

  const userIds = Object.keys(byUser);
  const submissions = await Submission.find({
    creatorId: { $in: userIds },
    status: { $in: ["posted", "verifying"] },
  });
  console.log(`[Meta Sync] connections=${connections.length} postedSubmissions=${submissions.length}`);

  // Group submissions by creator.
  const submissionsByUser = {};
  for (const submission of submissions) {
    const key = submission.creatorId.toString();
    if (!submissionsByUser[key]) submissionsByUser[key] = [];
    submissionsByUser[key].push(submission);
  }

  for (const [userId, providers] of Object.entries(byUser)) {
    const userSubmissions = submissionsByUser[userId] || [];
    if (userSubmissions.length === 0) continue;

    // Lazily built once per user, only if there is IG content to match.
    let igContext;

    try {
      for (const submission of userSubmissions) {
        let changed = false;

        for (const entry of submission.postedPlatforms || []) {
          const url = entry.postUrl;
          const isIg = entry.platform === "instagram" || isInstagramUrl(url);
          const isFb = entry.platform === "facebook" || isFacebookUrl(url);

          let metrics = null;
          if (isIg && providers.instagram) {
            if (igContext === undefined) igContext = await buildInstagramMediaMap(userId);
            metrics = await getInstagramMetrics(igContext, url);
          } else if (isFb && providers.facebook) {
            metrics = await getFacebookMetrics(providers.facebook, url);
          }

          if (metrics) {
            entry.views = metrics.views || 0;
            entry.likes = metrics.likes || 0;
            entry.comments = metrics.comments || 0;
            changed = true;
          }
        }

        if (changed) {
          submission.viewsDelivered = (submission.postedPlatforms || []).reduce(
            (sum, p) => sum + (p.views || 0),
            0
          );
          await submission.save();
          await updateCampaignFromSubmission(submission);
          emitCampaignUpdate(submission);
        }
      }

      const now = new Date();
      for (const c of Object.values(providers)) {
        c.lastSyncedAt = now;
        await c.save();
      }
      console.log(`[Meta Sync] Synced ${userSubmissions.length} submission(s) for user ${userId}`);
    } catch (error) {
      console.error(`[Meta Sync] Failed for user ${userId}:`, error.message);
    }
  }
}

function startMetaSync() {
  const igConfigured = process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET;
  const fbConfigured = process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET;
  if (!igConfigured && !fbConfigured) {
    console.log("[Meta Sync] Skipped — no Instagram/Facebook app credentials set");
    return;
  }
  syncMetaViews();
  setInterval(syncMetaViews, SYNC_INTERVAL_MS);
}

module.exports = { startMetaSync, syncMetaViews };
