// Campaign money reconciliation (ticket 09): paid in = payouts + owed + fee + refunds + left, per
// pot, to the kobo, with every broken check listed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reconcileCampaign } = require("../../src/utils/reconciliation");

const row = (fields) => ({ bucket: "views", ...fields });

function contentCampaign(overrides = {}) {
  return {
    _id: "c1",
    name: "Lookbook",
    status: "completed",
    campaignModel: "content",
    budget: 58500,
    creatorPool: 45000,
    platformFee: 13500,
    contentPay: { ratePerDeliverable: 15000, deliverables: 3 },
    fixedPay: {
      creditedSubmissions: ["s1", "s2"],
      credited: 30000,
      refundedDeliverables: 1,
      refundedCreatorBudget: 15000,
      refundedFee: 4500,
    },
    ...overrides,
  };
}

const contentLedger = () => [
  row({ bucket: "fixed", type: "escrow_deposit", status: "escrow_deposit", amount: 58500, reference: "ep_1" }),
  row({ bucket: "fixed", type: "fixed_credit", status: "credited", amount: 15000, submissionId: "s1" }),
  row({ bucket: "fixed", type: "fixed_credit", status: "credited", amount: 15000, submissionId: "s2" }),
  row({ bucket: "fixed", type: "release", status: "released", amount: 15000 }),
  row({ bucket: "fixed", type: "release", status: "escrow_deposit", amount: 15000 }),
  row({ type: "transfer_fee", status: "released", amount: 25 }),
  row({
    bucket: "fixed",
    type: "refund",
    status: "refund_pending",
    amount: 19500,
    reference: "refund_fixed_c1_1",
    refundBreakdown: { deliverables: 1, creatorBudget: 15000, platformFee: 4500 },
  }),
];

test("a content campaign balances: paid in = released + in flight + owed + fee + refunds + left", () => {
  const result = reconcileCampaign({ campaign: contentCampaign(), transactions: contentLedger() });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.paidIn, 58500);
  assert.equal(result.released, 15000);
  assert.equal(result.inFlight, 15000);
  assert.equal(result.owed, 0);
  assert.equal(result.platformFee, 9000);
  assert.equal(result.refunds, 19500);
  assert.equal(result.left, 0);
  assert.equal(result.transferFees, 25);
});

test("content campaign mismatches are listed: double credit, overpaid release, refund without its record", () => {
  const ledger = contentLedger();
  ledger.push(row({ bucket: "fixed", type: "fixed_credit", status: "credited", amount: 15000, submissionId: "s2" }));
  ledger.push(row({ bucket: "fixed", type: "release", status: "released", amount: 20000 }));
  const result = reconcileCampaign({
    campaign: contentCampaign({ fixedPay: { creditedSubmissions: ["s1", "s2"], credited: 30000 } }),
    transactions: ledger,
  });
  assert.equal(result.ok, false);
  const text = result.problems.join("\n");
  assert.match(text, /credited more than once/);
  assert.match(text, /credits in the ledger total ₦45000/);
  assert.match(text, /paid out ₦50000, more than the ₦45000 credited/);
  assert.match(text, /refunds ₦19500 don't match/);
});

test("a content payment booked to the views pot is flagged", () => {
  const result = reconcileCampaign({
    campaign: contentCampaign({ fixedPay: {} }),
    transactions: [row({ type: "escrow_deposit", status: "escrow_deposit", amount: 58500 })],
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /booked to the views pot/);
});

test("a views campaign balances, and a refund or payout beyond the pool is flagged", () => {
  const campaign = { _id: "v1", status: "cancelled", budget: 430000, platformFee: 129000, creatorPool: 301000 };
  const ledger = [
    row({ type: "escrow_deposit", status: "escrow_deposit", amount: 430000 }),
    row({ type: "release", status: "released", amount: 1000 }),
    row({ type: "release", status: "failed", amount: 999 }),
    row({ type: "refund", status: "refunded", amount: 300000 }),
    row({ type: "unmatched_payment", status: "under_review", amount: 5000 }),
  ];
  const result = reconcileCampaign({ campaign, transactions: ledger });
  assert.deepEqual(result.problems, []);
  assert.equal(result.paidIn, 430000);
  assert.equal(result.platformFee, 129000);
  assert.equal(result.left, 0);
  assert.equal(result.unmatchedPayments, 5000);

  ledger.push(row({ type: "release", status: "released", amount: 1 }));
  assert.match(reconcileCampaign({ campaign, transactions: ledger }).problems.join(), /exceed the creator pool/);
});

test("a referral pot balances with rewards reserved, paid, owed and the unused part refunded with its fee", () => {
  const campaign = {
    _id: "r1",
    status: "cancelled",
    budget: 0,
    platformFee: 0,
    creatorPool: 0,
    referral: { budget: 50000, platformFee: 15000, pool: 35000, earned: 5000, poolRemaining: 0 },
  };
  const ledger = [
    row({ bucket: "referral", type: "topup", status: "escrow_deposit", amount: 50000 }),
    row({ bucket: "referral", type: "release", status: "released", amount: 3000 }),
    // 30,000 unused pool, grossed up by the 30% fee.
    row({ bucket: "referral", type: "refund", status: "refund_pending", amount: 42857.14 }),
  ];
  const result = reconcileCampaign({ campaign, transactions: ledger, referralEarned: 5000 });
  assert.deepEqual(result.problems, []);
  assert.equal(result.pots.referral.owed, 2000);
  assert.equal(result.pots.referral.platformFee, 2142.86);

  const drifted = reconcileCampaign({ campaign, transactions: ledger, referralEarned: 6000 });
  assert.match(drifted.problems.join("\n"), /reserved ₦6000 but the campaign records ₦5000/);
});
