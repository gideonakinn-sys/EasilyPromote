// Today's views campaign, end to end through the HTTP API. Every campaign-engine ticket
// must keep this passing: it's the proof that live campaigns still work.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startHarness } = require("./harness");

let h;

before(async () => {
  h = await startHarness();
});

after(async () => {
  await h.stop();
});

test("a brand pays for a views campaign and approves a creator's content", async () => {
  const brand = await h.registerBrand();
  const creator = await h.registerCreator({ niches: ["Music"] });

  const created = await h.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Afrobeats launch",
      category: "Music",
      targetViews: 100000,
      contentBrief: "Dance to the new single",
      platforms: ["tiktok"],
      niches: ["Music"],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "draft");

  const checkout = await h.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200);
  assert.equal(h.paystack.charged(checkout.body.reference), created.body.budget);

  h.paystack.markPaid(checkout.body.reference);
  const payment = await h.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  assert.equal(payment.status, 200);
  assert.deepEqual(payment.body, { status: "live", isPaid: true });

  const claim = await h.api("POST", "/api/slots/claim", {
    token: creator.token,
    body: { campaignId: created.body.id },
  });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.status, "claimed");
  assert.ok(claim.body.reward > 0);

  const submitted = await h.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: created.body.id, slotId: claim.body.id, videoUrl: "https://www.tiktok.com/@creator/video/1", caption: "New single out now" },
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.body.status, "new");

  const approved = await h.api("PATCH", `/api/submissions/${submitted.body.id}/approve`, { token: brand.token });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, "awaiting_post");
});

test("a campaign stays unpaid when Paystack reports a different amount", async () => {
  const brand = await h.registerBrand();
  const created = await h.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Underpaid", category: "Music", targetViews: 100000 },
  });
  const checkout = await h.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });

  h.paystack.markPaid(checkout.body.reference, { amount: created.body.budget - 1 });
  const payment = await h.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });

  assert.deepEqual(payment.body, { status: "pending_payment", isPaid: false });
});
