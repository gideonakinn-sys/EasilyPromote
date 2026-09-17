const COST_PER_VIEW = {
  default: 1.085,
  categories: {
    Music: 1.085,
    Fashion: 1.2,
    Tech: 1.15,
    Food: 1.1,
    Travel: 1.25,
    Fitness: 1.15,
    Beauty: 1.2,
    Gaming: 1.1,
  },
};

function getCostPerView(category) {
  if (category && COST_PER_VIEW.categories[category]) {
    return COST_PER_VIEW.categories[category];
  }
  return COST_PER_VIEW.default;
}

/**
 * Returns the admin-configured rate for an industry if one exists and is
 * enabled, otherwise falls back to the static category rate.
 */
async function getEffectiveCostPerView(category) {
  if (!category) return COST_PER_VIEW.default;
  try {
    const Industry = require("../models/Industry");
    const industry = await Industry.findOne({
      name: { $regex: `^${String(category).trim()}$`, $options: "i" },
      enabled: true,
    });
    if (industry && industry.costPerView > 0) {
      return industry.costPerView;
    }
  } catch (err) {
    // fall through to static pricing
  }
  return getCostPerView(category);
}

// Tiered universal pricing (volume discount). budget = f(views).
// These are the defaults; admin can change the table (ticket 11, admin **Price Table**). The table in
// force is kept in memory, loaded from the `pricetables` collection at boot and re-read at most once a
// minute before pricing (refreshPriceTable), so every API instance picks up a change. A change only
// prices new quotes and unpaid drafts saved afterwards: a campaign stores its budget, cost per view
// and views-bonus rate when it's set up, and nothing reprices a paid campaign.
const DEFAULT_TIER_PRICING = Object.freeze([
  { views: 100000, price: 430000 },
  { views: 200000, price: 780000 },
  { views: 500000, price: 1830000 },
  { views: 1000000, price: 3330000 },
  { views: 2000000, price: 6405000 },
  { views: 5000000, price: 15000000 },
  { views: 10000000, price: 28500000 },
  { views: 20000000, price: 54000000 },
  { views: 40000000, price: 100000000 },
].map((tier) => Object.freeze(tier)));

const MIN_TIERS = 2;
const MAX_TIERS = 20;
const MIN_TIER_VIEWS = 1000;
const MAX_TIER_VIEWS = 1000000000;
const MAX_TIER_PRICE = 100000000000;
const REFRESH_EVERY_MS = 60 * 1000;

let activeTiers = DEFAULT_TIER_PRICING;
let activeVersion = 0;
let loadedAt = 0;

function getTierPricing() {
  return activeTiers;
}

// Pure. Returns { tiers } (whole numbers, sorted as given) or { error }. Every tier sells more views
// for more money, and never at a higher price per view than the tier before it.
function validateTiers(input) {
  if (!Array.isArray(input)) return { error: "Send the tiers as a list" };
  if (input.length < MIN_TIERS || input.length > MAX_TIERS) return { error: `The table needs between ${MIN_TIERS} and ${MAX_TIERS} tiers` };
  const tiers = [];
  for (const [index, raw] of input.entries()) {
    const row = index + 1;
    const views = raw && raw.views;
    const price = raw && raw.price;
    if (!Number.isInteger(views) || views < MIN_TIER_VIEWS || views > MAX_TIER_VIEWS) {
      return { error: `Tier ${row}: views must be a whole number from ${MIN_TIER_VIEWS.toLocaleString("en-US")} to ${MAX_TIER_VIEWS.toLocaleString("en-US")}` };
    }
    if (!Number.isInteger(price) || price <= 0 || price > MAX_TIER_PRICE) {
      return { error: `Tier ${row}: the price must be a whole number of naira above 0` };
    }
    const prev = tiers[tiers.length - 1];
    if (prev && views <= prev.views) return { error: `Tier ${row}: views must be more than tier ${row - 1}'s` };
    if (prev && price <= prev.price) return { error: `Tier ${row}: the price must be more than tier ${row - 1}'s` };
    // Compared without rounding: price / views <= prev.price / prev.views.
    if (prev && price * prev.views > prev.price * views) {
      return { error: `Tier ${row}: the price per view can't be higher than tier ${row - 1}'s` };
    }
    tiers.push({ views, price });
  }
  return { tiers };
}

function setTierPricing(tiers, version = activeVersion) {
  const checked = validateTiers(tiers);
  if (checked.error) throw new Error(`Invalid price table: ${checked.error}`);
  activeTiers = Object.freeze(checked.tiers.map((tier) => Object.freeze({ ...tier })));
  activeVersion = version;
  loadedAt = Date.now();
}

// Reads the saved table (or goes back to the defaults when none is saved). A broken saved table
// keeps the table in force and logs, so pricing never stops.
async function loadPriceTable() {
  const PriceTable = require("../models/PriceTable");
  const saved = await PriceTable.findById("views").lean();
  if (!saved) {
    activeTiers = DEFAULT_TIER_PRICING;
    activeVersion = 0;
    loadedAt = Date.now();
    return { tiers: activeTiers, version: 0 };
  }
  try {
    setTierPricing(saved.tiers, saved.version);
  } catch (error) {
    loadedAt = Date.now();
    console.error("[Pricing] Saved price table is invalid, keeping the one in force:", error.message);
  }
  return { tiers: activeTiers, version: activeVersion };
}

// Re-reads the table when it's older than a minute. Pricing routes await this first.
async function refreshPriceTable({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < REFRESH_EVERY_MS) return;
  try {
    await loadPriceTable();
  } catch (error) {
    loadedAt = Date.now();
    console.error("[Pricing] Couldn't load the price table:", error.message);
  }
}

function getPriceForViews(views) {
  const TIER_PRICING = activeTiers;
  const count = Number(views) || 0;
  if (count <= TIER_PRICING[0].views) return TIER_PRICING[0].price;

  for (let i = 1; i < TIER_PRICING.length; i++) {
    const prev = TIER_PRICING[i - 1];
    const curr = TIER_PRICING[i];
    if (count <= curr.views) {
      const t = (count - prev.views) / (curr.views - prev.views);
      return Math.round(prev.price + (curr.price - prev.price) * t);
    }
  }

  // Above the last tier: extrapolate using the last segment slope
  const prev = TIER_PRICING[TIER_PRICING.length - 2];
  const last = TIER_PRICING[TIER_PRICING.length - 1];
  const slope = (last.price - prev.price) / (last.views - prev.views);
  return Math.round(last.price + (count - last.views) * slope);
}

module.exports = {
  getCostPerView,
  getEffectiveCostPerView,
  getPriceForViews,
  getTierPricing,
  setTierPricing,
  validateTiers,
  loadPriceTable,
  refreshPriceTable,
  COST_PER_VIEW,
  DEFAULT_TIER_PRICING,
  MIN_TIERS,
  MAX_TIERS,
};
// The table in force (read at call time, so it follows admin changes).
Object.defineProperty(module.exports, "TIER_PRICING", { enumerable: true, get: getTierPricing });
Object.defineProperty(module.exports, "priceTableVersion", { enumerable: true, get: () => activeVersion });
