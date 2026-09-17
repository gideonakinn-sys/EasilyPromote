// Retrying failed refunds from the admin panel (D23): a views, referral or bonus refund Paystack
// refused, or one a crash left unsent, is retried from its own row by finance or super admins. A retry
// takes the row's send lock, checks Paystack's own refunds first and never refunds twice; the books
// balance before and after.
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

const DAY = 24 * 60 * 60 * 1000;
const model = (name) => require(`../../src/models/${name}`);
const paystackModule = () => require("../../src/services/paystack");

async function connectBrandApp(brand) {
  const now = new Date();
  await model("BusinessProfile").updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

// A paid, live sign-up campaign: a views pot and a referral pot.
async function liveSignupCampaign() {
  const brand = await harness.registerBrand();
  await connectBrandApp(brand);
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Retry launch",
      category: "Tech",
      campaignObjective: "signups",
      targetViews: 100000,
      referral: { requestedBudget: 50000 },
      creatorAccess: "open_call",
      brief: { summary: "Get your followers to sign up" },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { brand, id, reference: checkout.body.reference };
}

async function assertBalanced(campaignId) {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const result = await reconcileCampaignById(campaignId);
  assert.ok(result.ok, JSON.stringify(result.problems));
  return result;
}

const retry = (who, refundId) => harness.api("POST", `/api/admin/refunds/${refundId}/retry`, { token: who.token });

test("a views and a referral refund Paystack refused are retried by finance, once, and the books balance", async () => {
  const { brand, id, reference } = await liveSignupCampaign();
  const paystack = paystackModule();
  const original = paystack.createRefund;
  paystack.createRefund = async () => {
    throw new Error("Paystack is down");
  };
  try {
    const cancelled = await harness.api("PATCH", `/api/campaigns/${id}/cancel`, { token: brand.token });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  } finally {
    paystack.createRefund = original;
  }
  const rows = await model("Transaction").find({ campaignId: id, type: "refund" }).sort({ bucket: 1 }).lean();
  assert.deepEqual(rows.map((r) => [r.bucket, r.status]), [["referral", "refund_failed"], ["views", "refund_failed"]]);
  assert.match(rows[0].adminNotes, /Retry it from the admin panel/);
  assert.equal(harness.paystack.refunds(reference).length, 0);
  const before = await assertBalanced(id);

  // Listed for admin as failed and retryable.
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const listed = await harness.api("GET", "/api/admin/refunds?state=attention", { token: finance.token });
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const mine = listed.body.refunds.filter((r) => String(r.campaignId) === id);
  assert.deepEqual(mine.map((r) => [r.pot, r.state, r.retryable]).sort(), [["referral", "failed", true], ["views", "failed", true]]);

  // Roles that don't move money can see it but not retry it.
  for (const role of ["admin", "support"]) {
    assert.equal((await retry(await harness.registerAdmin({ role }), rows[1]._id)).status, 403, role);
  }

  // Three retries of the views refund at once send it once.
  let calls = 0;
  paystack.createRefund = async (args) => {
    calls += 1;
    return original(args);
  };
  try {
    const results = await Promise.all([1, 2, 3].map(() => retry(finance, rows[1]._id)));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
    assert.ok(results.filter((r) => r.status !== 200).every((r) => ["REFUND_IN_PROGRESS", "NOT_RETRYABLE"].includes(r.body.code)), JSON.stringify(results.map((r) => r.body)));
  } finally {
    paystack.createRefund = original;
  }
  assert.equal(calls, 1);
  const views = await model("Transaction").findById(rows[1]._id).lean();
  assert.equal(views.status, "refund_pending");
  assert.equal(views.adminNotes, null);
  assert.ok(views.refundParts[0].sentAt && views.refundParts[0].paystackRefundId);
  assert.equal((await retry(finance, rows[1]._id)).body.code, "NOT_RETRYABLE");

  const referral = await retry(await harness.registerAdmin({ role: "super_admin" }), rows[0]._id);
  assert.equal(referral.status, 200, JSON.stringify(referral.body));
  assert.equal(referral.body.refund.state, "sent");
  assert.deepEqual(harness.paystack.refunds(reference).map((r) => r.amount).sort((a, b) => a - b), [rows[0].amount, rows[1].amount].sort((a, b) => a - b));
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, type: "refund" }), 2, "retried from the same rows");

  // Retries never change the books: the rows counted as the brand's money all along.
  const after = await assertBalanced(id);
  assert.equal(after.pendingRefunds, before.pendingRefunds);
  assert.ok(await model("AdminActivity").exists({ action: "refund.retried", targetId: id }));
});

test("a views refund Paystack accepted just before a crash is adopted on retry, never sent twice", async () => {
  const { brand, id, reference } = await liveSignupCampaign();
  const { bucketRefundHooks } = require("../../src/utils/refunds");
  let crashes = 0;
  bucketRefundHooks.afterPaystackAccepted = () => {
    crashes += 1;
    throw new Error("simulated crash after Paystack accepted");
  };
  try {
    assert.equal((await harness.api("PATCH", `/api/campaigns/${id}/cancel`, { token: brand.token })).status, 500);
  } finally {
    bucketRefundHooks.afterPaystackAccepted = null;
  }
  assert.equal(crashes, 1);
  // The views refund is sent first; the crash stops the cancel before the referral refund.
  const [viewsRow] = await model("Transaction").find({ campaignId: id, type: "refund", bucket: "views" }).lean();
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, type: "refund" }), 1);
  assert.equal(harness.paystack.refunds(reference).length, 1, "Paystack has the views refund");

  // The crashed request still holds the row, so a retry right away is refused.
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  assert.equal((await retry(finance, viewsRow._id)).body.code, "REFUND_IN_PROGRESS");
  await model("Transaction").updateOne({ _id: viewsRow._id }, { $set: { refundSendingUntil: new Date(Date.now() - 1000) } });
  const listed = (await harness.api("GET", "/api/admin/refunds?state=not_sent", { token: finance.token })).body.refunds;
  assert.ok(listed.some((r) => String(r.id) === String(viewsRow._id)));

  const retried = await retry(finance, viewsRow._id);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(harness.paystack.refunds(reference).length, 1, "adopted, not sent again");
  const stored = await model("Transaction").findById(viewsRow._id).lean();
  assert.equal(stored.refundParts[0].paystackRefundId, String(harness.paystack.refunds(reference)[0].id));
});

test("a failed bonus refund is retried from the campaign's bonus panel; a part with no payment must be refunded by hand", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Bonus retry",
      category: "Beauty",
      campaignObjective: "content",
      payShape: "hybrid",
      contentPay: { ratePerDeliverable: 5000, deliverables: 1 },
      hybridBonus: { metric: "views", pool: 10000, capPerCreator: 5000 },
      contentDestination: "creator_page",
      creatorAccess: "open_call",
      brief: { summary: "Glow" },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: finance.token, body: { status: "completed" } })).status, 200);

  const paystack = paystackModule();
  const original = paystack.createRefund;
  paystack.createRefund = async () => {
    throw new Error("Refund declined");
  };
  try {
    const failed = await harness.api("POST", `/api/admin/campaigns/${id}/refund-unused-bonus`, { token: finance.token, body: { expectedAmount: 13000 } });
    assert.equal(failed.status, 502, JSON.stringify(failed.body));
  } finally {
    paystack.createRefund = original;
  }
  let budget = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: finance.token });
  let [bonusRefund] = budget.body.bonus.refunds;
  assert.equal(bonusRefund.state, "failed");
  assert.equal(bonusRefund.retryable, true);
  await model("Transaction").updateOne({ _id: bonusRefund.id }, { $set: { refundSendingUntil: null } });

  const retried = await retry(finance, bonusRefund.id);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  budget = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: finance.token });
  [bonusRefund] = budget.body.bonus.refunds;
  assert.equal(bonusRefund.state, "sent");
  assert.equal(bonusRefund.retryable, false);
  assert.ok(budget.body.reconciliation.ok, JSON.stringify(budget.body.reconciliation.problems));

  // A refund part with no Paystack payment can't be retried.
  const orphan = await model("Transaction").create({
    campaignId: id,
    type: "refund",
    bucket: "bonus",
    amount: 1,
    status: "refund_failed",
    reference: `refund_orphan_${id}`,
    refundParts: [{ chargeReference: null, amount: 1, status: "failed", error: "No Paystack payment on record to refund against" }],
    date: new Date(Date.now() - DAY),
  });
  const byHand = await retry(finance, orphan._id);
  assert.equal(byHand.status, 409);
  assert.equal(byHand.body.code, "REFUND_BY_HAND");
  await model("Transaction").deleteOne({ _id: orphan._id });
});
