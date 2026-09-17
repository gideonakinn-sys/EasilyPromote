// Campaign money reconciliation (ticket 09): paid in = payouts + owed + fee + refunds + pending
// refunds + left, per pot, to the kobo. The fee, per-creator payouts and content refunds are
// checked independently, so deliberately wrong ledgers must be reported.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reconcileCampaign } = require("../../src/utils/reconciliation");

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T12:00:00Z");
const row = (fields) => ({ bucket: "views", ...fields });

// 3 deliverables at ₦15,000 (fee ₦13,500): s1 and s2 delivered long ago by c1 and c2, s3 never
// submitted; one unused deliverable refunded; c1 paid, c2 in flight.
function contentFixture() {
  const campaign = {
    _id: "c1",
    name: "Lookbook",
    status: "completed",
    campaignModel: "content",
    budget: 58500,
    creatorPool: 45000,
    platformFee: 13500,
    platformFeePercent: 30,
    contentPay: { ratePerDeliverable: 15000, deliverables: 3 },
    fixedPay: {
      creditedSubmissions: ["s1", "s2"],
      credited: 30000,
      refundReservations: [{ refundId: "r1", deliverables: 1, creatorBudget: 15000, platformFee: 4500 }],
    },
  };
  const delivered = new Date(NOW.getTime() - 10 * DAY);
  const submissions = [
    { _id: "s1", creatorId: "u1", status: "completed", completedAt: delivered },
    { _id: "s2", creatorId: "u2", status: "completed", completedAt: delivered },
  ];
  const transactions = [
    row({ bucket: "fixed", type: "escrow_deposit", status: "escrow_deposit", amount: 58500, reference: "ep_1" }),
    row({ bucket: "fixed", type: "fixed_credit", status: "credited", amount: 15000, submissionId: "s1", creatorId: "u1" }),
    row({ bucket: "fixed", type: "fixed_credit", status: "credited", amount: 15000, submissionId: "s2", creatorId: "u2" }),
    row({ bucket: "fixed", type: "release", status: "released", amount: 15000, creatorId: "u1" }),
    row({ bucket: "fixed", type: "release", status: "escrow_deposit", amount: 15000, creatorId: "u2" }),
    row({ type: "transfer_fee", status: "released", amount: 25 }),
    row({
      _id: "r1",
      bucket: "fixed",
      type: "refund",
      status: "refunded",
      amount: 19500,
      reference: "refund_fixed_c1_1",
      refundBreakdown: { deliverables: 1, creatorBudget: 15000, platformFee: 4500 },
    }),
  ];
  return { campaign, submissions, transactions, now: NOW };
}

test("a content campaign balances: paid in = released + in flight + owed + fee + refunds + pending + left", () => {
  const result = reconcileCampaign(contentFixture());
  assert.deepEqual(result.problems, []);
  assert.equal(result.paidIn, 58500);
  assert.equal(result.released, 15000);
  assert.equal(result.inFlight, 15000);
  assert.equal(result.owed, 0);
  assert.equal(result.platformFee, 9000);
  assert.equal(result.refunds, 19500);
  assert.equal(result.pendingRefunds, 0);
  assert.equal(result.left, 0);
  assert.equal(result.transferFees, 25);
});

test("an extra release row is reported against the creator who was overpaid", () => {
  const fixture = contentFixture();
  fixture.transactions.push(row({ bucket: "fixed", type: "release", status: "released", amount: 15000, creatorId: "u1" }));
  const result = reconcileCampaign(fixture);
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /creator u1 was paid ₦30000, more than the ₦15000 credited/);
});

test("a release for pay still in its hold is reported", () => {
  const fixture = contentFixture();
  fixture.submissions[1].completedAt = new Date(NOW.getTime() - 2 * DAY);
  assert.match(reconcileCampaign(fixture).problems.join("\n"), /creator u2 was paid ₦15000, more than the ₦0/);
});

test("a refund larger than the unused budget is reported", () => {
  const fixture = contentFixture();
  const refund = fixture.transactions.find((t) => t.type === "refund");
  refund.amount = 39000;
  refund.refundBreakdown = { deliverables: 2, creatorBudget: 30000, platformFee: 9000 };
  fixture.campaign.fixedPay.refundReservations[0].deliverables = 2;
  const text = reconcileCampaign(fixture).problems.join("\n");
  assert.match(text, /2 deliverables refunded but only 1 are unused/);
});

test("a refund that doesn't follow the formula is reported", () => {
  const fixture = contentFixture();
  fixture.transactions.find((t) => t.type === "refund").amount = 19501;
  assert.match(reconcileCampaign(fixture).problems.join("\n"), /is ₦19501 but 1 unused deliverables refund ₦19500/);
});

test("a platform fee off by ₦1 is reported", () => {
  const fixture = contentFixture();
  fixture.campaign.platformFee = 13501;
  assert.match(reconcileCampaign(fixture).problems.join("\n"), /records a ₦13501 fee but 30% of the creator budget is ₦13500/);
});

test("rejected content still within its appeal window isn't unused, so refunding it is reported", () => {
  const fixture = contentFixture();
  fixture.submissions.push({ _id: "s3", creatorId: "u3", status: "rejected", appealableUntil: new Date(NOW.getTime() + DAY) });
  assert.match(reconcileCampaign(fixture).problems.join("\n"), /1 deliverables refunded but only 0 are unused/);
  fixture.submissions[2].appealableUntil = new Date(NOW.getTime() - DAY);
  assert.deepEqual(reconcileCampaign(fixture).problems, []);
});

test("failed content refunds are excluded; pending ones are reported separately", () => {
  const fixture = contentFixture();
  const refund = fixture.transactions.find((t) => t.type === "refund");
  refund.status = "refund_pending";
  let result = reconcileCampaign(fixture);
  assert.deepEqual(result.problems, []);
  assert.equal(result.pendingRefunds, 19500);
  assert.equal(result.refunds, 0);

  refund.status = "refund_failed";
  fixture.campaign.fixedPay.refundReservations = [];
  result = reconcileCampaign(fixture);
  assert.deepEqual(result.problems, []);
  assert.equal(result.failedRefunds, 19500);
  assert.equal(result.left, 15000, "the failed refund's budget is still in the pool");
  assert.equal(result.platformFee, 13500);
});

test("a voided credit needs its reversing row", () => {
  const fixture = contentFixture();
  fixture.transactions.push(row({ bucket: "fixed", type: "fixed_credit", status: "voided", amount: 15000, submissionId: "s9", creatorId: "u9" }));
  assert.match(reconcileCampaign(fixture).problems.join("\n"), /voided credit for submission s9 has no matching reversal/);
  fixture.transactions.push(row({ bucket: "fixed", type: "fixed_void", status: "voided", amount: 15000, submissionId: "s9" }));
  assert.deepEqual(reconcileCampaign(fixture).problems, []);
});

test("a content payment booked to the views pot is flagged", () => {
  const result = reconcileCampaign({
    campaign: { ...contentFixture().campaign, fixedPay: {} },
    transactions: [row({ type: "escrow_deposit", status: "escrow_deposit", amount: 58500 })],
  });
  assert.match(result.problems.join("\n"), /booked to the views pot/);
});

test("a views campaign balances; payouts beyond a creator's views earned and a wrong fee are flagged", () => {
  const campaign = { _id: "v1", status: "cancelled", budget: 430000, platformFee: 129000, creatorPool: 301000, platformFeePercent: 30 };
  const slots = [{ creatorId: "u1", kind: "views", reward: 1000, viewTarget: 10000 }];
  const submissions = [{ _id: "s1", creatorId: "u1", viewsDelivered: 10000 }];
  const transactions = [
    row({ type: "escrow_deposit", status: "escrow_deposit", amount: 430000 }),
    row({ type: "release", status: "released", amount: 1000, submissionId: "s1" }),
    row({ type: "release", status: "failed", amount: 999, creatorId: "u1" }),
    row({ type: "refund", status: "refunded", amount: 300000 }),
    row({ type: "unmatched_payment", status: "under_review", amount: 5000 }),
  ];
  const result = reconcileCampaign({ campaign, transactions, submissions, slots });
  assert.deepEqual(result.problems, []);
  assert.equal(result.platformFee, 129000);
  assert.equal(result.left, 0);
  assert.equal(result.unmatchedPayments, 5000);

  const overpaid = reconcileCampaign({ campaign, transactions: [...transactions, row({ type: "release", status: "released", amount: 1, creatorId: "u1" })], submissions, slots });
  assert.match(overpaid.problems.join("\n"), /creator u1 was paid ₦1001, more than the ₦1000 their views earned/);

  const wrongFee = reconcileCampaign({ campaign: { ...campaign, platformFee: 129001, creatorPool: 300999 }, transactions, submissions, slots });
  assert.match(wrongFee.problems.join("\n"), /records a ₦129001 fee but 30% of ₦430000 paid in is ₦129000/);
});

test("a referral pot balances with rewards reserved, paid, owed and the unused part refunded with its fee", () => {
  const campaign = {
    _id: "r1",
    status: "cancelled",
    budget: 0,
    platformFee: 0,
    creatorPool: 0,
    platformFeePercent: 30,
    referral: { budget: 50000, platformFee: 15000, pool: 35000, earned: 5000, poolRemaining: 0 },
  };
  const conversionEvents = [
    { creatorId: "u1", rewardAmount: 3000, voidedAt: null },
    { creatorId: "u2", rewardAmount: 2000, voidedAt: null },
    { creatorId: "u2", rewardAmount: 2000, voidedAt: new Date() },
  ];
  const transactions = [
    row({ bucket: "referral", type: "topup", status: "escrow_deposit", amount: 50000 }),
    row({ bucket: "referral", type: "release", status: "released", amount: 3000, creatorId: "u1" }),
    // 30,000 unused pool, grossed up by the 30% fee.
    row({ bucket: "referral", type: "refund", status: "refund_pending", amount: 42857.14 }),
  ];
  const result = reconcileCampaign({ campaign, transactions, conversionEvents });
  assert.deepEqual(result.problems, []);
  assert.equal(result.pots.referral.owed, 2000);
  assert.equal(result.pots.referral.platformFee, 2142.86);
  assert.equal(result.pendingRefunds, 42857.14);

  const overpaid = reconcileCampaign({
    campaign,
    transactions: [...transactions, row({ bucket: "referral", type: "release", status: "released", amount: 2500, creatorId: "u2" })],
    conversionEvents,
  });
  assert.match(overpaid.problems.join("\n"), /creator u2 was paid ₦2500, more than the ₦2000/);

  const bigRefund = reconcileCampaign({
    campaign,
    transactions: transactions.map((t) => (t.type === "refund" ? { ...t, amount: 45000 } : t)),
    conversionEvents,
  });
  assert.match(bigRefund.problems.join("\n"), /refunds ₦45000 don't match the unused pool/);
});

// Hybrid pay (ticket 10): 2 deliverables at ₦5,000 base (fee ₦3,000) and a ₦20,000 bonus pool (fee
// ₦6,000 on top), capped at ₦8,000 a creator. u1 reached the cap long ago and was paid; u2's ₦2,500 is
// still in its hold; the ₦9,500 left was refunded with its ₦2,850 fee once the campaign completed.
function hybridFixture() {
  const campaign = {
    _id: "h1",
    name: "Glow launch",
    status: "completed",
    campaignModel: "content",
    payShape: "hybrid",
    budget: 13000,
    creatorPool: 10000,
    platformFee: 3000,
    platformFeePercent: 30,
    contentPay: { ratePerDeliverable: 5000, deliverables: 2 },
    fixedPay: {},
    hybridBonus: {
      metric: "views",
      pool: 20000,
      platformFee: 6000,
      capPerCreator: 8000,
      ratePerThousandViews: 3010,
      poolRemaining: 0,
      reserved: 10500,
      refundedPool: 9500,
      creators: [
        { creatorId: "u1", earned: 8000 },
        { creatorId: "u2", earned: 2500 },
      ],
      pending: [],
      refundClaims: [{ pool: 9500, platformFee: 2850, amount: 12350 }],
    },
  };
  const longAgo = new Date(NOW.getTime() - 10 * DAY);
  const recently = new Date(NOW.getTime() - 2 * DAY);
  const transactions = [
    row({ bucket: "fixed", type: "escrow_deposit", status: "escrow_deposit", amount: 13000, reference: "ep_h1" }),
    row({ bucket: "bonus", type: "topup", status: "escrow_deposit", amount: 26000, feeAmount: 6000, reference: "ep_h1" }),
    row({ bucket: "bonus", type: "bonus_credit", status: "credited", amount: 5000, creatorId: "u1", reference: "bonus_views_h1_u1_500000", date: longAgo }),
    row({ bucket: "bonus", type: "bonus_credit", status: "credited", amount: 3000, creatorId: "u1", reference: "bonus_views_h1_u1_800000", date: longAgo }),
    row({ bucket: "bonus", type: "bonus_credit", status: "credited", amount: 2500, creatorId: "u2", reference: "bonus_conv_e1", date: recently }),
    row({ bucket: "bonus", type: "bonus_credit", status: "voided", amount: 2500, creatorId: "u2", reference: "bonus_conv_e0", date: recently }),
    row({ bucket: "bonus", type: "release", status: "released", amount: 8000, creatorId: "u1" }),
    row({ bucket: "bonus", type: "refund", status: "refunded", amount: 12350, reference: "refund_bonus_h1_1" }),
  ];
  return { campaign, transactions, now: NOW };
}

test("a hybrid campaign balances: base in the fixed pot, bonus credited, paid, owed and the unused pool refunded with its fee", () => {
  const result = reconcileCampaign(hybridFixture());
  assert.deepEqual(result.problems, []);
  assert.equal(result.paidIn, 39000);
  assert.deepEqual(result.pots.bonus, { paidIn: 26000, released: 8000, inFlight: 0, owed: 2500, platformFee: 3150, refunds: 12350, pendingRefunds: 0, left: 0 });
  assert.equal(result.pots.fixed.left, 10000);
});

test("hybrid: a bonus paid out during its hold, over the cap, or credited twice is reported", () => {
  const early = hybridFixture();
  early.transactions.push(row({ bucket: "bonus", type: "release", status: "escrow_deposit", amount: 2500, creatorId: "u2" }));
  assert.match(reconcileCampaign(early).problems.join("\n"), /creator u2 was paid ₦2500, more than the ₦0 credited in bonus past its hold/);

  const overCap = hybridFixture();
  overCap.campaign.hybridBonus.creators[0].earned = 8500;
  overCap.campaign.hybridBonus.reserved = 11000;
  overCap.transactions.push(row({ bucket: "bonus", type: "bonus_credit", status: "credited", amount: 500, creatorId: "u1", reference: "bonus_views_h1_u1_850000", date: new Date(NOW.getTime() - 9 * DAY) }));
  const overCapText = reconcileCampaign(overCap).problems.join("\n");
  assert.match(overCapText, /creator u1 was promised ₦8500, more than the ₦8000 cap/);
  assert.match(overCapText, /don't add up to the bonus pool/);

  const twice = hybridFixture();
  twice.transactions.push({ ...twice.transactions[4] });
  assert.match(reconcileCampaign(twice).problems.join("\n"), /credited more than once/);
});

test("hybrid: a refund that doesn't match its claim, a missing refund row and a wrong bonus fee are reported", () => {
  const wrongRefund = hybridFixture();
  wrongRefund.transactions.find((t) => t.type === "refund").amount = 12351;
  assert.match(reconcileCampaign(wrongRefund).problems.join("\n"), /refund rows total ₦12351 but the refund claims total ₦12350/);

  const unsent = hybridFixture();
  unsent.transactions = unsent.transactions.filter((t) => t.type !== "refund");
  const unsentResult = reconcileCampaign(unsent);
  assert.match(unsentResult.problems.join("\n"), /refund the unused bonus again/);
  assert.equal(unsentResult.pots.bonus.left, 12350, "money not yet sent back stays in the pot");

  const wrongFee = hybridFixture();
  wrongFee.campaign.hybridBonus.platformFee = 6001;
  assert.match(reconcileCampaign(wrongFee).problems.join("\n"), /records a ₦6001 fee but 30% of the bonus pool is ₦6000/);
});
