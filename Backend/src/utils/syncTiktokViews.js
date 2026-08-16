const Submission = require("../models/Submission");
const Campaign = require("../models/Campaign");
const Notification = require("../models/Notification");
const TikTokConnection = require("../models/TikTokConnection");
const tiktok = require("../services/tiktok");
const { emitCampaignUpdate } = require("./campaignUpdates");
const { recordEvent } = require("../services/submissionEvents");

const SYNC_INTERVAL_MS = 15 * 60 * 1000;

async function extractTikTokVideoId(url) {
  if (!url) return null;
  const str = String(url);
  const match = str.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (match) return match[1];

  const shortMatch = str.match(/vm\.tiktok\.com\/([A-Za-z0-9_-]+)/i) || str.match(/vt\.tiktok\.com\/([A-Za-z0-9_-]+)/i);
  if (shortMatch) {
    try {
      const shortUrl = `https://www.${str.match(/vm|vt/i)[0]}.tiktok.com/${shortMatch[1]}`;
      const resp = await fetch(shortUrl, { method: "HEAD", redirect: "follow" });
      const finalUrl = resp.url || str;
      const longMatch = String(finalUrl).match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
      if (longMatch) return longMatch[1];
    } catch (error) {
      console.error("[TikTok Sync] Failed to resolve short link", url, error.message);
    }
  }
  return null;
}

async function getSubmissionVideoId(submission) {
  if (submission.tiktokVideoId) return submission.tiktokVideoId;

  const tiktokPosts = (submission.postedPlatforms || []).filter((p) => {
    return p.postUrl && /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(String(p.postUrl));
  });
  for (const post of tiktokPosts) {
    const id = await extractTikTokVideoId(post.postUrl);
    if (id) return id;
  }

  console.warn("[TikTok Sync] No video id for submission", submission._id, "| postUrl=",
    (submission.postedPlatforms || []).map((p) => p.postUrl).join(","));
  return null;
}

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

async function syncTiktokViews() {
  const summary = {
    connections: 0,
    postedSubmissions: 0,
    submissionsWithVideoId: 0,
    videosQueried: 0,
    updatedSubmissions: 0,
    totalViews: 0,
    errors: [],
  };

  const connections = await TikTokConnection.find().select("+accessTokenEnc +refreshTokenEnc");
  if (connections.length === 0) {
    console.log("[TikTok Sync] Skipped — no TikTok connections");
    return summary;
  }

  const userIds = connections.map((c) => c.userId);

  const submissions = await Submission.find({
    creatorId: { $in: userIds },
    status: { $in: ["posted", "verifying"] },
  });
  console.log(`[TikTok Sync] connections=${connections.length} postedSubmissions=${submissions.length}`);

  summary.connections = connections.length;
  summary.postedSubmissions = submissions.length;

  const byUser = {};
  for (const submission of submissions) {
    const videoId = await getSubmissionVideoId(submission);
    if (!videoId) continue;
    const userId = submission.creatorId.toString();
    if (!byUser[userId]) byUser[userId] = { connection: null, videos: [] };
    byUser[userId].videos.push({ submission, videoId });
  }
  console.log(`[TikTok Sync] submissionsWithVideoId=${Object.values(byUser).reduce((s, d) => s + d.videos.length, 0)}`);
  summary.submissionsWithVideoId = Object.values(byUser).reduce((s, d) => s + d.videos.length, 0);

  const connectionByUser = {};
  for (const c of connections) {
    connectionByUser[c.userId.toString()] = c;
  }

  for (const [userId, data] of Object.entries(byUser)) {
    const connection = connectionByUser[userId];
    if (!connection) continue;

    try {
      const accessToken = await tiktok.getValidAccessToken(userId);
      const uniqueVideoIds = [...new Set(data.videos.map((v) => v.videoId))];

      for (let i = 0; i < uniqueVideoIds.length; i += tiktok.QUERY_BATCH_SIZE) {
        const batch = uniqueVideoIds.slice(i, i + tiktok.QUERY_BATCH_SIZE);
        const videos = await tiktok.queryVideos(accessToken, batch);

        const videoMap = new Map(videos.map((v) => [String(v.id), v]));
        summary.videosQueried += videos.length;
        console.log(`[TikTok Sync] user=${userId} queried=${batch.length} returned=${videos.length} views=${videos.map((v) => v.view_count).join(",")}`);

        for (const { submission, videoId } of data.videos) {
          if (!videoMap.has(videoId)) {
            console.warn(`[TikTok Sync] video ${videoId} not returned for submission ${submission._id}`);
            summary.errors.push(`video ${videoId} not returned for submission ${submission._id}`);
            continue;
          }
          const metrics = videoMap.get(videoId);

          let entry = (submission.postedPlatforms || []).find((p) => p.platform === "tiktok");
          if (!entry) {
            entry = (submission.postedPlatforms || []).find((p) =>
              p.postUrl && /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(String(p.postUrl))
            );
            if (entry) entry.platform = "tiktok";
          }
          if (entry) {
            entry.views = metrics.view_count || 0;
            entry.likes = metrics.like_count || 0;
            entry.comments = metrics.comment_count || 0;
          } else {
            submission.postedPlatforms.push({
              platform: "tiktok",
              postUrl: "",
              views: metrics.view_count || 0,
              likes: metrics.like_count || 0,
              comments: metrics.comment_count || 0,
            });
          }

          const previousViews = submission.viewsDelivered || 0;
          submission.viewsDelivered = submission.postedPlatforms.reduce((sum, p) => sum + (p.views || 0), 0);
          summary.totalViews += entry ? entry.views || 0 : 0;
          await submission.save();

          // Only log when the number actually moved — this runs every 15 minutes.
          if (submission.viewsDelivered !== previousViews) {
            await recordEvent(submission, {
              type: "views_synced",
              actor: "system",
              actorName: "TikTok sync",
              metadata: {
                previousViews,
                views: submission.viewsDelivered,
                delta: submission.viewsDelivered - previousViews,
                videoId,
              },
            });
          }
          await updateCampaignFromSubmission(submission);
          emitCampaignUpdate(submission);
          summary.updatedSubmissions += 1;
        }
      }

      connection.lastSyncedAt = new Date();
      await connection.save();
      console.log(`[TikTok Sync] Updated ${data.videos.length} submission(s) for user ${userId}`);
    } catch (error) {
      console.error(`[TikTok Sync] Failed for user ${userId}:`, error.message);
      summary.errors.push(`${userId}: ${error.message}`);
    }
  }

  return summary;
}

function startTikTokSync() {
  if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
    console.log("[TikTok Sync] Skipped — TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set");
    return;
  }
  syncTiktokViews();
  setInterval(syncTiktokViews, SYNC_INTERVAL_MS);
}

module.exports = { startTikTokSync, syncTiktokViews };
