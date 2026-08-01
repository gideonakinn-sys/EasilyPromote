const Industry = require("../models/Industry");

const DEFAULT_INDUSTRIES = [
  { name: "Technology", costPerView: 1.15 },
  { name: "Software & Apps", costPerView: 1.25 },
  { name: "Music", costPerView: 1.085 },
  { name: "Apparel & Fashion", costPerView: 1.2 },
  { name: "E-commerce", costPerView: 1.15 },
  { name: "Food & Beverages", costPerView: 1.1 },
  { name: "Health & Beauty", costPerView: 1.2 },
  { name: "Fitness & Wellness", costPerView: 1.15 },
  { name: "Finance & Fintech", costPerView: 1.35 },
  { name: "Education & E-learning", costPerView: 1.1 },
  { name: "Travel & Hospitality", costPerView: 1.25 },
  { name: "Real Estate", costPerView: 1.3 },
  { name: "Automotive", costPerView: 1.2 },
  { name: "Gaming", costPerView: 1.1 },
  { name: "Entertainment & Media", costPerView: 1.15 },
  { name: "Sports & Outdoor", costPerView: 1.1 },
  { name: "Home & Interior Design", costPerView: 1.2 },
  { name: "Retail & Consumer Goods", costPerView: 1.1 },
  { name: "Professional Services", costPerView: 1.3 },
  { name: "Agriculture", costPerView: 1.05 },
  { name: "Non-Profit & Social Impact", costPerView: 1.0 },
];

/**
 * Seeds the default industries if the collection is empty. If industries
 * already exist, adds any defaults that are missing (so existing databases
 * pick up newly-added defaults without duplicating or overwriting admin edits).
 */
async function seedIndustries() {
  const count = await Industry.countDocuments();
  if (count === 0) {
    await Industry.insertMany(
      DEFAULT_INDUSTRIES.map((ind, i) => ({ name: ind.name, costPerView: ind.costPerView, sortOrder: i, enabled: true }))
    );
    return;
  }
  const found = await Industry.find({ name: { $in: DEFAULT_INDUSTRIES.map((d) => d.name) } }).select("name costPerView");
  const byName = new Map(found.map((f) => [f.name, f]));
  const existing = new Set(found.map((f) => f.name));
  const toAdd = DEFAULT_INDUSTRIES.filter((d) => !existing.has(d.name));
  if (toAdd.length > 0) {
    await Industry.insertMany(
      toAdd.map((ind, i) => ({ name: ind.name, costPerView: ind.costPerView, sortOrder: DEFAULT_INDUSTRIES.length + i, enabled: true }))
    );
  }

  const toBackfill = DEFAULT_INDUSTRIES.filter(
    (d) => byName.has(d.name) && (byName.get(d.name).costPerView === null || byName.get(d.name).costPerView === undefined)
  );
  for (const ind of toBackfill) {
    await Industry.updateOne({ _id: byName.get(ind.name)._id }, { costPerView: ind.costPerView });
  }
}

module.exports = { seedIndustries, DEFAULT_INDUSTRIES };
