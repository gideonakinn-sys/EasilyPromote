// Fixed pay calculations (ticket 09): when a credit can be withdrawn, and what an unused-budget
// refund returns. Amounts worked by hand from D2 (30% fee on top of the brand's rate).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixedCreditState, unusedBudgetRefund, canStillEarn, FIXED_HOLD_MS } = require("../../src/utils/fixedPayRules");

const DAY = 24 * 60 * 60 * 1000;

test("content that can still earn its pay: in progress, under appeal, or rejected within 7 days", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  for (const status of ["new", "changes_requested", "awaiting_delivery", "awaiting_receipt", "awaiting_post", "verifying", "appealed"]) {
    assert.equal(canStillEarn({ status }, now), true, status);
  }
  assert.equal(canStillEarn({ status: "rejected", appealableUntil: new Date(now.getTime() + DAY) }, now), true);
  assert.equal(canStillEarn({ status: "rejected", appealableUntil: new Date(now.getTime() - 1) }, now), false);
  assert.equal(canStillEarn({ status: "rejected" }, now), false, "an appeal decision closed it");
  assert.equal(canStillEarn({ status: "not_delivered" }, now), false);
});

test("voided pay can still be earned while its payout appeal is open or can still be filed (D23)", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  assert.equal(canStillEarn({ status: "not_delivered", voidAppealableUntil: new Date(now.getTime() + DAY) }, now), true);
  assert.equal(canStillEarn({ status: "not_delivered", voidAppealableUntil: new Date(now.getTime() - 1) }, now), false);
  assert.equal(canStillEarn({ status: "not_delivered", voidAppealableUntil: new Date(now.getTime() - DAY), voidAppealOpen: true }, now), true);
});

test("a credit waits for delivery, is held 7 days from completion, then is available", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  assert.equal(FIXED_HOLD_MS, 7 * DAY);
  assert.deepEqual(fixedCreditState({ status: "awaiting_receipt", completedAt: null }, now), { state: "awaiting_delivery", availableAt: null });
  assert.equal(fixedCreditState(null, now).state, "awaiting_delivery");

  const completedAt = new Date(now.getTime() - 3 * DAY);
  const held = fixedCreditState({ status: "completed", completedAt }, now);
  assert.equal(held.state, "on_hold");
  assert.equal(held.availableAt.getTime(), completedAt.getTime() + 7 * DAY);

  assert.equal(fixedCreditState({ status: "completed", completedAt: new Date(now.getTime() - 7 * DAY) }, now).state, "available");
  // Only completion counts, never a stray date on unfinished content.
  assert.equal(fixedCreditState({ status: "verifying", completedAt: new Date(0) }, now).state, "awaiting_delivery");
});

test("unused budget: deliverables neither credited, in progress nor refunded, plus their fee", () => {
  const base = { deliverables: 3, ratePerDeliverable: 15000, platformFee: 13500 };
  assert.deepEqual(unusedBudgetRefund({ ...base, credited: 2, inProgress: 0, refundedDeliverables: 0 }), {
    deliverables: 1,
    creatorBudget: 15000,
    platformFee: 4500,
    amount: 19500,
  });
  // Content still in progress isn't unused.
  assert.equal(unusedBudgetRefund({ ...base, credited: 1, inProgress: 1, refundedDeliverables: 0 }).deliverables, 1);
  // Nothing is refunded twice.
  assert.equal(unusedBudgetRefund({ ...base, credited: 2, inProgress: 0, refundedDeliverables: 1 }).amount, 0);
  // Nothing delivered: the whole payment back.
  assert.deepEqual(unusedBudgetRefund({ ...base, credited: 0, inProgress: 0, refundedDeliverables: 0 }), {
    deliverables: 3,
    creatorBudget: 45000,
    platformFee: 13500,
    amount: 58500,
  });
  assert.equal(unusedBudgetRefund({ ...base, credited: 5, inProgress: 0, refundedDeliverables: 0 }).amount, 0);
});

test("the fee on unused deliverables rounds down to the kobo, so refunds never exceed the fee charged", () => {
  // ₦333.33 × 3 with a 30% fee rounded to ₦300.00.
  const parts = [1, 1, 1].map((_, i) =>
    unusedBudgetRefund({ deliverables: 3, ratePerDeliverable: 333.33, platformFee: 300, credited: 0, inProgress: 2 - i, refundedDeliverables: i })
  );
  const fee = parts.reduce((sum, p) => sum + Math.round(p.platformFee * 100), 0);
  assert.ok(fee <= 30000);
  assert.deepEqual(parts.map((p) => p.platformFee), [100, 100, 100]);
  const odd = unusedBudgetRefund({ deliverables: 3, ratePerDeliverable: 1000, platformFee: 1000, credited: 2, inProgress: 0, refundedDeliverables: 0 });
  assert.equal(odd.platformFee, 333.33);
  assert.equal(odd.amount, 1333.33);
});
