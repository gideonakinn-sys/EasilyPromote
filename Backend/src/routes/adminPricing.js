// Admin **Price Table** (ticket 11): the per-view price tiers views campaigns (and a hybrid views
// bonus's rate) are quoted from. Every admin can read it; only super admins and finance admins can
// change it. A change prices new quotes and drafts saved afterwards only: paid campaigns keep the
// budget and cost per view they were bought at, and a hybrid campaign keeps the views-bonus rate
// stored at setup. Per-industry cost-per-view overrides (Industries) are separate and unchanged.
const express = require("express");
const mongoose = require("mongoose");
const PriceTable = require("../models/PriceTable");
const AdminActivity = require("../models/AdminActivity");
const { protect, authorizeRoles } = require("../middleware/auth");
const { recordAdminActivity } = require("../services/adminActivity");
const pricing = require("../config/pricing");
const { bonusViewsRate, DEFAULT_PLATFORM_FEE_PERCENT } = require("../services/campaignBudget");

const router = express.Router();

const viewGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];
const PRICE_ROLES = ["super_admin", "finance_admin"];
const editGuard = [protect, authorizeRoles(...PRICE_ROLES)];
// AdminActivity needs an id to point at; the table has one fixed id.
const PRICE_TABLE_TARGET_ID = new mongoose.Types.ObjectId("0000000000000000000000a1");
const HISTORY_LIMIT = 20;

function describe(tiers) {
  return tiers.map((tier) => ({
    views: tier.views,
    price: tier.price,
    pricePerThousand: Math.round((tier.price / tier.views) * 1000 * 100) / 100,
  }));
}

async function tableView() {
  await pricing.refreshPriceTable({ force: true });
  const saved = await PriceTable.findById("views").lean();
  const history = await AdminActivity.find({ action: "pricing.view_tiers_updated" }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
  return {
    tiers: describe(pricing.getTierPricing()),
    defaults: describe(pricing.DEFAULT_TIER_PRICING),
    usingDefaults: !saved,
    version: saved ? saved.version : 0,
    updatedAt: saved ? saved.updatedAt : null,
    // What a hybrid views bonus pays creators per 1,000 views on campaigns set up from now on.
    bonusViewsRate: bonusViewsRate(DEFAULT_PLATFORM_FEE_PERCENT),
    platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT,
    limits: { minTiers: pricing.MIN_TIERS, maxTiers: pricing.MAX_TIERS },
    editRoles: PRICE_ROLES,
    history: history.map((entry) => ({
      id: entry._id,
      createdAt: entry.createdAt,
      actor: { name: entry.actorName, role: entry.actorRole },
      note: entry.note,
      version: entry.metadata && entry.metadata.version,
      before: (entry.metadata && entry.metadata.before) || [],
      after: (entry.metadata && entry.metadata.after) || [],
    })),
  };
}

router.get("/views", viewGuard, async (req, res, next) => {
  try {
    res.json(await tableView());
  } catch (err) {
    next(err);
  }
});

// Body: { tiers: [{ views, price }], expectedVersion, note? }. expectedVersion is the version the admin
// edited; a table saved by someone else since is refused with PRICE_TABLE_CHANGED.
router.put("/views", editGuard, async (req, res, next) => {
  try {
    const body = req.body || {};
    const checked = pricing.validateTiers(body.tiers);
    if (checked.error) return res.status(400).json({ error: checked.error, code: "INVALID_TIERS" });
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(400).json({ error: "Reload the price table and try again", code: "VERSION_REQUIRED" });
    }
    const note = String(body.note || "").trim().slice(0, 500) || null;
    if (!note) return res.status(400).json({ error: "Say why the prices are changing", code: "NOTE_REQUIRED" });

    await pricing.refreshPriceTable({ force: true });
    const before = pricing.getTierPricing().map((t) => ({ views: t.views, price: t.price }));
    const same = before.length === checked.tiers.length && before.every((t, i) => t.views === checked.tiers[i].views && t.price === checked.tiers[i].price);
    if (same) return res.status(400).json({ error: "Nothing changed", code: "NO_CHANGE" });

    const version = expectedVersion + 1;
    let saved;
    try {
      saved =
        expectedVersion === 0
          ? await PriceTable.create({ _id: "views", tiers: checked.tiers, version, updatedBy: req.user._id, note })
          : await PriceTable.findOneAndUpdate(
              { _id: "views", version: expectedVersion },
              { $set: { tiers: checked.tiers, version, updatedBy: req.user._id, note } },
              { new: true }
            );
    } catch (error) {
      if (error && error.code === 11000) saved = null;
      else throw error;
    }
    if (!saved) {
      return res.status(409).json({ error: "Someone changed the price table since you loaded it. Reload and try again.", code: "PRICE_TABLE_CHANGED" });
    }

    pricing.setTierPricing(saved.tiers.map((t) => ({ views: t.views, price: t.price })), saved.version);
    await recordAdminActivity(req, {
      action: "pricing.view_tiers_updated",
      targetType: "price_table",
      targetId: PRICE_TABLE_TARGET_ID,
      targetLabel: "Per-view price table",
      note,
      metadata: { version: saved.version, before, after: checked.tiers },
    });
    res.json(await tableView());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.PRICE_ROLES = PRICE_ROLES;
