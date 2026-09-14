const crypto = require("crypto");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const User = require("../models/User");
const ReferralCode = require("../models/ReferralCode");
const BusinessProfile = require("../models/BusinessProfile");
const CreatorProfile = require("../models/CreatorProfile");

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
const SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ATTEMPTS = 6;
const EVENT_TYPES = Campaign.schema.path("referral.eventType").enumValues;
const CODE_SOURCES = Campaign.schema.path("referral.codeSource").enumValues;

// Returns only the fields the caller actually sent, so updates never reset the others.
function parseReferralSettings(input) {
  if (input === undefined || input === null) return { value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "referral must be an object" };
  }

  const value = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") return { error: "referral.enabled must be true or false" };
    value.enabled = input.enabled;
  }
  if (input.eventType !== undefined) {
    if (!EVENT_TYPES.includes(input.eventType)) {
      return { error: `referral.eventType must be one of: ${EVENT_TYPES.join(", ")}` };
    }
    value.eventType = input.eventType;
  }
  if (input.codeSource !== undefined) {
    if (!CODE_SOURCES.includes(input.codeSource)) {
      return { error: `referral.codeSource must be one of: ${CODE_SOURCES.join(", ")}` };
    }
    value.codeSource = input.codeSource;
  }
  if (input.rewardPerConversion !== undefined) {
    const amount = Number(input.rewardPerConversion);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
      return { error: "referral.rewardPerConversion must be a number between 0 and 1,000,000" };
    }
    value.rewardPerConversion = Math.round(amount * 100) / 100;
  }
  return { value };
}

function normalizeCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function slugPart(value, max = 12) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, max);
}

function buildDisplayCode(brandName, creatorHandle) {
  return `${slugPart(brandName) || "EP"}-${slugPart(creatorHandle) || "CREATOR"}`;
}

function randomSuffix(length = 3) {
  let suffix = "";
  for (let i = 0; i < length; i += 1) {
    suffix += SUFFIX_ALPHABET[crypto.randomInt(SUFFIX_ALPHABET.length)];
  }
  return suffix;
}

async function creatorHandleFor(creatorId) {
  const profile = await CreatorProfile.findOne({ userId: creatorId }).select("username").lean();
  if (profile && profile.username) return profile.username;
  const user = await User.findById(creatorId).select("name").lean();
  return user ? user.name : null;
}

// Idempotent per slot + creator. Tries BRAND-CREATOR first, then adds a random
// suffix when that code is already taken within the brand's account.
async function createReferralCode({ slot, campaign }) {
  const existing = await ReferralCode.findOne({ slotId: slot._id, creatorId: slot.creatorId });
  if (existing) return existing;

  const [brand, handle] = await Promise.all([
    BusinessProfile.findOne({ userId: campaign.businessId }).select("companyName").lean(),
    creatorHandleFor(slot.creatorId),
  ]);
  const base = buildDisplayCode(brand && brand.companyName, handle);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    try {
      return await ReferralCode.create({
        businessId: campaign.businessId,
        campaignId: campaign._id,
        slotId: slot._id,
        creatorId: slot.creatorId,
        code,
        source: "easilypromote",
        // Active at once: brands check codes live, so there is nothing to load first.
        status: "active",
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  throw new Error(`Could not generate a unique referral code for slot ${slot._id}`);
}

// Issues codes for creators who claimed before tracking was switched on.
async function backfillReferralCodes(campaign) {
  const slots = await Slot.find({
    campaignId: campaign._id,
    creatorId: { $ne: null },
    status: { $ne: "available" },
  });
  if (slots.length === 0) return 0;

  const withCodes = new Set(
    (await ReferralCode.find({ campaignId: campaign._id }).select("slotId").lean()).map((code) =>
      code.slotId.toString()
    )
  );

  let created = 0;
  for (const slot of slots) {
    if (withCodes.has(slot._id.toString())) continue;
    try {
      await createReferralCode({ slot, campaign });
      created += 1;
    } catch (error) {
      console.error(`[Referral] Backfill failed for slot ${slot._id}:`, error.message);
    }
  }
  return created;
}

module.exports = {
  EVENT_TYPES,
  CODE_SOURCES,
  parseReferralSettings,
  normalizeCode,
  buildDisplayCode,
  createReferralCode,
  backfillReferralCodes,
};
