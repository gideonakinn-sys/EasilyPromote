const express = require("express");
const crypto = require("crypto");
const WebhookKey = require("../models/WebhookKey");
const WebhookDelivery = require("../models/WebhookDelivery");
const BusinessProfile = require("../models/BusinessProfile");
const { protect, authorizeRoles } = require("../middleware/auth");
const { brandCodePrefix } = require("../utils/referralCodes");
const { encrypt, decrypt } = require("../utils/crypto");
const { EVENT_TYPES, buildSignedRequest, handleCodeCheck, handleConversionWebhook } = require("../services/conversions");

const router = express.Router();

const MAX_KEYS = 3;
const MAX_KEY_NAME = 40;
const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

router.use(protect, authorizeRoles("business"));

function generateKey() {
  const secret = `whsec_${crypto.randomBytes(32).toString("base64url")}`;
  return {
    keyId: `key_${crypto.randomBytes(6).toString("hex")}`,
    secret,
    last4: secret.slice(-4),
  };
}

// Names are optional; undefined means "not sent".
function parseKeyName(input) {
  if (input === undefined || input === null) return { value: undefined };
  if (typeof input !== "string") return { error: "Key name must be text" };
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length > MAX_KEY_NAME) return { error: `Key names can be at most ${MAX_KEY_NAME} characters` };
  return { value };
}

function serializeKey(key, now = new Date()) {
  const expired = key.status === "expiring" && !key.isUsable(now);
  return {
    id: key._id,
    keyId: key.keyId,
    name: key.name || "",
    last4: key.last4,
    status: expired ? "expired" : key.status,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
  };
}

async function keyNamesFor(businessId, deliveries) {
  const keyIds = [...new Set(deliveries.map((delivery) => delivery.keyId).filter(Boolean))];
  if (keyIds.length === 0) return new Map();
  const keys = await WebhookKey.find({ businessId, keyId: { $in: keyIds } }).select("keyId name").lean();
  return new Map(keys.filter((key) => key.name).map((key) => [key.keyId, key.name]));
}

function usableKeysFilter(businessId, now = new Date()) {
  return {
    businessId,
    $or: [{ status: "active" }, { status: "expiring", expiresAt: { $gt: now } }],
  };
}

function apiBase(req) {
  const base = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "");
}

function webhookUrl(req) {
  return `${apiBase(req)}/api/webhooks/conversions`;
}

function validateCodeUrl(req) {
  return `${apiBase(req)}/api/webhooks/codes/validate`;
}

async function createKey(businessId, name = "") {
  const { keyId, secret, last4 } = generateKey();
  const key = await WebhookKey.create({
    businessId,
    keyId,
    name,
    secretEncrypted: encrypt(secret),
    last4,
  });
  return { key, secret };
}

router.get("/keys", async (req, res, next) => {
  try {
    const now = new Date();
    const keys = await WebhookKey.find({ businessId: req.user._id, status: { $ne: "revoked" } }).sort({
      createdAt: -1,
    });
    res.json(keys.map((key) => serializeKey(key, now)).filter((key) => key.status !== "expired"));
  } catch (error) {
    next(error);
  }
});

// The secret is returned exactly once, here. It is never retrievable again.
router.post("/keys", async (req, res, next) => {
  try {
    const name = parseKeyName(req.body && req.body.name);
    if (name.error) return res.status(400).json({ error: name.error });
    const count = await WebhookKey.countDocuments(usableKeysFilter(req.user._id));
    if (count >= MAX_KEYS) {
      return res.status(400).json({ error: `You can have at most ${MAX_KEYS} keys. Revoke one before generating another.` });
    }

    const { key, secret } = await createKey(req.user._id, name.value || "");
    res.status(201).json({ key: serializeKey(key), secret });
  } catch (error) {
    next(error);
  }
});

// Rotation keeps the old key working for 24h so the brand can swap it in without downtime.
router.post("/keys/:id/rotate", async (req, res, next) => {
  try {
    const name = parseKeyName(req.body && req.body.name);
    if (name.error) return res.status(400).json({ error: name.error });
    const oldKey = await WebhookKey.findOne({ _id: req.params.id, businessId: req.user._id });
    if (!oldKey) {
      return res.status(404).json({ error: "Key not found" });
    }
    if (oldKey.status !== "active") {
      return res.status(400).json({ error: "Only active keys can be rotated" });
    }

    const count = await WebhookKey.countDocuments(usableKeysFilter(req.user._id));
    if (count >= MAX_KEYS) {
      return res.status(400).json({ error: `You can have at most ${MAX_KEYS} keys. Revoke one before rotating.` });
    }

    // The replacement keeps the old key's name unless a new one is given.
    const { key, secret } = await createKey(req.user._id, name.value !== undefined ? name.value : oldKey.name || "");
    oldKey.status = "expiring";
    oldKey.expiresAt = new Date(Date.now() + ROTATION_GRACE_MS);
    await oldKey.save();

    res.status(201).json({ key: serializeKey(key), secret, previousKey: serializeKey(oldKey) });
  } catch (error) {
    next(error);
  }
});

router.patch("/keys/:id", async (req, res, next) => {
  try {
    const name = parseKeyName(req.body && req.body.name);
    if (name.error) return res.status(400).json({ error: name.error });
    if (name.value === undefined) return res.status(400).json({ error: "Send a name to rename the key" });

    const key = await WebhookKey.findOne({ _id: req.params.id, businessId: req.user._id });
    if (!key || !key.isUsable()) {
      return res.status(404).json({ error: "Key not found" });
    }
    key.name = name.value;
    await key.save();
    res.json(serializeKey(key));
  } catch (error) {
    next(error);
  }
});

router.delete("/keys/:id", async (req, res, next) => {
  try {
    const key = await WebhookKey.findOne({ _id: req.params.id, businessId: req.user._id });
    if (!key) {
      return res.status(404).json({ error: "Key not found" });
    }

    key.status = "revoked";
    await key.save();
    res.json(serializeKey(key));
  } catch (error) {
    next(error);
  }
});

// Signs a test event with the brand's newest active key and runs it through the real
// webhook handler, so the dashboard proves the whole path without any brand code.
router.post("/test-event", async (req, res, next) => {
  try {
    const keys = await WebhookKey.find(usableKeysFilter(req.user._id)).sort({ createdAt: -1 });
    const key = keys.find((candidate) => candidate.status === "active") || keys[0];
    if (!key) {
      return res.status(400).json({ error: "Generate a signing key first. Test events are signed with your newest active key." });
    }

    const type = req.body.type === "validate" ? "validate" : "conversion";
    const rawCode = typeof req.body.code === "string" ? req.body.code.trim().slice(0, 64) : "";
    if (type === "validate" && !rawCode) {
      return res.status(400).json({ error: "Enter a code to check." });
    }

    const payload =
      type === "validate"
        ? { code: rawCode }
        : {
            event_id: `dashboard-test-${crypto.randomUUID()}`,
            code: rawCode || "TEST-CODE",
            event: EVENT_TYPES.includes(req.body.event) ? req.body.event : "signup",
            timestamp: new Date().toISOString(),
            test: true,
          };
    const signed = buildSignedRequest({ keyId: key.keyId, secret: decrypt(key.secretEncrypted), payload });

    const handler = type === "validate" ? handleCodeCheck : handleConversionWebhook;
    const result = await handler({
      headers: Object.fromEntries(Object.entries(signed.headers).map(([name, value]) => [name.toLowerCase(), value])),
      rawBody: Buffer.from(signed.rawBody),
      source: "dashboard_test",
    });

    res.json({
      type,
      request: {
        method: "POST",
        url: type === "validate" ? validateCodeUrl(req) : webhookUrl(req),
        headers: signed.headers,
        body: payload,
      },
      response: { status: result.status, body: result.body },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/events", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const events = await WebhookDelivery.find({ businessId: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean();
    const keyNames = await keyNamesFor(req.user._id, events);
    res.json(
      events.map((event) => ({
        id: event._id,
        createdAt: event.createdAt,
        source: event.source,
        statusCode: event.statusCode,
        result: event.result,
        error: event.error,
        eventId: event.eventId,
        code: event.code,
        eventType: event.eventType,
        isTest: event.isTest,
        counted: event.counted,
        keyId: event.keyId,
        keyName: (event.keyId && keyNames.get(event.keyId)) || null,
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get("/status", async (req, res, next) => {
  try {
    const [profile, keys, codePrefix] = await Promise.all([
      BusinessProfile.findOne({ userId: req.user._id }).select("referralConnectedAt referralVerification").lean(),
      WebhookKey.find(usableKeysFilter(req.user._id)).select("lastUsedAt").lean(),
      brandCodePrefix(req.user._id),
    ]);

    const lastEventAt = keys.reduce((latest, key) => {
      if (!key.lastUsedAt) return latest;
      return !latest || key.lastUsedAt > latest ? key.lastUsedAt : latest;
    }, null);

    const verification = (profile && profile.referralVerification) || {};
    res.json({
      // Verified: a code check and a conversion arrived from the brand's own server.
      verified: Boolean(verification.verifiedAt),
      verification: {
        codeCheckAt: verification.codeCheckAt || null,
        conversionAt: verification.conversionAt || null,
        verifiedAt: verification.verifiedAt || null,
      },
      connected: Boolean(profile && profile.referralConnectedAt),
      connectedAt: profile ? profile.referralConnectedAt : null,
      lastEventAt,
      activeKeys: keys.length,
      codePrefix,
      webhookUrl: webhookUrl(req),
      validateUrl: validateCodeUrl(req),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
