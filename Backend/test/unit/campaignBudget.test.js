// Budget calculator: the one place checkout and the wizard get a campaign's price from.
// Expected amounts are worked by hand from the price table and decision D2.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { quoteCampaign } = require("../../src/services/campaignBudget");

test("content campaign: brand's rate times deliverables, platform fee added on top (D2)", () => {
  const { quote } = quoteCampaign({ objective: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 10 } });
  assert.deepEqual(quote, { creatorBudget: 150000, performanceBudget: 0, platformFee: 45000, total: 195000 });
});

test("views campaign: price table, platform fee inside the price (unchanged from today)", () => {
  const { quote } = quoteCampaign({ objective: "views", targetViews: 100000 });
  assert.deepEqual(quote, { creatorBudget: 301000, performanceBudget: 0, platformFee: 129000, total: 430000 });
});

test("sign-ups campaign: views price plus referral budget, fee inside each (unchanged from today)", () => {
  const { quote } = quoteCampaign({ objective: "signups", targetViews: 100000, referralBudget: 50000 });
  assert.deepEqual(quote, { creatorBudget: 301000, performanceBudget: 35000, platformFee: 144000, total: 480000 });
});

test("content campaign needs a positive whole-naira rate and at least one deliverable", () => {
  for (const contentPay of [undefined, { ratePerDeliverable: 0, deliverables: 5 }, { ratePerDeliverable: 15000, deliverables: 0 }, { ratePerDeliverable: 150.5, deliverables: 2 }]) {
    const result = quoteCampaign({ objective: "content", contentPay });
    assert.ok(result.error, JSON.stringify(contentPay));
  }
});

test("content campaign pays for at most 100 deliverables", () => {
  assert.ok(quoteCampaign({ objective: "content", contentPay: { ratePerDeliverable: 1000, deliverables: 100 } }).quote);
  assert.match(quoteCampaign({ objective: "content", contentPay: { ratePerDeliverable: 1000, deliverables: 101 } }).error, /100 deliverables/);
});

// Hybrid pay (ticket 10): the base as a content campaign plus the bonus pool, the fee on top of both.
const hybrid = (hybridBonus, contentPay = { ratePerDeliverable: 5000, deliverables: 4 }) =>
  quoteCampaign({ objective: "content", payShape: "hybrid", contentPay, hybridBonus });

test("hybrid campaign: base budget + bonus pool + the platform fee on top of each", () => {
  const { quote } = hybrid({ metric: "views", pool: 20000, capPerCreator: 8000 });
  assert.deepEqual(quote, { creatorBudget: 20000, performanceBudget: 0, bonusPool: 20000, bonusFee: 6000, platformFee: 12000, total: 52000 });
});

test("hybrid fee follows the campaign's fee percent and rounds to the kobo", () => {
  const { quote } = quoteCampaign({
    objective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: 3333, deliverables: 3 },
    hybridBonus: { metric: "signups", pool: 1001, capPerCreator: 1001 },
    platformFeePercent: 25,
  });
  assert.deepEqual(quote, { creatorBudget: 9999, performanceBudget: 0, bonusPool: 1001, bonusFee: 250.25, platformFee: 2750, total: 13750 });
});

test("hybrid bonus needs a metric, a whole-naira pool of at least ₦1,000 and a cap no bigger than the pool", () => {
  for (const bonus of [
    undefined,
    { metric: "likes", pool: 20000, capPerCreator: 5000 },
    { metric: "views", pool: 999, capPerCreator: 500 },
    { metric: "views", pool: 20000.5, capPerCreator: 5000 },
    { metric: "signups", pool: 20000, capPerCreator: 0 },
    { metric: "downloads", pool: 20000, capPerCreator: 20001 },
  ]) {
    assert.ok(hybrid(bonus).error, JSON.stringify(bonus));
  }
  assert.ok(hybrid({ metric: "downloads", pool: 20000, capPerCreator: 20000 }).quote);
});

test("hybrid still needs a valid base, and is refused on performance objectives", () => {
  assert.ok(hybrid({ metric: "views", pool: 20000, capPerCreator: 5000 }, { ratePerDeliverable: 0, deliverables: 4 }).error);
  const views = quoteCampaign({ objective: "views", payShape: "hybrid", targetViews: 100000, hybridBonus: { metric: "views", pool: 20000, capPerCreator: 5000 } });
  assert.match(views.error, /content campaigns/);
});

test("the views bonus rate is the creator's share of the price table's first tier, per 1,000 views", () => {
  const { bonusViewsRate } = require("../../src/services/campaignBudget");
  // ₦430,000 for 100,000 views, 70% to creators: ₦3.01 a view.
  assert.equal(bonusViewsRate(), 3010);
  assert.equal(bonusViewsRate(25), 3225);
});
