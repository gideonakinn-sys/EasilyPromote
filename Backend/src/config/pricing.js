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
const TIER_PRICING = [
  { views: 100000, price: 430000 },
  { views: 200000, price: 780000 },
  { views: 500000, price: 1830000 },
  { views: 1000000, price: 3330000 },
  { views: 2000000, price: 6405000 },
  { views: 5000000, price: 15000000 },
  { views: 10000000, price: 28500000 },
  { views: 20000000, price: 54000000 },
  { views: 40000000, price: 100000000 },
];

function getPriceForViews(views) {
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
  COST_PER_VIEW,
  TIER_PRICING,
};
