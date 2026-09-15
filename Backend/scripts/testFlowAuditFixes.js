// Automated unit tests for Flow Audit Fixes
const assert = require("assert");
const { escrowBalanceFrom } = require("../src/utils/escrow");
const { viewsForAmount } = require("../src/utils/topups");
const { campaignAcceptsConversions } = require("../src/services/conversions");

function runTests() {
  console.log("Running flow audit unit tests...\n");

  // Test 1: H2 - Escrow Balance Calculation
  // Budget = 100,000, Platform Fee = 30,000, Creator Pool = 70,000
  const mockTransactions = [
    { type: "escrow_deposit", status: "escrow_deposit", amount: 100000, bucket: "views" },
    { type: "release", status: "released", amount: 20000, bucket: "views" },
  ];

  // Without creatorPool cap (old behavior): 100k - 20k = 80k
  const oldBalance = escrowBalanceFrom(mockTransactions, "views", null);
  assert.strictEqual(oldBalance, 80000, "Old behavior should calculate 80000");

  // With creatorPool cap (new behavior): min(100k, 70k) - 20k = 50k
  const cappedBalance = escrowBalanceFrom(mockTransactions, "views", 70000);
  assert.strictEqual(cappedBalance, 50000, "Capped escrow should be 50,000 (pool minus released)");

  // With a refund: 50k - 10k refund = 40k
  const refundedTransactions = [
    ...mockTransactions,
    { type: "refund", amount: 10000, bucket: "views" },
  ];
  const balanceAfterRefund = escrowBalanceFrom(refundedTransactions, "views", 70000);
  assert.strictEqual(balanceAfterRefund, 40000, "Escrow balance should subtract refunds");
  console.log("✔ Test 1 passed: Escrow balance properly respects creatorPool and subtracts refunds (H2).");

  // Test 2: H7 - Views for Top-up Amount
  const campaign = {
    budget: 430000,
    targetViews: 100000,
    costPerView: 4.3,
  };
  const extraViews = viewsForAmount(campaign, 43000);
  assert.strictEqual(extraViews, 10000, "Top-up of 43,000 should buy 10,000 views");
  console.log("✔ Test 2 passed: Top-up views calculation is correct (H7).");

  // Test 3: H8 & H9 - Campaign accepts conversions
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  assert.strictEqual(
    campaignAcceptsConversions({ status: "live", referral: { enabled: false } }, now),
    false,
    "Disabled referral must not accept conversions"
  );
  assert.strictEqual(campaignAcceptsConversions({ status: "live", referral: { enabled: true } }, now), true);
  assert.strictEqual(
    campaignAcceptsConversions(
      { status: "completed", completedAt: new Date(now - 8 * day), updatedAt: new Date(now), referral: { enabled: true } },
      now
    ),
    false,
    "The grace window runs from completedAt, not a recently bumped updatedAt"
  );
  console.log("✔ Test 3 passed: Disabled referral and expired completed campaigns reject conversions (H8, H9).");

  console.log("\nAll unit verification checks PASSED successfully!");
}

runTests();
