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

test("hybrid pay isn't available yet", () => {
  const result = quoteCampaign({ objective: "content", payShape: "hybrid", contentPay: { ratePerDeliverable: 5000, deliverables: 4 } });
  assert.match(result.error, /Hybrid/);
});
