// Brand wizard v2 (ticket 03), review fixes: an open checkout keeps its price, quotes use the
// campaign's own fee, drafts keep what the brand hasn't changed, and content drafts can wait on pay.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  if (harness) await harness.stop();
});

const content = { name: "Lookbook", category: "Fashion", campaignObjective: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 4 } };

async function getCampaign(brand, id) {
  const res = await harness.api("GET", `/api/campaigns/${id}`, { token: brand.token });
  assert.equal(res.status, 200);
  return res.body;
}

test("opening checkout again keeps the open checkout's price, so paying the first tab still puts the campaign live", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Views", category: "Music", targetViews: 100000 } });
  const first = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(first.status, 200);
  // Priced under an older price table while the checkout was open.
  await Campaign.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(created.body.id) },
    { $set: { budget: 400000, platformFee: 120000, creatorPool: 280000, paymentAmount: 400000 } }
  );

  const second = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(second.status, 200);
  assert.equal(harness.paystack.charged(second.body.reference), 400000);

  const webhook = await harness.api("POST", "/api/webhooks/paystack", {
    body: { event: "charge.success", data: { reference: first.body.reference, amount: 400000 * 100, currency: "NGN", metadata: { campaignId: created.body.id } } },
  });
  assert.equal(webhook.status, 200);
  const campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.status, "live");
});

test("quoting an existing campaign uses that campaign's platform fee; other brands' campaigns can't be quoted", async () => {
  const Campaign = require("../../src/models/Campaign");
  const brand = await harness.registerBrand();
  const other = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: content });
  await Campaign.updateOne({ _id: created.body.id }, { $set: { platformFeePercent: 20 } });

  const quoted = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: { ...content, campaignId: created.body.id } });
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.deepEqual(quoted.body.quote, { creatorBudget: 60000, performanceBudget: 0, platformFee: 12000, total: 72000 });

  const pay = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(harness.paystack.charged(pay.body.reference), 72000);

  const notTheirs = await harness.api("POST", "/api/campaigns/quote", { token: other.token, body: { ...content, campaignId: created.body.id } });
  assert.equal(notTheirs.status, 404);
});

test("a content campaign pays for at most 100 deliverables", async () => {
  const brand = await harness.registerBrand();
  const tooMany = { ...content, contentPay: { ratePerDeliverable: 1000, deliverables: 101 } };
  for (const path of ["/api/campaigns", "/api/campaigns/quote"]) {
    const res = await harness.api("POST", path, { token: brand.token, body: tooMany });
    assert.equal(res.status, 400, path);
    assert.match(res.body.error, /100 deliverables/);
  }
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: content });
  const patched = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { contentPay: tooMany.contentPay } });
  assert.equal(patched.status, 400);
});

test("saving an older draft with its unchanged objective keeps its conversion types", async () => {
  const brand = await harness.registerBrand();
  for (const eventTypes of [["install", "purchase"], ["purchase"], ["signup", "deposit"]]) {
    const created = await harness.api("POST", "/api/campaigns", {
      token: brand.token,
      body: { name: "Older draft", category: "Tech", objective: "actions", targetViews: 100000, referral: { eventTypes, requestedBudget: 20000 } },
    });
    assert.equal(created.status, 201);
    const before = await getCampaign(brand, created.body.id);

    const saved = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, {
      token: brand.token,
      body: { name: "Renamed", campaignObjective: before.campaignObjective, targetViews: 100000, referral: { requestedBudget: 20000 } },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const after = await getCampaign(brand, created.body.id);
    assert.deepEqual(after.referral.eventTypes, eventTypes);
    assert.deepEqual([after.campaignObjective, after.objective, after.name], [before.campaignObjective, "actions", "Renamed"]);
  }
});

test("a content draft can be saved before its pay is set, but can't be paid for", async () => {
  const brand = await harness.registerBrand();
  const noPay = { name: "Pay later", category: "Beauty", campaignObjective: "content" };

  const quoted = await harness.api("POST", "/api/campaigns/quote", { token: brand.token, body: noPay });
  assert.equal(quoted.status, 200);
  assert.equal(quoted.body.quote, null);

  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: noPay });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.quote, null);
  let campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.budget, campaign.creatorPool, campaign.platformFee, campaign.contentPay], [0, 0, 0, null]);

  const pay = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(pay.status, 400);
  assert.equal(pay.body.code, "CONTENT_PAY_REQUIRED");
  assert.match(pay.body.error, /Set what creators earn per deliverable/);

  // Setting pay prices it; clearing it again unprices it.
  await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { contentPay: { ratePerDeliverable: 15000, deliverables: 4 } } });
  campaign = await getCampaign(brand, created.body.id);
  assert.equal(campaign.budget, 78000);
  const cleared = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { contentPay: null } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  campaign = await getCampaign(brand, created.body.id);
  assert.deepEqual([campaign.budget, campaign.contentPay], [0, null]);
});

test("a draft remembers the wizard step the brand was on", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { ...content, wizardStep: 2 } });
  assert.equal((await getCampaign(brand, created.body.id)).wizardStep, 2);

  const saved = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { wizardStep: 5 } });
  assert.equal(saved.status, 200);
  assert.equal((await getCampaign(brand, created.body.id)).wizardStep, 5);

  const invalid = await harness.api("PATCH", `/api/campaigns/${created.body.id}`, { token: brand.token, body: { wizardStep: 9 } });
  assert.equal(invalid.status, 400);
});

test("paying a content campaign labels the checkout amount as the campaign's, not views", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: content });
  const Campaign = require("../../src/models/Campaign");
  const campaign = await Campaign.findById(created.body.id).lean();
  const pay = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(pay.status, 200);
  assert.equal(harness.paystack.metadata(pay.body.reference).campaignAmount, campaign.budget);
  assert.equal(harness.paystack.metadata(pay.body.reference).viewsAmount, undefined);
});
