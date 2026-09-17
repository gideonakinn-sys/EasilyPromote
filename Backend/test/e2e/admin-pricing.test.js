// Admin Price Table (ticket 11): admins see the per-view tiers; super admins and finance admins change
// them with validation and an audit log. A change prices new quotes only: paid campaigns keep what
// they were bought at, and a hybrid campaign keeps the views-bonus rate saved at setup.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  if (harness) await harness.stop();
});

const model = (name) => require(`../../src/models/${name}`);
const NEW_TIERS = [
  { views: 100000, price: 500000 },
  { views: 200000, price: 900000 },
  { views: 1000000, price: 4000000 },
];
const plainTiers = (tiers) => tiers.map(({ views, price }) => ({ views, price }));

async function payFor(brand, body) {
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const status = await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  assert.equal(status.body.status, "live");
  return created.body.id;
}

async function quoteViews(brand, targetViews) {
  const res = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: { campaignObjective: "views", targetViews } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.quote;
}

const put = (who, body) => harness.api("PUT", "/api/admin/pricing/views", { token: who.token, body });

test("every admin can read the table; only super and finance admins can change it, with validation, a note and a version check", async () => {
  const support = await harness.registerAdmin({ role: "support" });
  const admin = await harness.registerAdmin({ role: "admin" });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const brand = await harness.registerBrand();

  const read = await harness.api("GET", "/api/admin/pricing/views", { token: support.token });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.usingDefaults, true);
  assert.equal(read.body.version, 0);
  assert.deepEqual(read.body.tiers[0], { views: 100000, price: 430000, pricePerThousand: 4300 });
  assert.equal(read.body.bonusViewsRate, 3010);
  assert.equal((await harness.api("GET", "/api/admin/pricing/views", { token: brand.token })).status, 403);

  assert.equal((await put(admin, { tiers: NEW_TIERS, expectedVersion: 0, note: "New prices" })).status, 403);
  assert.equal((await put(support, { tiers: NEW_TIERS, expectedVersion: 0, note: "New prices" })).status, 403);

  const invalid = [
    [[{ views: 100000, price: 500000 }], /between 2 and 20 tiers/],
    [[{ views: 100000, price: 500000 }, { views: 100000, price: 900000 }], /views must be more than tier 1/],
    [[{ views: 100000, price: 500000 }, { views: 200000, price: 400000 }], /price must be more than tier 1/],
    [[{ views: 100000, price: 500000 }, { views: 200000, price: 1200000 }], /price per view can.t be higher/],
    [[{ views: 100000, price: 500000.5 }, { views: 200000, price: 900000 }], /whole number/],
    [[{ views: 10, price: 500 }, { views: 200000, price: 900000 }], /views must be a whole number from 1,000/],
  ];
  for (const [tiers, message] of invalid) {
    const res = await put(finance, { tiers, expectedVersion: 0, note: "Bad" });
    assert.equal(res.status, 400, JSON.stringify(tiers));
    assert.equal(res.body.code, "INVALID_TIERS");
    assert.match(res.body.error, message);
  }
  assert.equal((await put(finance, { tiers: NEW_TIERS, expectedVersion: 0 })).body.code, "NOTE_REQUIRED");
  assert.equal((await put(finance, { tiers: plainTiers(read.body.defaults), expectedVersion: 0, note: "Same" })).body.code, "NO_CHANGE");
  assert.equal((await quoteViews(brand, 100000)).total, 430000, "nothing changed yet");

  const saved = await put(finance, { tiers: NEW_TIERS, expectedVersion: 0, note: "Q4 price rise" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 1);
  assert.equal(saved.body.usingDefaults, false);
  assert.deepEqual(plainTiers(saved.body.tiers), NEW_TIERS);
  assert.equal(saved.body.bonusViewsRate, 3500);
  assert.equal(saved.body.history[0].note, "Q4 price rise");
  assert.deepEqual(saved.body.history[0].after, NEW_TIERS);
  assert.equal(saved.body.history[0].before[0].price, 430000);
  const audit = await model("AdminActivity").findOne({ action: "pricing.view_tiers_updated" }).lean();
  assert.equal(audit.actorRole, "finance_admin");
  assert.equal(audit.targetType, "price_table");
  assert.equal(audit.metadata.version, 1);

  // Someone else saved since: refused, never overwritten.
  const stale = await put(finance, { tiers: NEW_TIERS.slice(0, 2), expectedVersion: 0, note: "Stale" });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PRICE_TABLE_CHANGED");

  // Brands see the new table.
  assert.deepEqual((await harness.api("GET", "/api/campaigns/pricing")).body.tiers, NEW_TIERS);

  // Back to the defaults for the next test, as a super admin.
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  const reset = await put(superAdmin, { tiers: plainTiers(read.body.defaults), expectedVersion: 1, note: "Back to defaults" });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal(reset.body.version, 2);
});

test("a price change applies to new quotes only: paid views and hybrid campaigns keep their price and saved bonus rate", async () => {
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const brand = await harness.registerBrand();
  const current = (await harness.api("GET", "/api/admin/pricing/views", { token: finance.token })).body;
  assert.equal(current.tiers[0].price, 430000);

  const viewsId = await payFor(brand, { name: "Paid views", category: "Music", campaignObjective: "views", targetViews: 150000 });
  const hybridId = await payFor(brand, {
    name: "Paid hybrid",
    category: "Beauty",
    campaignObjective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: 5000, deliverables: 2 },
    hybridBonus: { metric: "views", pool: 20000, capPerCreator: 8000 },
    contentDestination: "creator_page",
    creatorAccess: "open_call",
    brief: { summary: "Glow" },
  });
  const draft = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Draft views", category: "Music", campaignObjective: "views", targetViews: 100000 },
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const beforeViews = await model("Campaign").findById(viewsId).lean();
  const beforeHybrid = await model("Campaign").findById(hybridId).lean();
  assert.equal(beforeHybrid.hybridBonus.ratePerThousandViews, 3010);
  assert.equal((await model("Campaign").findById(draft.body.id).lean()).budget, 430000);

  const saved = await put(finance, { tiers: NEW_TIERS, expectedVersion: current.version, note: "Rise" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  // New quotes use the new table.
  assert.equal((await quoteViews(brand, 100000)).total, 500000);
  assert.equal((await quoteViews(brand, 150000)).total, 700000);

  // Paid campaigns are untouched.
  await harness.api("GET", `/api/campaigns/${viewsId}`, { token: brand.token });
  const views = await model("Campaign").findById(viewsId).lean();
  assert.deepEqual(
    [views.budget, views.costPerView, views.creatorPool, views.platformFee],
    [beforeViews.budget, beforeViews.costPerView, beforeViews.creatorPool, beforeViews.platformFee]
  );
  const hybrid = await model("Campaign").findById(hybridId).lean();
  assert.equal(hybrid.hybridBonus.ratePerThousandViews, 3010, "the views-bonus rate saved at setup stays");
  assert.equal(hybrid.paymentAmount, beforeHybrid.paymentAmount);

  // A draft keeps the price it was saved at until its views change.
  assert.equal((await model("Campaign").findById(draft.body.id).lean()).budget, 430000);
  const edited = await harness.api("PATCH", `/api/campaigns/${draft.body.id}`, { token: brand.token, body: { targetViews: 200000 } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await model("Campaign").findById(draft.body.id).lean()).budget, 900000);

  // A hybrid campaign set up now stores the new rate.
  const newHybrid = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "New hybrid",
      category: "Beauty",
      campaignObjective: "content",
      payShape: "hybrid",
      contentPay: { ratePerDeliverable: 5000, deliverables: 2 },
      hybridBonus: { metric: "views", pool: 20000, capPerCreator: 8000 },
      contentDestination: "creator_page",
      creatorAccess: "open_call",
    },
  });
  assert.equal(newHybrid.status, 201, JSON.stringify(newHybrid.body));
  assert.equal((await model("Campaign").findById(newHybrid.body.id).lean()).hybridBonus.ratePerThousandViews, 3500);

  // A saved table is read back after a restart.
  const pricing = require("../../src/config/pricing");
  pricing.setTierPricing(pricing.DEFAULT_TIER_PRICING, 0);
  await pricing.refreshPriceTable({ force: true });
  assert.deepEqual(plainTiers(pricing.getTierPricing()), NEW_TIERS);
});
