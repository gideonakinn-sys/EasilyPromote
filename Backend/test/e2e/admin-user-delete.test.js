// Admin "Delete user" goes through the same account deletion as a user deleting themselves:
// payment and campaign records are kept (anonymised), never hard-deleted, and only super
// admins can do it.
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

async function paidViewsCampaignWithCreator() {
  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Kept books", category: "Music", targetViews: 100000 } });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  const claim = await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: created.body.id } });
  assert.equal(claim.status, 200);
  const sub = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: created.body.id, slotId: claim.body.id, videoUrl: "https://www.tiktok.com/@c/video/9", caption: "kept" },
  });
  assert.equal(sub.status, 201);
  return { brand, creator, campaignId: created.body.id };
}

test("only super admins can delete users", async () => {
  const creator = await harness.registerCreator();
  for (const role of ["support", "admin", "finance_admin"]) {
    const staff = await harness.registerAdmin({ role });
    const res = await harness.api("DELETE", `/api/admin/users/${creator.id}`, { token: staff.token });
    assert.equal(res.status, 403, role);
  }
});

test("deleting a creator keeps every payment record on their campaigns", async () => {
  const Transaction = require("../../src/models/Transaction");
  const Submission = require("../../src/models/Submission");
  const User = require("../../src/models/User");
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  const { creator, campaignId } = await paidViewsCampaignWithCreator();
  const before = await Transaction.countDocuments({ campaignId });
  assert.ok(before > 0);

  const res = await harness.api("DELETE", `/api/admin/users/${creator.id}`, { token: superAdmin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(await User.exists({ _id: creator.id }), null, "account removed");
  assert.equal(await Transaction.countDocuments({ campaignId }), before, "brand deposit and ledger kept");
  const sub = await Submission.findOne({ campaignId }).lean();
  assert.ok(sub, "submission kept");
  assert.equal(sub.creatorHandle, "deleted_creator", "anonymised");
});

test("a brand with active campaigns can't be deleted by an admin either", async () => {
  const Campaign = require("../../src/models/Campaign");
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  const { brand, campaignId } = await paidViewsCampaignWithCreator();

  const res = await harness.api("DELETE", `/api/admin/users/${brand.id}`, { token: superAdmin.token });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.blockers) && res.body.blockers.length > 0);
  assert.ok(await Campaign.exists({ _id: campaignId }), "campaign kept");
});
