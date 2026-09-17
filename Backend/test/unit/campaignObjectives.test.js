const { test } = require("node:test");
const assert = require("node:assert/strict");
const { objectiveForLegacy } = require("../../src/utils/campaignObjectives");

test("campaigns from before the campaign engine map to the objective their settings stand for", () => {
  const cases = [
    [{ objective: "views" }, "views"],
    [{ objective: undefined }, "views"],
    [{ objective: "actions", referral: { eventType: "signup" } }, "signups"],
    [{ objective: "actions", referral: { eventTypes: ["install"] } }, "downloads"],
    [{ objective: "actions", referral: { eventTypes: ["install", "signup"] } }, "signups"],
    [{ objective: "actions", referral: { eventTypes: ["purchase"] } }, "sales"],
    [{ objective: "actions", referral: { eventTypes: ["deposit"] } }, "sales"],
    [{ objective: "actions", referral: { eventTypes: ["custom"] } }, "other"],
    [{ objective: "actions", referral: {} }, "signups"],
  ];
  for (const [campaign, expected] of cases) {
    assert.equal(objectiveForLegacy(campaign), expected, JSON.stringify(campaign));
  }
});
