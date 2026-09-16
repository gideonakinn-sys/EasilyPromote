// What a campaign pays per unit, as the marketplace card leads with it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { campaignTerms, payPerUnit } = require("../../src/utils/campaignPay");

test("a campaign saved before the campaign engine reads as views, performance, Open Call", () => {
  assert.deepEqual(campaignTerms({ objective: "views" }), {
    objective: "views",
    campaignModel: "performance",
    payShape: "performance",
    creatorAccess: "open_call",
  });
  assert.deepEqual(payPerUnit({}, { reward: 20000, viewTarget: 40000 }), { amount: 500, unit: "1,000 views" });
});

test("content pays the brand's rate per approved deliverable", () => {
  const campaign = { campaignObjective: "content", campaignModel: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 3 } };
  assert.deepEqual(payPerUnit(campaign, { reward: 15000 }), { amount: 15000, unit: "approved deliverable" });
});

test("referral campaigns pay the admin-set reward, or nothing yet", () => {
  const legacy = { objective: "actions", referral: { enabled: true, eventTypes: ["install"], rewardPerConversion: 250 } };
  assert.deepEqual(payPerUnit(legacy, { reward: 1, viewTarget: 1 }), { amount: 250, unit: "download" });
  const unset = { campaignObjective: "signups", referral: { enabled: true, eventType: "signup", rewardPerConversion: 0 } };
  assert.deepEqual(payPerUnit(unset, null), { amount: null, unit: "sign-up" });
});
