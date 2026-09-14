const express = require("express");
const Campaign = require("../models/Campaign");
const Slot = require("../models/Slot");
const User = require("../models/User");
const ReferralCode = require("../models/ReferralCode");
const CreatorProfile = require("../models/CreatorProfile");
const { protect, authorizeRoles } = require("../middleware/auth");
const { parseReferralSettings, normalizeCode, backfillReferralCodes } = require("../utils/referralCodes");

// Mounted at /api/campaigns alongside the main campaign router. Auth is applied per
// route (not router.use) so public campaign routes like /pricing stay public.
const router = express.Router();
const businessOnly = [protect, authorizeRoles("business")];

const MAX_IMPORT_ROWS = 1000;
const INVALID_CODE_MESSAGE = "Codes must be 3–64 characters: letters, numbers, dashes or underscores";
const TRACKING_STATUSES = ["live", "paused", "completed"];

async function loadOwnedCampaign(req, res) {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) {
    res.status(404).json({ error: "Campaign not found" });
    return null;
  }
  if (campaign.businessId.toString() !== req.user._id.toString()) {
    res.status(403).json({ error: "Not authorized" });
    return null;
  }
  return campaign;
}

function serializeSettings(campaign) {
  const referral = campaign.referral || {};
  return {
    enabled: Boolean(referral.enabled),
    eventType: referral.eventType || "signup",
    codeSource: referral.codeSource || "easilypromote",
    conversions: referral.conversions || 0,
  };
}

async function buildCodeRows(campaign) {
  const slots = await Slot.find({
    campaignId: campaign._id,
    creatorId: { $ne: null },
    status: { $ne: "available" },
  })
    .sort({ claimedAt: 1 })
    .lean();

  const creatorIds = slots.map((slot) => slot.creatorId);
  const [codes, profiles, users] = await Promise.all([
    ReferralCode.find({ campaignId: campaign._id }).lean(),
    CreatorProfile.find({ userId: { $in: creatorIds } }).select("userId username displayName").lean(),
    User.find({ _id: { $in: creatorIds } }).select("name").lean(),
  ]);

  const codeBySlot = new Map(codes.map((code) => [code.slotId.toString(), code]));
  const profileByUser = new Map(profiles.map((profile) => [profile.userId.toString(), profile]));
  const userById = new Map(users.map((user) => [user._id.toString(), user]));

  return slots.map((slot) => {
    const creatorKey = slot.creatorId.toString();
    const profile = profileByUser.get(creatorKey);
    const user = userById.get(creatorKey);
    const code = codeBySlot.get(slot._id.toString());
    return {
      slotId: slot._id,
      creatorId: slot.creatorId,
      creatorName: (profile && profile.displayName) || (user && user.name) || null,
      creatorUsername: profile ? profile.username : null,
      codeId: code ? code._id : null,
      code: code ? code.code : null,
      source: code ? code.source : null,
      status: code ? code.status : "missing",
      conversions: code ? code.conversions : 0,
      loadedAt: code ? code.loadedAt : null,
    };
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Minimal CSV reader for two-column uploads: handles quoted cells and a header row.
function parseCsvRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = lines.map((line) => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.toLowerCase());
  const codeIndex = header.indexOf("code");
  const userIndex = header.findIndex((cell) =>
    ["creator_username", "username", "creator_handle", "handle"].includes(cell)
  );
  if (codeIndex !== -1 && userIndex !== -1) {
    return rows.slice(1).map((cells) => ({ creator_username: cells[userIndex], code: cells[codeIndex] }));
  }
  return rows.map((cells) => ({ creator_username: cells[0], code: cells[1] }));
}

async function saveBusinessCode({ campaign, slot, code }) {
  const now = new Date();
  const existing = await ReferralCode.findOne({ slotId: slot._id, creatorId: slot.creatorId });
  if (existing) {
    existing.code = code;
    existing.source = "business";
    existing.status = "active";
    existing.loadedAt = existing.loadedAt || now;
    return existing.save();
  }
  return ReferralCode.create({
    businessId: campaign.businessId,
    campaignId: campaign._id,
    slotId: slot._id,
    creatorId: slot.creatorId,
    code,
    source: "business",
    status: "active",
    loadedAt: now,
  });
}

router.patch("/:id/referral", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;
    if (campaign.status === "cancelled") {
      return res.status(400).json({ error: "Referral tracking can't be changed on a cancelled campaign" });
    }

    const parsed = parseReferralSettings(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    for (const [key, value] of Object.entries(parsed.value)) {
      campaign.set(`referral.${key}`, value);
    }
    await campaign.save();

    let codesCreated = 0;
    if (
      campaign.referral.enabled &&
      campaign.referral.codeSource === "easilypromote" &&
      TRACKING_STATUSES.includes(campaign.status)
    ) {
      codesCreated = await backfillReferralCodes(campaign);
    }

    res.json({ referral: serializeSettings(campaign), codesCreated });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/referral-codes", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;

    const rows = await buildCodeRows(campaign);
    res.json({
      referral: serializeSettings(campaign),
      summary: {
        creators: rows.length,
        active: rows.filter((row) => row.status === "active").length,
        awaitingBusiness: rows.filter((row) => row.status === "awaiting_business").length,
        missing: rows.filter((row) => row.status === "missing").length,
        conversions: campaign.referral ? campaign.referral.conversions : 0,
      },
      codes: rows,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/referral-codes.csv", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;

    const rows = await buildCodeRows(campaign);
    const lines = [
      "creator_username,creator_name,code,status,conversions",
      ...rows.map((row) =>
        [row.creatorUsername, row.creatorName, row.code, row.status, row.conversions].map(csvCell).join(",")
      ),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="referral-codes-${campaign._id}.csv"`);
    res.send(`${lines.join("\n")}\n`);
  } catch (error) {
    next(error);
  }
});

router.post("/:id/referral-codes/mark-loaded", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;

    const filter = { campaignId: campaign._id, status: "awaiting_business" };
    if (Array.isArray(req.body.codeIds) && req.body.codeIds.length > 0) {
      filter._id = { $in: req.body.codeIds };
    }
    const result = await ReferralCode.updateMany(filter, { $set: { status: "active", loadedAt: new Date() } });
    res.json({ updated: result.modifiedCount });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/referral-codes/:slotId", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;

    const code = normalizeCode(req.body.code);
    if (!code) {
      return res.status(400).json({ error: INVALID_CODE_MESSAGE });
    }

    const slot = await Slot.findOne({ _id: req.params.slotId, campaignId: campaign._id, creatorId: { $ne: null } });
    if (!slot) {
      return res.status(404).json({ error: "Creator placement not found on this campaign" });
    }

    try {
      const saved = await saveBusinessCode({ campaign, slot, code });
      res.json({ codeId: saved._id, slotId: slot._id, code: saved.code, source: saved.source, status: saved.status });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ error: "That code is already assigned to another creator in your account" });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

router.post("/:id/referral-codes/import", ...businessOnly, async (req, res, next) => {
  try {
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;

    const rows = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv);
    if (rows.length === 0) {
      return res.status(400).json({ error: "Send rows as [{ creator_username, code }] or a csv string" });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ error: `Import at most ${MAX_IMPORT_ROWS} rows at a time` });
    }

    const usernames = [...new Set(rows.map((row) => String(row.creator_username || "").trim()).filter(Boolean))];
    const [profiles, slots] = await Promise.all([
      CreatorProfile.find({ username: { $in: usernames } }).select("userId username").lean(),
      Slot.find({ campaignId: campaign._id, creatorId: { $ne: null }, status: { $ne: "available" } }),
    ]);
    const userIdByUsername = new Map(profiles.map((profile) => [profile.username.toLowerCase(), profile.userId.toString()]));
    const slotByCreator = new Map(slots.map((slot) => [slot.creatorId.toString(), slot]));

    const results = [];
    for (const [index, row] of rows.entries()) {
      const username = String(row.creator_username || "").trim();
      const result = { row: index + 1, creatorUsername: username, code: row.code || null };
      const code = normalizeCode(row.code);
      const creatorId = userIdByUsername.get(username.toLowerCase());
      const slot = creatorId ? slotByCreator.get(creatorId) : null;

      if (!code) {
        results.push({ ...result, status: "error", error: INVALID_CODE_MESSAGE });
      } else if (!slot) {
        results.push({ ...result, status: "error", error: "No creator with that username on this campaign" });
      } else {
        try {
          await saveBusinessCode({ campaign, slot, code });
          results.push({ ...result, code, status: "saved" });
        } catch (error) {
          if (error.code !== 11000) throw error;
          results.push({ ...result, status: "error", error: "Code already assigned to another creator" });
        }
      }
    }

    res.json({
      saved: results.filter((result) => result.status === "saved").length,
      failed: results.filter((result) => result.status === "error").length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
