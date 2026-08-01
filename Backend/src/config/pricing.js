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

module.exports = { getCostPerView, getEffectiveCostPerView, COST_PER_VIEW };
