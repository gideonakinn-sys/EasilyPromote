// Hybrid pay's bonus rules (ticket 10): the views bonus due, the hold, the unused pool refund and when
// it can be refunded. Worked by hand.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../../src/utils/hybridBonusRules");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-01T12:00:00Z");

test("a views bonus is verified views × the rate per 1,000, rounded down to the kobo, never over the cap", () => {
  // 1,234 views at ₦3,010 per 1,000 = ₦3,714.34
  assert.equal(rules.viewsBonusDueKobo({ views: 1234, ratePerThousandViews: 3010, capPerCreator: 10000 }), 371434);
  assert.equal(rules.viewsBonusDueKobo({ views: 1, ratePerThousandViews: 3010, capPerCreator: 10000 }), 301);
  assert.equal(rules.viewsBonusDueKobo({ views: 5000000, ratePerThousandViews: 3010, capPerCreator: 8000 }), 800000);
  assert.equal(rules.viewsBonusDueKobo({ views: -5, ratePerThousandViews: 3010, capPerCreator: 8000 }), 0);
});

test("a bonus credit is held 7 days from when it was credited", () => {
  assert.equal(rules.bonusCreditState({ date: new Date(NOW.getTime() - 6 * DAY) }, NOW).state, "on_hold");
  assert.equal(rules.bonusCreditState({ date: new Date(NOW.getTime() - 7 * DAY) }, NOW).state, "available");
});

test("an unused bonus pool refunds the pool plus its share of the fee, rounded down to the kobo", () => {
  assert.deepEqual(rules.unusedBonusRefund({ unusedPool: 9500, pool: 20000, platformFee: 6000 }), { pool: 9500, platformFee: 2850, amount: 12350 });
  assert.deepEqual(rules.unusedBonusRefund({ unusedPool: 333.33, pool: 1000, platformFee: 300 }), { pool: 333.33, platformFee: 99.99, amount: 433.32 });
  assert.deepEqual(rules.unusedBonusRefund({ unusedPool: 0, pool: 1000, platformFee: 300 }), { pool: 0, platformFee: 0, amount: 0 });
});

test("the unused pool is refundable once cancelled, at completion for views, 7 days after completion for conversions", () => {
  const completedAt = new Date(NOW.getTime() - DAY);
  assert.equal(rules.bonusRefundableFrom({ status: "live", hybridBonus: { metric: "views" } }), null);
  assert.ok(rules.bonusRefundableFrom({ status: "cancelled", hybridBonus: { metric: "signups" } }) <= NOW);
  assert.deepEqual(rules.bonusRefundableFrom({ status: "completed", completedAt, hybridBonus: { metric: "views" } }), completedAt);
  assert.deepEqual(rules.bonusRefundableFrom({ status: "completed", completedAt, hybridBonus: { metric: "signups" } }), new Date(completedAt.getTime() + 7 * DAY));
});
