const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const ReferralCode = require("../models/ReferralCode");
const Campaign = require("../models/Campaign");
const ClickEvent = require("../models/ClickEvent");
const ConversionEvent = require("../models/ConversionEvent");
const { reserveConversionReward } = require("../utils/referralEarnings");

// Salt for hashing visitor IPs. Uses a per-process random salt; in production,
// set CLICK_HASH_SALT for consistency across restarts (not strictly required since
// clicks expire in 30 days anyway).
const HASH_SALT = process.env.CLICK_HASH_SALT || crypto.randomBytes(16).toString("hex");

// 24-hour deduplication window.
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Bot and crawler user-agent patterns.
const BOT_UA_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|twitterbot|slackbot|telegrambot|linkedinbot|embedly|quora link preview|pinterest|applebot|bingbot|googlebot|yandex|yahoo/i;

// Per-IP rate limiting: max clicks per window from one IP.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;
const ipHitCounts = new Map();
// Cleanup expired entries every 2 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipHitCounts) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) ipHitCounts.delete(key);
  }
}, 2 * 60 * 1000).unref();

function hashIp(ip) {
  return crypto.createHmac("sha256", HASH_SALT).update(ip).digest("hex");
}

function getClientIp(req) {
  // Trust first entry in X-Forwarded-For when behind a proxy.
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip || req.connection.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipHitCounts.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    ipHitCounts.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// GET /r/:code — public redirect handler for clicks campaigns.
// No authentication required. Redirects to the campaign's destinationUrl.
router.get("/:code", async (req, res) => {
  try {
    const code = (req.params.code || "").toUpperCase().trim();
    if (!code) return res.status(404).send("Not found");

    // HEAD requests: redirect without recording.
    const isHead = req.method === "HEAD";

    // Bot check: redirect without recording.
    const ua = req.headers["user-agent"] || "";
    const isBot = BOT_UA_RE.test(ua);

    // Look up the referral code and its campaign.
    const referralCode = await ReferralCode.findOne({ code, isActive: true })
      .select("campaignId creatorId code conversions")
      .lean();
    if (!referralCode) return res.status(404).send("Not found");

    const campaign = await Campaign.findById(referralCode.campaignId)
      .select("campaignObjective destinationUrl status referral businessId name")
      .lean();
    if (!campaign) return res.status(404).send("Not found");

    // Only clicks campaigns use this redirect.
    if (campaign.campaignObjective !== "clicks") return res.status(404).send("Not found");
    if (!campaign.destinationUrl) return res.status(404).send("Not found");

    // Campaign must be live.
    if (!["live", "paused"].includes(campaign.status)) return res.status(404).send("Not found");

    const destinationUrl = campaign.destinationUrl;

    // Bots and HEAD requests: redirect without recording a click.
    if (isHead || isBot) return res.redirect(302, destinationUrl);

    // Rate limit check.
    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp)) return res.redirect(302, destinationUrl);

    const visitorHash = hashIp(clientIp);

    // 24-hour deduplication: check if this visitor already clicked this code recently.
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = await ClickEvent.findOne({
      code,
      visitorHash,
      createdAt: { $gte: dedupCutoff },
    }).lean();

    if (existing) {
      // Already counted within the dedup window; redirect without recording.
      return res.redirect(302, destinationUrl);
    }

    // Record the click event for deduplication.
    await ClickEvent.create({
      code,
      visitorHash,
      campaignId: campaign._id,
      creatorId: referralCode.creatorId,
    });

    // Record a conversion event and reserve the creator's reward.
    const now = new Date();
    const eventId = `click_${code}_${visitorHash}_${now.getTime()}`;

    // Check if this exact click was already recorded as a conversion (idempotency).
    const existingConversion = await ConversionEvent.findOne({
      businessId: campaign.businessId,
      eventId,
    }).lean();

    if (!existingConversion) {
      // The click matches the campaign's conversion type.
      const counted = true;
      const reward = await reserveConversionReward(campaign, counted, now, { eventId: null });

      await ConversionEvent.create({
        businessId: campaign.businessId,
        campaignId: campaign._id,
        referralCodeId: referralCode._id,
        creatorId: referralCode.creatorId,
        eventId,
        eventType: "click",
        occurredAt: now,
        counted,
        rewardAmount: reward.rewardAmount,
        unpaidReason: reward.unpaidReason,
        availableAt: reward.availableAt,
      });

      // Increment the referral code's conversion counter and the campaign's.
      await Promise.all([
        ReferralCode.updateOne({ _id: referralCode._id }, { $inc: { conversions: 1 } }),
        Campaign.updateOne({ _id: campaign._id }, { $inc: { "referral.conversions": 1 } }),
      ]);

      // Emit socket events if the io instance is available.
      const io = req.app.get("io");
      if (io) {
        const payload = {
          campaignId: campaign._id.toString(),
          creatorId: referralCode.creatorId.toString(),
          eventType: "click",
          rewardAmount: reward.rewardAmount,
        };
        io.to(`creator_${referralCode.creatorId}`).emit("referral-conversion", payload);
        io.to(`brand_${campaign.businessId}`).emit("referral-conversion", payload);
      }
    }

    return res.redirect(302, destinationUrl);
  } catch (error) {
    console.error("[Redirect] Error processing click:", error);
    // On error, still try to redirect if we have a destination.
    return res.status(302).redirect("https://easilypromote.com");
  }
});

module.exports = router;
