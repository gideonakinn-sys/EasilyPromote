// Brand wizard v2 checkout (ticket 03): the wizard's quote and what checkout charges come from
// one calculator, for content, views and sign-ups campaigns alike.
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

const content = {
  name: "Summer lookbook",
  category: "Fashion",
  campaignObjective: "content",
  contentPay: { ratePerDeliverable: 15000, deliverables: 4 },
  contentDestination: "brand_page",
  creatorAccess: "open_call",
};
const views = { name: "Afrobeats launch", category: "Music", campaignObjective: "views", targetViews: 100000 };
const signups = { name: "App launch", category: "Tech", campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000 } };

// Marks the brand's app as connected, as its server's code check and test conversion would.
async function connectBrandApp(brand) {
  const BusinessProfile = require("../../src/models/BusinessProfile");
  const now = new Date();
  await BusinessProfile.updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

test("the wizard's quote matches what creating the campaign prices, without saving anything", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const before = await Campaign.countDocuments();

  for (const body of [content, views, signups]) {
    const quoted = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body });
    assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
    const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
    assert.deepEqual(quoted.body.quote, created.body.quote, body.name);
  }
  assert.equal(await Campaign.countDocuments(), before + 3);

  const quoteOnly = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: content });
  assert.deepEqual(quoteOnly.body.quote, { creatorBudget: 60000, performanceBudget: 0, platformFee: 18000, total: 78000 });
  assert.equal(await Campaign.countDocuments(), before + 3);
});

test("the quote refuses what the brand can't set and incomplete pay, and is for brands only", async () => {
  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();

  const rate = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: { ...views, costPerView: 1 } });
  assert.equal(rate.status, 400);
  assert.equal(rate.body.code, "RATE_NOT_BRAND_SET");

  const noPay = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: { ...content, contentPay: undefined } });
  assert.equal(noPay.status, 400);
  assert.ok(noPay.body.error);

  const asCreator = await harness.api("POST", "/api/campaigns/quote", { token: creator.token, body: content });
  assert.equal(asCreator.status, 403);
});

test("a brand pays for a content, a views and a sign-ups campaign; each charge matches the calculator to the kobo", async () => {
  const Slot = require("../../src/models/Slot");
  const Transaction = require("../../src/models/Transaction");
  const brand = await harness.registerBrand();

  for (const body of [content, views, signups]) {
    const quoted = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body });
    const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;

    if (body === signups) {
      const blocked = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body.code, "INTEGRATION_REQUIRED");
      await connectBrandApp(brand);
    }

    const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
    assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
    const charged = harness.paystack.charged(checkout.body.reference);
    assert.equal(Math.round(charged * 100), Math.round(quoted.body.quote.total * 100), body.name);

    harness.paystack.markPaid(checkout.body.reference);
    const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
    assert.deepEqual(payment.body, { status: "live", isPaid: true }, body.name);

    const deposits = await Transaction.find({ campaignId: id, reference: checkout.body.reference }).lean();
    const booked = deposits.reduce((sum, t) => sum + t.amount, 0);
    assert.equal(Math.round(booked * 100), Math.round(quoted.body.quote.total * 100), `${body.name} booked`);

    if (body === content) {
      const slots = await Slot.find({ campaignId: id }).lean();
      assert.equal(slots.length, 4);
      assert.ok(slots.every((slot) => slot.kind === "deliverable" && slot.reward === 15000));
    }
  }
});

test("a paid content campaign also goes live from Paystack's webhook", async () => {
  const Slot = require("../../src/models/Slot");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: content });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });

  const webhook = await harness.api("POST", "/api/webhooks/paystack", {
    body: {
      event: "charge.success",
      data: { reference: checkout.body.reference, amount: 78000 * 100, currency: "NGN", metadata: { campaignId: created.body.id } },
    },
  });
  assert.equal(webhook.status, 200);

  const campaign = await harness.api("GET", `/api/campaigns/${created.body.id}`, { token: brand.token });
  assert.equal(campaign.body.status, "live");
  assert.equal(await Slot.countDocuments({ campaignId: created.body.id, kind: "deliverable" }), 4);
});

test("a draft priced before today's price table is charged today's quote", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: views });
  await Campaign.collection.updateOne(
    { _id: new (require("mongoose").Types.ObjectId)(created.body.id) },
    { $set: { budget: 400000, platformFee: 120000, creatorPool: 280000 } }
  );

  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(harness.paystack.charged(checkout.body.reference), 430000);
  const stored = await Campaign.findById(created.body.id).lean();
  assert.deepEqual([stored.budget, stored.creatorPool, stored.paymentAmount], [430000, 301000, 430000]);
});

test("views top-ups refuse content campaigns", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: content });
  await Campaign.updateOne({ _id: created.body.id }, { $set: { status: "live" } });

  const init = await harness.api("POST", `/api/campaigns/${created.body.id}/topup-init`, { token: brand.token, body: { amount: 50000 } });
  assert.equal(init.status, 409);
  assert.equal(init.body.code, "TOPUP_NOT_FOR_CONTENT");
  assert.match(init.body.error, /content/i);

  const credit = await harness.api("PATCH", `/api/campaigns/${created.body.id}/topup`, { token: brand.token, body: { amount: 50000, paystackReference: "ref_x" } });
  assert.equal(credit.status, 409);
  assert.equal(credit.body.code, "TOPUP_NOT_FOR_CONTENT");
});
