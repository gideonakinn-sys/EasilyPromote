// Clicks campaigns (M8, SPEC D29): a tracked link redirects to the brand's stored destination and pays
// the creator once per visitor per 24 hours from the referral budget. Bots, forged forwarding headers,
// simultaneous clicks and non-http destinations can't create extra paid clicks.
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

const REWARD = 100;
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

async function liveClicksCampaign() {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Store visits",
      category: "Tech",
      campaignObjective: "clicks",
      destinationUrl: "https://brand.example/shop",
      targetViews: 100000,
      referral: { requestedBudget: 50000 },
      creatorAccess: "open_call",
      brief: { summary: "Send followers to the shop" },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.equal(payment.body.status, "live", "no brand app connection needed for clicks");
  const admin = await harness.registerAdmin({ role: "finance_admin" });
  const reward = await harness.api("PATCH", `/api/admin/referrals/campaigns/${id}/reward`, { token: admin.token, body: { rewardPerConversion: REWARD } });
  assert.equal(reward.status, 200, JSON.stringify(reward.body));
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.ok(joined.body.referralCode);
  return { id, code: `${id}/${joined.body.referralCode}`, creator, referralCode: joined.body.referralCode };
}

function click(code, headers = {}) {
  return fetch(`${harness.baseUrl}/r/${code}`, { redirect: "manual", headers: { "user-agent": BROWSER, ...headers } });
}

async function earned(id) {
  const Campaign = require("../../src/models/Campaign");
  return (await Campaign.findById(id).lean()).referral.earned || 0;
}

test("a click redirects to the stored destination and pays once per visitor per day", async () => {
  const { id, code } = await liveClicksCampaign();
  const first = await click(code, { "cf-connecting-ip": "203.0.113.10" });
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"), "https://brand.example/shop");
  assert.equal(await earned(id), REWARD);

  const again = await click(code, { "cf-connecting-ip": "203.0.113.10" });
  assert.equal(again.status, 302);
  assert.equal(await earned(id), REWARD, "same visitor in the same day isn't paid twice");

  await click(code, { "cf-connecting-ip": "203.0.113.11" });
  assert.equal(await earned(id), 2 * REWARD, "a different visitor is paid");
});

test("bots, forged X-Forwarded-For and simultaneous clicks don't create extra paid clicks", async () => {
  const { id, code } = await liveClicksCampaign();
  await click(code, { "user-agent": "facebookexternalhit/1.1", "cf-connecting-ip": "198.51.100.1" });
  await click(code, { "user-agent": "WhatsApp/2.23", "cf-connecting-ip": "198.51.100.2" });
  assert.equal(await earned(id), 0, "link previews aren't paid");

  // Without Cloudflare's header, only the proxy-appended (last) forwarded address counts.
  await click(code, { "x-forwarded-for": "1.1.1.1, 192.0.2.50" });
  await click(code, { "x-forwarded-for": "2.2.2.2, 192.0.2.50" });
  assert.equal(await earned(id), REWARD, "forged first entries don't make a new visitor");

  await Promise.all(Array.from({ length: 8 }, () => click(code, { "cf-connecting-ip": "198.51.100.77" })));
  assert.equal(await earned(id), 2 * REWARD, "simultaneous clicks from one visitor pay once");
  const ConversionEvent = require("../../src/models/ConversionEvent");
  assert.equal(await ConversionEvent.countDocuments({ campaignId: id, eventType: "click" }), 2);
});

test("unknown codes 404, and a destination must be http or https", async () => {
  const unknown = await click("0123456789abcdef01234567/NOPE1234");
  assert.equal(unknown.status, 404);
  assert.equal((await click("not-an-id/NOPE")).status, 404);
  const brand = await harness.registerBrand();
  const bad = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Bad link", category: "Tech", campaignObjective: "clicks", destinationUrl: "javascript:alert(1)", targetViews: 100000, referral: { requestedBudget: 50000 } },
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
});

test("creators see a clicks campaign as a reward per click with its destination domain", async () => {
  const { id, creator, referralCode } = await liveClicksCampaign();
  const other = await harness.registerCreator();
  const market = await harness.api("GET", "/api/creators/dashboard", { token: other.token });
  assert.equal(market.status, 200);
  const card = market.body.marketplace.campaigns.find((c) => String(c.id) === id);
  assert.ok(card, "the campaign is listed");
  assert.deepEqual(card.pay, { amount: REWARD, unit: "click" });
  assert.equal(card.campaignObjective, "clicks");
  assert.equal(card.destinationDomain, "brand.example");
  assert.equal(card.usageRights.type, "standard", "usage terms reach the card so custom ones can be accepted before joining");

  const mine = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  const row = mine.body.campaigns.campaigns.find((c) => String(c.id) === id);
  assert.equal(row.campaignObjective, "clicks");
  assert.equal(row.destinationDomain, "brand.example");
  assert.equal(row.referral.code, referralCode);
});
