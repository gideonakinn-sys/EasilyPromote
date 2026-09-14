const crypto = require("crypto");
const { z } = require("zod");
const WebhookKey = require("../models/WebhookKey");
const ReferralCode = require("../models/ReferralCode");
const ConversionEvent = require("../models/ConversionEvent");
const WebhookDelivery = require("../models/WebhookDelivery");
const Campaign = require("../models/Campaign");
const BusinessProfile = require("../models/BusinessProfile");
const { decrypt } = require("../utils/crypto");
const { createRateLimiter } = require("../utils/rateLimit");
const { emitToUser } = require("../config/socket");

const SIGNATURE_TOLERANCE_SECONDS = 300;
const COMPLETED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_TYPES = ["install", "signup", "purchase", "deposit", "custom"];

const allowRequest = createRateLimiter({ windowMs: 1000, max: 50 });

const payloadSchema = z.object({
  event_id: z.string().trim().min(1).max(128),
  code: z.string().trim().min(1).max(64),
  event: z.enum(EVENT_TYPES),
  timestamp: z.string().datetime({ offset: true }),
  test: z.boolean().optional(),
});

function parseSignatureHeader(header) {
  const parts = {};
  for (const piece of String(header || "").split(",")) {
    const index = piece.indexOf("=");
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return parts;
}

// Signature is HMAC-SHA256 over `${t}.${rawBody}`. Including the timestamp in the
// signed bytes stops a captured request from being replayed later.
function signPayload(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

// Builds a request exactly as a brand's server should, so the dashboard test and the
// developer docs exercise the same signing code the webhook verifies.
function buildSignedRequest({ keyId, secret, payload, now = Date.now() }) {
  const rawBody = JSON.stringify(payload);
  const t = Math.floor(now / 1000);
  return {
    rawBody,
    headers: {
      "Content-Type": "application/json",
      "X-EP-Key-Id": keyId,
      "X-EP-Signature": `t=${t},v1=${signPayload(secret, t, rawBody)}`,
    },
  };
}

function verifyConversionSignature({ secret, header, rawBody, now = Date.now() }) {
  const { t, v1 } = parseSignatureHeader(header);
  const timestamp = Number(t);
  if (!Number.isInteger(timestamp) || !v1) {
    return { ok: false, reason: "Malformed X-EP-Signature header. Expected t=<unix seconds>,v1=<hex hmac>" };
  }
  if (Math.abs(Math.floor(now / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Signature timestamp is more than 5 minutes from server time" };
  }

  const expected = Buffer.from(signPayload(secret, timestamp, rawBody), "utf8");
  const received = Buffer.from(String(v1), "utf8");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: "Signature does not match" };
  }
  return { ok: true };
}

function campaignAcceptsConversions(campaign, now = Date.now()) {
  if (campaign.status === "live" || campaign.status === "paused") return true;
  if (campaign.status === "completed") {
    const closedAt = campaign.endDate || campaign.updatedAt;
    return Boolean(closedAt) && now - new Date(closedAt).getTime() <= COMPLETED_GRACE_MS;
  }
  return false;
}

async function markConnected(key, now) {
  await Promise.all([
    WebhookKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: now } }),
    BusinessProfile.updateOne(
      { userId: key.businessId, referralConnectedAt: null },
      { $set: { referralConnectedAt: now } }
    ),
  ]);
}

// Test events never need a real code, but when one is sent we report whether it
// would match, so a brand can check its setup before going live.
async function checkTestCode(businessId, rawCode, now) {
  const value = String(rawCode || "").toUpperCase();
  const referralCode = await ReferralCode.findOne({ businessId, code: value }).select("status campaignId").lean();
  if (!referralCode) return { value, found: false };

  const campaign = await Campaign.findById(referralCode.campaignId).select("status endDate updatedAt").lean();
  return {
    value,
    found: true,
    status: referralCode.status,
    campaignAcceptingConversions: Boolean(campaign) && campaignAcceptsConversions(campaign, now.getTime()),
  };
}

async function logDelivery(context, result, source) {
  if (!context.businessId) return;
  try {
    const body = result.body || {};
    const details = Array.isArray(body.details) ? ` (${body.details.join("; ")})` : "";
    await WebhookDelivery.create({
      businessId: context.businessId,
      keyId: context.keyId,
      source,
      statusCode: result.status,
      result: result.status === 200 ? body.status : "rejected",
      error: result.status === 200 ? null : `${body.error || "Request failed"}${details}`,
      eventId: context.eventId,
      code: context.code,
      eventType: context.eventType,
      isTest: context.isTest,
      counted: Boolean(body.counted),
    });
  } catch (error) {
    // The log is a debugging aid; it must never change the webhook's answer.
    console.error("[Referral] Failed to log webhook delivery:", error.message);
  }
}

async function processConversion({ headers, rawBody }, context) {
  const now = new Date();
  const reply = (status, body) => ({ status, body });

  const keyId = headers["x-ep-key-id"];
  if (!keyId) {
    return reply(401, { error: "Missing X-EP-Key-Id header" });
  }
  if (!allowRequest(String(keyId))) {
    return reply(429, { error: "Too many requests for this key. Slow down and retry." });
  }

  const key = await WebhookKey.findOne({ keyId: String(keyId) });
  if (!key || !key.isUsable(now)) {
    return reply(401, { error: "Unknown, revoked or expired key" });
  }
  context.businessId = key.businessId;
  context.keyId = key.keyId;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from("");
  const signature = verifyConversionSignature({
    secret: decrypt(key.secretEncrypted),
    header: headers["x-ep-signature"],
    rawBody: body,
    now: now.getTime(),
  });
  if (!signature.ok) {
    return reply(401, { error: signature.reason });
  }

  let json;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return reply(400, { error: "Body must be valid JSON" });
  }

  if (json && typeof json === "object") {
    context.eventId = typeof json.event_id === "string" ? json.event_id.slice(0, 128) : null;
    context.code = typeof json.code === "string" ? json.code.slice(0, 64).toUpperCase() : null;
    context.eventType = typeof json.event === "string" ? json.event.slice(0, 32) : null;
    context.isTest = json.test === true;
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
    return reply(400, { error: "Invalid payload", details });
  }
  const payload = parsed.data;

  // Test events prove the key and signing work. They don't need a real code yet,
  // so a brand can connect before its first campaign exists.
  if (payload.test) {
    const [code] = await Promise.all([checkTestCode(key.businessId, payload.code, now), markConnected(key, now)]);
    return reply(200, { status: "test_ok", code });
  }

  const referralCode = await ReferralCode.findOne({
    businessId: key.businessId,
    code: payload.code.toUpperCase(),
  });
  if (!referralCode) {
    return reply(404, { error: "Unknown referral code" });
  }
  if (referralCode.status === "disabled") {
    return reply(409, { error: "Referral code is disabled" });
  }

  const campaign = await Campaign.findById(referralCode.campaignId).select("status endDate updatedAt referral");
  if (!campaign || !campaignAcceptsConversions(campaign, now.getTime())) {
    return reply(409, { error: "Campaign is not accepting conversions" });
  }

  try {
    await ConversionEvent.create({
      businessId: key.businessId,
      campaignId: campaign._id,
      referralCodeId: referralCode._id,
      creatorId: referralCode.creatorId,
      eventId: payload.event_id,
      eventType: payload.event,
      occurredAt: new Date(payload.timestamp),
    });
  } catch (error) {
    if (error.code === 11000) {
      await WebhookKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: now } });
      return reply(200, { status: "ignored", reason: "event_id already recorded" });
    }
    throw error;
  }

  // Every event is stored; only the campaign's chosen conversion type moves the counters.
  const counted = payload.event === (campaign.referral && campaign.referral.eventType);
  const codeUpdate = { $inc: { conversions: counted ? 1 : 0 } };
  if (referralCode.status === "awaiting_business") {
    codeUpdate.$set = { status: "active", loadedAt: referralCode.loadedAt || now };
  }

  const [updatedCode] = await Promise.all([
    ReferralCode.findByIdAndUpdate(referralCode._id, codeUpdate, { new: true }),
    counted
      ? Campaign.updateOne({ _id: campaign._id }, { $inc: { "referral.conversions": 1 } })
      : Promise.resolve(),
    markConnected(key, now),
  ]);

  const update = {
    campaignId: campaign._id,
    referralCodeId: referralCode._id,
    code: referralCode.code,
    eventType: payload.event,
    counted,
    conversions: updatedCode ? updatedCode.conversions : referralCode.conversions,
  };
  emitToUser(referralCode.creatorId, "referral-conversion", update);
  emitToUser(key.businessId, "referral-conversion", update);

  return reply(200, { status: "recorded", counted });
}

async function handleConversionWebhook({ headers, rawBody, source = "webhook" }) {
  const context = { businessId: null, keyId: null, eventId: null, code: null, eventType: null, isTest: false };
  const result = await processConversion({ headers, rawBody }, context);
  await logDelivery(context, result, source);
  return result;
}

module.exports = {
  EVENT_TYPES,
  handleConversionWebhook,
  verifyConversionSignature,
  buildSignedRequest,
  signPayload,
};
