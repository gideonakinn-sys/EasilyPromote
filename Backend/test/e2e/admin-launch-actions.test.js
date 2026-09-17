// Launch actions for the admin team (M7): completing a live or paused campaign closes its unclaimed
// places and makes a content campaign's unused budget refundable; money actions (paying and
// reviewing withdrawals, the payout run, the payout check, cancelling a paid campaign) are for
// finance admins and super admins; finance admins set sign-up rewards.
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

const FAKE_ID = "000000000000000000000000";
const model = (name) => require(`../../src/models/${name}`);

async function paidCampaign(body) {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { brand, id: created.body.id };
}

const contentCampaign = (creatorAccess = "open_call") =>
  paidCampaign({
    name: "Finish line",
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 15000, deliverables: 3 },
    contentDestination: "creator_page",
    creatorAccess,
    brief: { summary: "Style it" },
  });

const marketplaceHas = async (creator, id) => {
  const res = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  assert.equal(res.status, 200);
  return res.body.marketplace.campaigns.some((c) => String(c.id) === String(id));
};

test("Complete Campaign ends a live content campaign: places close, joins and applications stop, the brand is told and the refund opens", async () => {
  const Slot = model("Slot");
  const Notification = model("Notification");
  const AdminActivity = model("AdminActivity");
  const Campaign = model("Campaign");
  const { brand, id } = await contentCampaign();
  const joined = await harness.registerCreator();
  assert.equal((await harness.api("POST", `/api/campaigns/${id}/join`, { token: joined.token })).status, 200);
  const outsider = await harness.registerCreator();
  assert.equal(await marketplaceHas(outsider, id), true);

  const support = await harness.registerAdmin({ role: "support" });
  assert.equal((await harness.api("POST", `/api/admin/campaigns/${id}/complete`, { token: support.token })).status, 403);
  assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: support.token, body: { status: "completed" } })).status, 403, "support can't complete through the status route either");

  const admin = await harness.registerAdmin({ role: "admin" });
  // An alert link opens the campaign from its id alone, so the detail carries what the modal needs.
  const detail = await harness.api("GET", `/api/admin/campaigns/${id}`, { token: admin.token });
  assert.equal(detail.body.campaign.campaignModel, "content");
  assert.equal(typeof detail.body.campaign.progressPercent, "number");

  const completed = await harness.api("POST", `/api/admin/campaigns/${id}/complete`, { token: admin.token, body: { note: "Brand asked to wrap up" } });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, "completed");
  assert.equal(completed.body.closedPlaces, 2);

  const stored = await Campaign.findById(id).lean();
  assert.equal(stored.status, "completed");
  assert.ok(stored.completedAt);
  assert.equal(await Slot.countDocuments({ campaignId: id, status: "available" }), 0, "no open places left");
  assert.equal(await Slot.countDocuments({ campaignId: id, status: "claimed", creatorId: joined.id }), 1, "the creator keeps their place");

  assert.equal(await marketplaceHas(outsider, id), false);
  const join = await harness.api("POST", `/api/campaigns/${id}/join`, { token: outsider.token });
  assert.equal(join.status, 404);
  assert.equal(join.body.code, "CAMPAIGN_NOT_LIVE");

  const note = await Notification.findOne({ businessId: brand.id, campaignId: id, type: "campaign_completed" }).lean();
  assert.ok(note, "brand notified");
  assert.match(note.body, /unused/i);
  const activity = await AdminActivity.findOne({ targetId: id, action: "campaign.completed" }).lean();
  assert.ok(activity, "recorded");
  assert.equal(activity.metadata.closedPlaces, 2);

  // The unused budget is now refundable.
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const budget = await harness.api("GET", `/api/admin/campaigns/${id}/content-budget`, { token: finance.token });
  assert.equal(budget.status, 200, JSON.stringify(budget.body));
  assert.equal(budget.body.refundAllowed, true);
  assert.ok(budget.body.refundable.deliverables >= 2, JSON.stringify(budget.body.refundable));

  const again = await harness.api("POST", `/api/admin/campaigns/${id}/complete`, { token: admin.token });
  assert.equal(again.status, 409);
});

test("Complete Campaign works on paused campaigns and closes Application Required campaigns to applicants", async () => {
  const Campaign = model("Campaign");
  const { id } = await contentCampaign("application_required");
  await Campaign.updateOne({ _id: id }, { $set: { status: "paused" } });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const completed = await harness.api("POST", `/api/admin/campaigns/${id}/complete`, { token: finance.token });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  const creator = await harness.registerCreator();
  const applied = await harness.api("POST", `/api/campaigns/${id}/apply`, { token: creator.token, body: {} });
  assert.equal(applied.status, 404);
  assert.equal(applied.body.code, "CAMPAIGN_NOT_LIVE");

  // The status route completes the same way.
  const views = await paidCampaign({ name: "Views to finish", category: "Music", targetViews: 100000 });
  const superAdmin = await harness.registerAdmin({ role: "super_admin" });
  const viaStatus = await harness.api("PATCH", `/api/admin/campaigns/${views.id}/status`, { token: superAdmin.token, body: { status: "completed" } });
  assert.equal(viaStatus.status, 200, JSON.stringify(viaStatus.body));
  assert.equal(await model("Slot").countDocuments({ campaignId: views.id, status: "available" }), 0);
  assert.ok(await model("AdminActivity").exists({ targetId: views.id, action: "campaign.completed" }));

  const draft = await harness.api("POST", "/api/campaigns", { token: (await harness.registerBrand()).token, body: { name: "Draft", category: "Music", targetViews: 100000 } });
  assert.equal((await harness.api("POST", `/api/admin/campaigns/${draft.body.id}/complete`, { token: finance.token })).status, 409);
});

test("paying and reviewing withdrawals, the payout run, the payout check and cancelling a paid campaign are for finance and super admins", async () => {
  const moneyCalls = (token, campaignId) => [
    ["withdrawal review", () => harness.api("POST", `/api/admin/withdrawals/${FAKE_ID}/review`, { token, body: { approve: true } })],
    ["withdrawal reject", () => harness.api("POST", `/api/admin/withdrawals/${FAKE_ID}/review`, { token, body: { approve: false, adminNotes: "No" } })],
    ["payout run", () => harness.api("POST", "/api/admin/payout-run/approve", { token, body: { withdrawalIds: [FAKE_ID] } })],
    ["payout check", () => harness.api("POST", "/api/admin/payouts/reconcile", { token })],
    ["cancel paid campaign", () => harness.api("PATCH", `/api/admin/campaigns/${campaignId}/status`, { token, body: { status: "cancelled", note: "Brand request" } })],
  ];

  const { id } = await paidCampaign({ name: "Cancel me", category: "Music", targetViews: 100000 });
  for (const role of ["support", "admin"]) {
    const other = await harness.registerAdmin({ role });
    for (const [label, call] of moneyCalls(other.token, id)) {
      const res = await call();
      assert.equal(res.status, 403, `${role}: ${label} ${JSON.stringify(res.body)}`);
    }
    // Reading and non-money actions still work.
    assert.equal((await harness.api("GET", "/api/admin/withdrawals", { token: other.token })).status, 200);
    assert.equal((await harness.api("GET", "/api/admin/payout-run", { token: other.token })).status, 200);
    assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: other.token, body: { status: "paused", note: "Checking" } })).status, 200, `${role} can pause`);
    assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${id}/status`, { token: other.token, body: { status: "live" } })).status, 200, `${role} can resume`);
  }
  assert.equal((await model("Campaign").findById(id).lean()).status, "live", "not cancelled");

  // An unpaid campaign can still be cancelled by any admin role.
  const brand = await harness.registerBrand();
  const unpaid = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Unpaid", category: "Music", targetViews: 100000 } });
  const support = await harness.registerAdmin({ role: "support" });
  assert.equal((await harness.api("PATCH", `/api/admin/campaigns/${unpaid.body.id}/status`, { token: support.token, body: { status: "cancelled", note: "Spam" } })).status, 200);

  for (const role of ["finance_admin", "super_admin"]) {
    const allowed = await harness.registerAdmin({ role });
    const { id: campaignId } = await paidCampaign({ name: `Cancel by ${role}`, category: "Music", targetViews: 100000 });
    for (const [label, call] of moneyCalls(allowed.token, campaignId)) {
      const res = await call();
      assert.notEqual(res.status, 403, `${role}: ${label}`);
      assert.ok(res.status < 500, `${role}: ${label} ${res.status} ${JSON.stringify(res.body)}`);
    }
    assert.equal((await model("Campaign").findById(campaignId).lean()).status, "cancelled");
  }
});

test("the admin user list shows each creator's connected accounts and verification, for the Verify Creator action", async () => {
  const connected = await harness.registerCreator();
  const unconnected = await harness.registerCreator({ connected: false });
  const admin = await harness.registerAdmin({ role: "support" });
  const listed = async (creator) => {
    const res = await harness.api("GET", `/api/admin/users?role=creator&q=${encodeURIComponent(creator.email)}`, { token: admin.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.users.find((u) => String(u.id) === String(creator.id));
  };

  let row = await listed(connected);
  assert.deepEqual(row.creatorProfile.connectedAccounts, [{ platform: "tiktok", username: connected.username }]);
  assert.equal(row.creatorProfile.verifiedAt, null);
  const verified = await harness.api("PATCH", `/api/admin/creators/${connected.id}/verification`, { token: admin.token, body: { verified: true } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  row = await listed(connected);
  assert.ok(row.creatorProfile.verifiedAt);

  row = await listed(unconnected);
  assert.deepEqual(row.creatorProfile.connectedAccounts, []);
  const refused = await harness.api("PATCH", `/api/admin/creators/${unconnected.id}/verification`, { token: admin.token, body: { verified: true } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "SOCIAL_ACCOUNT_REQUIRED");
});

test("voiding a referral conversion returns money to the pool, so only finance and super admins can do it", async () => {
  for (const role of ["admin", "support"]) {
    const other = await harness.registerAdmin({ role });
    const res = await harness.api("POST", `/api/admin/referrals/conversions/${FAKE_ID}/void`, { token: other.token, body: { note: "Fake" } });
    assert.equal(res.status, 403, role);
  }
  for (const role of ["finance_admin", "super_admin"]) {
    const allowed = await harness.registerAdmin({ role });
    const res = await harness.api("POST", `/api/admin/referrals/conversions/${FAKE_ID}/void`, { token: allowed.token, body: { note: "Fake" } });
    assert.equal(res.status, 404, `${role}: ${JSON.stringify(res.body)}`);
  }
});

test("the admin campaign detail says whether the campaign has payments, as the cancel rule does", async () => {
  const admin = await harness.registerAdmin({ role: "support" });
  const { id } = await paidCampaign({ name: "Paid detail", category: "Music", targetViews: 100000 });
  assert.equal((await harness.api("GET", `/api/admin/campaigns/${id}`, { token: admin.token })).body.campaign.hasPayments, true);
  const brand = await harness.registerBrand();
  const draft = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Unpaid detail", category: "Music", targetViews: 100000 } });
  assert.equal((await harness.api("GET", `/api/admin/campaigns/${draft.body.id}`, { token: admin.token })).body.campaign.hasPayments, false);
});

test("finance admins set and change sign-up rewards; support can't", async () => {
  const BusinessProfile = model("BusinessProfile");
  const brand = await harness.registerBrand();
  const now = new Date();
  await BusinessProfile.updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Sign-ups", category: "Tech", campaignObjective: "signups", targetViews: 100000, referral: { requestedBudget: 50000 }, brief: { summary: "Sign up" } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });

  const url = `/api/admin/referrals/campaigns/${created.body.id}/reward`;
  const support = await harness.registerAdmin({ role: "support" });
  assert.equal((await harness.api("PATCH", url, { token: support.token, body: { rewardPerConversion: 500 } })).status, 403);
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const set = await harness.api("PATCH", url, { token: finance.token, body: { rewardPerConversion: 500 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const changed = await harness.api("PATCH", url, { token: finance.token, body: { rewardPerConversion: 750 } });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.previous, 500);
});
