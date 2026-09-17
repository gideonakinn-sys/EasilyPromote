// M8: public tracked links for clicks campaigns (SPEC D29). GET /r/:campaignId/:code redirects to the
// campaign's stored destination (never a URL from the request) and pays the creator for a
// valid click from the referral budget, the same way a verified conversion is paid.
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const ReferralCode = require("../models/ReferralCode");
const Campaign = require("../models/Campaign");
const ClickEvent = require("../models/ClickEvent");
const ConversionEvent = require("../models/ConversionEvent");
const { reserveConversionReward } = require("../utils/referralEarnings");

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const FALLBACK_URL = "https://easilypromote.com";

// Link-preview fetchers and crawlers never count as clicks.
const BOT_UA_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|twitterbot|slackbot|telegrambot|linkedinbot|embedly|quora link preview|pinterest|applebot|bingbot|googlebot|yandex|headless|curl|wget|python-requests|axios|node-fetch/i;

// Visitor hashes use a key derived from a server secret, so dedupe holds across restarts and
// instances without storing raw IPs.
function hashKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.TIKTOK_TOKEN_KEY || process.env.JWT_SECRET || "";
  return crypto.createHash("sha256").update(`click-visitor:${secret}`).digest();
}

// The visitor's IP. Cloudflare sets CF-Connecting-IP and overwrites any value a client sends;
// without it, the last X-Forwarded-For entry is the one our own proxy appended (earlier
// entries are client-supplied and can be forged).
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now - entry.start > RATE_LIMIT_WINDOW_MS) hits.delete(ip);
}, 2 * 60 * 1000).unref();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Records one valid click and reserves its reward. The ClickEvent insert (unique on code,
// visitor and 24-hour window) is the idempotency guard: only the request that wins it goes
// on to record the conversion and reserve money, so simultaneous clicks can't both pay.
async function recordClick({ req, referralCode, campaign, now }) {
  const ua = req.headers["user-agent"] || "";
  if (req.method !== "GET" || !ua || BOT_UA_RE.test(ua)) return;
  if (campaign.status !== "live") return;

  const ip = clientIp(req);
  if (rateLimited(ip)) return;

  const visitorHash = crypto.createHmac("sha256", hashKey()).update(`${ip}|${ua}`).digest("hex");
  const windowStart = Math.floor(now.getTime() / DEDUPE_WINDOW_MS);
  try {
    await ClickEvent.create({
      code: referralCode.code,
      visitorHash,
      windowStart,
      campaignId: campaign._id,
      creatorId: referralCode.creatorId,
      createdAt: now,
    });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }

  let event;
  try {
    event = await ConversionEvent.create({
      businessId: campaign.businessId,
      campaignId: campaign._id,
      referralCodeId: referralCode._id,
      creatorId: referralCode.creatorId,
      eventId: `click_${referralCode.code}_${visitorHash}_${windowStart}`,
      eventType: "click",
      occurredAt: now,
    });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }

  const reward = await reserveConversionReward(campaign, true, now, { eventId: event._id });
  await Promise.all([
    ConversionEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          counted: true,
          rewardAmount: reward.rewardAmount,
          unpaidReason: reward.rewardAmount > 0 ? null : reward.unpaidReason,
          availableAt: reward.availableAt,
        },
      }
    ),
    ReferralCode.updateOne({ _id: referralCode._id }, { $inc: { conversions: 1 } }),
    Campaign.updateOne({ _id: campaign._id }, { $inc: { "referral.conversions": 1 } }),
  ]);

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

// Codes are only unique within a brand, so the link carries the campaign: /r/:campaignId/:code.
router.get("/:campaignId/:code", async (req, res) => {
  let destination = null;
  try {
    const { campaignId } = req.params;
    const code = String(req.params.code || "").toUpperCase().trim();
    if (!/^[a-f0-9]{24}$/i.test(campaignId) || !code || code.length > 64) return res.status(404).send("Not found");

    const campaign = await Campaign.findOne({ _id: campaignId, campaignObjective: "clicks", destinationUrl: { $type: "string" } })
      .select("campaignObjective destinationUrl status referral businessId name")
      .lean();
    if (!campaign) return res.status(404).send("Not found");
    const referralCode = await ReferralCode.findOne({ campaignId: campaign._id, code, status: { $ne: "disabled" } })
      .select("campaignId creatorId code")
      .lean();
    if (!referralCode) return res.status(404).send("Not found");
    if (!["live", "paused"].includes(campaign.status)) return res.status(404).send("Not found");

    destination = campaign.destinationUrl;
    await recordClick({ req, referralCode, campaign, now: new Date() });
    return res.redirect(302, destination);
  } catch (error) {
    console.error("[Redirect] Click failed:", error.message);
    // The visitor still reaches the brand's page when counting fails; only an unknown link
    // falls back to the EasilyPromote site.
    return res.redirect(302, destination || FALLBACK_URL);
  }
});

module.exports = router;
