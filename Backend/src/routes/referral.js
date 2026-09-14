const express = require("express");
const crypto = require("crypto");
const WebhookKey = require("../models/WebhookKey");
const BusinessProfile = require("../models/BusinessProfile");
const { protect, authorizeRoles } = require("../middleware/auth");
const { encrypt } = require("../utils/crypto");

const router = express.Router();

const MAX_KEYS = 3;
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

function serializeKey(key, now = new Date()) {
  const expired = key.status === "expiring" && !key.isUsable(now);
  return {
    id: key._id,
    keyId: key.keyId,
    last4: key.last4,
    status: expired ? "expired" : key.status,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
  };
}

function usableKeysFilter(businessId, now = new Date()) {
  return {
    businessId,
    $or: [{ status: "active" }, { status: "expiring", expiresAt: { $gt: now } }],
  };
}

function webhookUrl(req) {
  const base = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/$/, "")}/api/webhooks/conversions`;
}

async function createKey(businessId) {
  const { keyId, secret, last4 } = generateKey();
  const key = await WebhookKey.create({
    businessId,
    keyId,
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
    const count = await WebhookKey.countDocuments(usableKeysFilter(req.user._id));
    if (count >= MAX_KEYS) {
      return res.status(400).json({ error: `You can have at most ${MAX_KEYS} keys. Revoke one before generating another.` });
    }

    const { key, secret } = await createKey(req.user._id);
    res.status(201).json({ key: serializeKey(key), secret });
  } catch (error) {
    next(error);
  }
});

// Rotation keeps the old key working for 24h so the brand can swap it in without downtime.
router.post("/keys/:id/rotate", async (req, res, next) => {
  try {
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

    const { key, secret } = await createKey(req.user._id);
    oldKey.status = "expiring";
    oldKey.expiresAt = new Date(Date.now() + ROTATION_GRACE_MS);
    await oldKey.save();

    res.status(201).json({ key: serializeKey(key), secret, previousKey: serializeKey(oldKey) });
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

router.get("/status", async (req, res, next) => {
  try {
    const [profile, keys] = await Promise.all([
      BusinessProfile.findOne({ userId: req.user._id }).select("referralConnectedAt").lean(),
      WebhookKey.find(usableKeysFilter(req.user._id)).select("lastUsedAt").lean(),
    ]);

    const lastEventAt = keys.reduce((latest, key) => {
      if (!key.lastUsedAt) return latest;
      return !latest || key.lastUsedAt > latest ? key.lastUsedAt : latest;
    }, null);

    res.json({
      connected: Boolean(profile && profile.referralConnectedAt),
      connectedAt: profile ? profile.referralConnectedAt : null,
      lastEventAt,
      activeKeys: keys.length,
      webhookUrl: webhookUrl(req),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
