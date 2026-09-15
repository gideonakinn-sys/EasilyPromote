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
const { reserveConversionReward } = require("../utils/referralEarnings");

const SIGNATURE_TOLERANCE_SECONDS = 300;
const COMPLETED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_TYPES = ["install", "signup", "purchase", "deposit", "custom"];

const INVALID_CODE_MESSAGES = {
  not_found: "No creator in your account has this code",
  disabled: "Referral code is disabled",
  campaign_not_accepting: "Campaign is not accepting conversions",
};

const allowRequest = createRateLimiter({ windowMs: 1000, max: 50 });

const conversionSchema = z.object({
  event_id: z.string().trim().min(1).max(128),
  code: z.string().trim().min(1).max(64),
  event: z.enum(EVENT_TYPES),
  timestamp: z.string().datetime({ offset: true }),
  test: z.boolean().optional(),
});

const codeCheckSchema = z.object({
  code: z.string().trim().min(1).max(64),
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
  if (!campaign.referral || !campaign.referral.enabled) return false;
  if (campaign.status === "live" || campaign.status === "paused") return true;
  if (campaign.status === "completed") {
    const closedAt = campaign.completedAt || campaign.endDate || campaign.updatedAt;
    return Boolean(closedAt) && now - new Date(closedAt).getTime() <= COMPLETED_GRACE_MS;
  }
  return false;
}

function reply(status, body) {
  return { status, body };
}

function invalidPayload(error) {
  const details = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
  return reply(400, { error: "Invalid payload", details });
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

// Shared by conversions and code checks: key lookup, signature, rate limit, JSON.
// Returns { key, json } on success or { failure } with the response to send.
async function authenticateSignedRequest({ headers, rawBody }, context, now) {
  const keyId = headers["x-ep-key-id"];
  if (!keyId) {
    return { failure: reply(401, { error: "Missing X-EP-Key-Id header" }) };
  }

  const key = await WebhookKey.findOne({ keyId: String(keyId) });
  if (!key || !key.isUsable(now)) {
    return { failure: reply(401, { error: "Unknown, revoked or expired key" }) };
  }
  // Known key: from here every outcome, bad signatures included, lands in the brand's request log.
  context.businessId = key.businessId;
  context.keyId = key.keyId;

  // Check that the key owner is active (M8)
  const User = require("../models/User");
  const owner = await User.findById(key.businessId);
  if (!owner || owner.isActive === false) {
    return { failure: reply(401, { error: "Account is inactive or disabled" }) };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from("");
  const signature = verifyConversionSignature({
    secret: decrypt(key.secretEncrypted),
    header: headers["x-ep-signature"],
    rawBody: body,
    now: now.getTime(),
  });
  if (!signature.ok) {
    return { failure: reply(401, { error: signature.reason }) };
  }

  // Rate limit AFTER signature verification so unauthenticated attackers cannot throttle a brand (M5)
  if (!allowRequest(String(keyId))) {
    return { failure: reply(429, { error: "Too many requests for this key. Slow down and retry." }) };
  }

  let json;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return { failure: reply(400, { error: "Body must be valid JSON" }) };
  }

  if (json && typeof json === "object") {
    context.code = typeof json.code === "string" ? json.code.slice(0, 64).toUpperCase() : null;
    context.isTest = json.test === true;
  }
  return { key, json };
}

// One answer to "would this code count right now?", used by code checks, test events
// and conversions so they can never disagree.
async function evaluateCode(businessId, rawCode, now) {
  const value = String(rawCode || "").trim().toUpperCase();
  const referralCode = await ReferralCode.findOne({ businessId, code: value });
  if (!referralCode) return { value, referralCode: null, campaign: null, reason: "not_found" };
  if (referralCode.status === "disabled") return { value, referralCode, campaign: null, reason: "disabled" };

  const campaign = await Campaign.findById(referralCode.campaignId).select(
    "status endDate completedAt updatedAt referral businessId name"
  );
  if (!campaign || !campaignAcceptsConversions(campaign, now.getTime())) {
    return { value, referralCode, campaign, reason: "campaign_not_accepting" };
  }
  return { value, referralCode, campaign, reason: null };
}

// Codes issued before live validation existed waited for the brand to confirm them.
// A signed check or conversion is that confirmation.
async function activateIfPending(referralCode, now) {
  if (referralCode.status !== "awaiting_business") return;
  await ReferralCode.updateOne(
    { _id: referralCode._id, status: "awaiting_business" },
    { $set: { status: "active", loadedAt: referralCode.loadedAt || now } }
  );
}

async function logDelivery(context, result, source) {
  if (!context.businessId) return;
  try {
    const body = result.body || {};
    let outcome = "rejected";
    let error = null;
    if (result.status === 200) {
      if (typeof body.valid === "boolean") {
        outcome = body.valid ? "valid" : "invalid";
        error = body.valid ? null : INVALID_CODE_MESSAGES[body.reason] || body.reason || null;
      } else {
        outcome = body.status;
      }
    } else {
      const details = Array.isArray(body.details) ? ` (${body.details.join("; ")})` : "";
      error = `${body.error || "Request failed"}${details}`;
    }

    await WebhookDelivery.create({
      businessId: context.businessId,
      keyId: context.keyId,
      source,
      statusCode: result.status,
      result: outcome,
      error,
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

async function processConversion(request, context) {
  const now = new Date();
  const auth = await authenticateSignedRequest(request, context, now);
  if (auth.failure) return auth.failure;
  const { key, json } = auth;

  if (json && typeof json === "object") {
    context.eventId = typeof json.event_id === "string" ? json.event_id.slice(0, 128) : null;
    context.eventType = typeof json.event === "string" ? json.event.slice(0, 32) : null;
  }

  const parsed = conversionSchema.safeParse(json);
  if (!parsed.success) return invalidPayload(parsed.error);
  const payload = parsed.data;

  const evaluation = await evaluateCode(key.businessId, payload.code, now);

  // Test events prove the key and signing work. They don't need a real code yet,
  // but report whether the code would match so a brand can check its setup.
  if (payload.test) {
    await markConnected(key, now);
    return reply(200, {
      status: "test_ok",
      code: {
        value: evaluation.value,
        found: Boolean(evaluation.referralCode),
        ...(evaluation.referralCode && { status: evaluation.referralCode.status }),
        ...(evaluation.referralCode && { campaignAcceptingConversions: evaluation.reason === null }),
      },
    });
  }

  if (evaluation.reason === "not_found") return reply(404, { error: "Unknown referral code" });
  if (evaluation.reason) return reply(409, { error: INVALID_CODE_MESSAGES[evaluation.reason] });
  const { referralCode, campaign } = evaluation;

  let event;
  try {
    event = await ConversionEvent.create({
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

  // The event is saved first (it's the idempotency guard); only then is money
  // reserved, so a duplicate delivery can never reserve a reward twice.
  const reward = await reserveConversionReward(campaign, counted, now);

  const [updatedCode] = await Promise.all([
    ReferralCode.findByIdAndUpdate(referralCode._id, { $inc: { conversions: counted ? 1 : 0 } }, { new: true }),
    counted
      ? Campaign.updateOne({ _id: campaign._id }, { $inc: { "referral.conversions": 1 } })
      : Promise.resolve(),
    ConversionEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          counted,
          rewardAmount: reward.rewardAmount,
          unpaidReason: counted && reward.rewardAmount > 0 ? null : reward.unpaidReason,
          availableAt: reward.availableAt,
        },
      }
    ),
    activateIfPending(referralCode, now),
    markConnected(key, now),
  ]);

  const update = {
    campaignId: campaign._id,
    referralCodeId: referralCode._id,
    code: referralCode.code,
    eventType: payload.event,
    counted,
    rewardAmount: reward.rewardAmount,
    conversions: updatedCode ? updatedCode.conversions : referralCode.conversions,
  };
  emitToUser(referralCode.creatorId, "referral-conversion", update);
  emitToUser(key.businessId, "referral-conversion", update);

  return reply(200, { status: "recorded", counted });
}

// Called by a brand's sign-up flow when a user enters a code, so brands never have to
// load or sync creators' codes. Records nothing; the conversion comes later.
async function processCodeCheck(request, context) {
  const now = new Date();
  const auth = await authenticateSignedRequest(request, context, now);
  if (auth.failure) return auth.failure;
  const { key, json } = auth;

  const parsed = codeCheckSchema.safeParse(json);
  if (!parsed.success) return invalidPayload(parsed.error);

  const [evaluation] = await Promise.all([evaluateCode(key.businessId, parsed.data.code, now), markConnected(key, now)]);
  if (evaluation.reason) {
    return reply(200, { valid: false, code: evaluation.value, reason: evaluation.reason });
  }

  await activateIfPending(evaluation.referralCode, now);
  return reply(200, {
    valid: true,
    code: evaluation.value,
    campaign_id: String(evaluation.campaign._id),
    event: evaluation.campaign.referral ? evaluation.campaign.referral.eventType : "signup",
  });
}

function emptyContext() {
  return { businessId: null, keyId: null, eventId: null, code: null, eventType: null, isTest: false };
}

async function handleConversionWebhook({ headers, rawBody, source = "webhook" }) {
  const context = emptyContext();
  const result = await processConversion({ headers, rawBody }, context);
  await logDelivery(context, result, source);
  return result;
}

async function handleCodeCheck({ headers, rawBody, source = "code_check" }) {
  const context = emptyContext();
  const result = await processCodeCheck({ headers, rawBody }, context);
  await logDelivery(context, result, source);
  return result;
}

module.exports = {
  EVENT_TYPES,
  campaignAcceptsConversions,
  handleConversionWebhook,
  handleCodeCheck,
  verifyConversionSignature,
  buildSignedRequest,
  signPayload,
};
