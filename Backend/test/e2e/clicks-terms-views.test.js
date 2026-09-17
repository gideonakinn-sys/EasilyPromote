// Brand and admin screens for clicks campaigns and custom usage-rights terms (M8, SPEC D29, D30):
// the fields those screens read are present.
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

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

test("brand referral codes, admin campaign detail and admin activity show clicks waiting and accepted terms", async () => {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Shop visits with terms",
      category: "Tech",
      campaignObjective: "clicks",
      destinationUrl: "https://brand.example/shop",
      targetViews: 100000,
      referral: { requestedBudget: 50000 },
      creatorAccess: "open_call",
      usageRights: { type: "custom", terms: { duration: "6_months", paidAdsAllowed: false, territories: ["Nigeria"] } },
      brief: { summary: "Send followers to the shop" },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });

  const campaign = await harness.api("GET", `/api/campaigns/${id}`, { token: brand.token });
  const version = campaign.body.usageRights.version;
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token, body: { usageRightsAccepted: { version } } });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));

  // No reward set yet: the click is recorded and waits for one.
  const res = await fetch(`${harness.baseUrl}/r/${id}/${joined.body.referralCode}`, {
    redirect: "manual",
    headers: { "user-agent": BROWSER, "cf-connecting-ip": "203.0.113.40" },
  });
  assert.equal(res.status, 302);

  const codes = await harness.api("GET", `/api/campaigns/${id}/referral-codes`, { token: brand.token });
  assert.equal(codes.status, 200, JSON.stringify(codes.body));
  assert.equal(codes.body.summary.waitingForReward, 1);
  assert.equal(codes.body.summary.waitingForBudget, 0);
  assert.equal(codes.body.codes[0].usageRightsAccepted.version, version);
  assert.ok(codes.body.codes[0].usageRightsAccepted.acceptedAt);

  const admin = await harness.registerAdmin();
  const detail = await harness.api("GET", `/api/admin/campaigns/${id}`, { token: admin.token });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.campaign.campaignObjective, "clicks");
  assert.equal(detail.body.campaign.destinationUrl, "https://brand.example/shop");
  assert.equal(detail.body.campaign.usageRights.type, "custom");
  assert.equal(detail.body.campaign.usageRights.terms.duration, "6_months");

  const activity = await harness.api("GET", `/api/admin/campaigns/${id}/activity`, { token: admin.token });
  assert.equal(activity.status, 200, JSON.stringify(activity.body));

  const clicks = await harness.api("GET", `/api/admin/referrals/conversions?eventType=click&campaignId=${id}`, { token: admin.token });
  assert.equal(clicks.status, 200, JSON.stringify(clicks.body));
  assert.equal(clicks.body.total, 1);
});
