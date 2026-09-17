// Launch matrix (M7): every combination that can go live at launch, end to end through the HTTP API.
// For each one: the brand creates and pays, the campaign goes live, a creator joins (Open Call) or
// applies and is approved (Application Required), does the delivery that objective pays for, the pay
// becomes withdrawable (holds moved with the same fixtures the other suites use), an admin pays the
// withdrawal, and the campaign's books reconcile to the kobo.
//
// Enabled at launch (D14): objective content | views | signups | downloads × access open_call |
// application_required, and for content also destination creator_page | brand_page | both.
// Not in the matrix: destination on performance objectives (they have no deliverable, so it's always
// creator_page), Hybrid pay and the "Coming soon" objectives (engagement, leads, sales, other) —
// creating those is refused.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startHarness } = require("./harness");

let harness;
let admin;
let brands;
const creatorPool = [];

const DAY = 24 * 60 * 60 * 1000;
const RATE = 15000;
const REWARD = 2500;
const brief = { summary: "Show the product in use", hashtags: ["#LaunchDay"] };

const model = (name) => require(`../../src/models/${name}`);

async function connectBrandApp(brand) {
  const now = new Date();
  await model("BusinessProfile").updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } },
    { upsert: true }
  );
}

before(async () => {
  harness = await startHarness();
  admin = await harness.registerAdmin({ role: "finance_admin" });
  // One brand for content and views, one with a connected app and signing key for sign-ups and downloads.
  const plain = await harness.registerBrand();
  const referral = await harness.registerBrand();
  await connectBrandApp(referral);
  const key = await harness.api("POST", "/api/referral/keys", { token: referral.token, body: { name: "Server" } });
  assert.equal(key.status, 201, JSON.stringify(key.body));
  brands = { plain, referral: { ...referral, key: { keyId: key.body.key.keyId, secret: key.body.secret } } };
});

after(async () => {
  if (harness) await harness.stop();
});

// Creators are shared across combinations; each holds at most 3 active placements, so every
// creator takes two combinations.
async function creatorFor(index) {
  const slot = Math.floor(index / 2);
  if (!creatorPool[slot]) {
    const creator = await harness.registerCreator();
    const bank = await harness.api("POST", "/api/creators/bank-account", {
      token: creator.token,
      body: { accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" },
    });
    assert.equal(bank.status, 200, JSON.stringify(bank.body));
    creatorPool[slot] = creator;
  }
  return creatorPool[slot];
}

function campaignBody({ objective, access, destination }) {
  const base = { name: `Launch ${objective} ${access} ${destination || ""}`.trim(), creatorAccess: access, campaignObjective: objective, brief };
  if (objective === "content") {
    return { ...base, category: "Fashion", contentDestination: destination, contentPay: { ratePerDeliverable: RATE, deliverables: 2 } };
  }
  if (objective === "views") return { ...base, category: "Music", targetViews: 100000, niches: ["Music"] };
  return { ...base, category: "Tech", targetViews: 100000, referral: { requestedBudget: 50000 } };
}

async function createAndPay(combo) {
  const brand = ["signups", "downloads"].includes(combo.objective) ? brands.referral : brands.plain;
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body: campaignBody(combo) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });

  const stored = await model("Campaign").findById(id).lean();
  assert.equal(stored.campaignObjective, combo.objective);
  assert.equal(stored.creatorAccess, combo.access);
  if (combo.destination) assert.equal(stored.contentDestination, combo.destination);
  if (combo.objective === "signups") assert.deepEqual(stored.referral.eventTypes, ["signup"]);
  if (combo.objective === "downloads") assert.deepEqual(stored.referral.eventTypes, ["install"]);
  return { brand, id };
}

// Open Call joins; Application Required applies and the brand approves. Returns the placement.
async function takePlace({ brand, id, creator, access }) {
  if (access === "open_call") {
    const refused = await harness.api("POST", `/api/campaigns/${id}/apply`, { token: creator.token, body: {} });
    assert.equal(refused.status, 409, "Open Call campaigns can't be applied to");
    const joined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    return { id: joined.body.id, referralCode: joined.body.referralCode, reward: joined.body.reward };
  }
  const direct = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.notEqual(direct.status, 200, "Application Required campaigns can't be joined directly");
  const applied = await harness.api("POST", `/api/campaigns/${id}/apply`, { token: creator.token, body: { pitch: "Pick me" } });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const approved = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return { id: approved.body.placement.id, referralCode: approved.body.placement.referralCode, reward: approved.body.placement.reward };
}

const patch = (path, token, body) => harness.api("PATCH", path, { token, body });

async function deliverContent({ brand, id, creator, destination }) {
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: id, videoUrl: "https://drive.example.com/cut-1.mp4", caption: "Launch day #LaunchDay" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const submissionId = submitted.body.id;
  const expectOk = async (res) => assert.equal((await res).status, 200, JSON.stringify((await res).body));

  await expectOk(patch(`/api/submissions/${submissionId}/approve`, brand.token));
  if (destination !== "creator_page") {
    await expectOk(patch(`/api/submissions/${submissionId}/deliver`, creator.token, { url: "https://drive.example.com/final.mp4", acceptUsageRights: true }));
    await expectOk(patch(`/api/submissions/${submissionId}/confirm-receipt`, brand.token));
  }
  if (destination !== "brand_page") {
    await expectOk(
      patch(`/api/submissions/${submissionId}/mark-posted`, creator.token, {
        posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }],
        caption: "#LaunchDay",
      })
    );
    await expectOk(patch(`/api/submissions/${submissionId}/confirm-post`, brand.token));
  }

  const submission = await model("Submission").findById(submissionId).lean();
  assert.equal(submission.status, "completed");
  const credits = await model("Transaction").find({ campaignId: id, type: "fixed_credit", status: "credited" }).lean();
  assert.equal(credits.length, 1, "fixed pay credited once");
  assert.equal(credits[0].amount, RATE);
  // The 7-day hold is over.
  await model("Submission").updateOne({ _id: submissionId }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  return { part: "fixedAmount", amount: RATE };
}

async function deliverViews({ brand, id, creator, placement }) {
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId: id, slotId: placement.id, videoUrl: "https://www.tiktok.com/@c/video/9", caption: "New song" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const approved = await patch(`/api/submissions/${submitted.body.id}/approve`, brand.token);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "awaiting_post");
  // Views come from the platform sync; the fixture records them directly.
  const slot = await model("Slot").findById(placement.id).lean();
  await model("Submission").updateOne({ _id: submitted.body.id }, { $set: { viewsDelivered: slot.viewTarget } });
  return { part: "viewsAmount", amount: slot.reward };
}

let eventCounter = 0;
async function deliverConversion({ id, placement, objective }) {
  assert.ok(placement.referralCode, "a referral code is handed out with the place");
  const reward = await harness.api("PATCH", `/api/admin/referrals/campaigns/${id}/reward`, {
    token: (await adminWhoSetsRewards()).token,
    body: { rewardPerConversion: REWARD },
  });
  assert.equal(reward.status, 200, JSON.stringify(reward.body));

  const { buildSignedRequest } = require("../../src/services/conversions");
  eventCounter += 1;
  const request = buildSignedRequest({
    keyId: brands.referral.key.keyId,
    secret: brands.referral.key.secret,
    payload: {
      event_id: `evt_matrix_${Date.now()}_${eventCounter}`,
      code: placement.referralCode,
      event: objective === "downloads" ? "install" : "signup",
      timestamp: new Date().toISOString(),
    },
  });
  const sent = await harness.rawPost("/api/webhooks/conversions", request);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body, { status: "recorded", counted: true });
  // The 7-day hold is over.
  await model("ConversionEvent").updateMany({ campaignId: id }, { $set: { availableAt: new Date(Date.now() - DAY) } });
  return { part: "referralAmount", amount: REWARD };
}

let rewardAdmin;
async function adminWhoSetsRewards() {
  if (!rewardAdmin) rewardAdmin = await harness.registerAdmin({ role: "admin" });
  return rewardAdmin;
}

const COMBINATIONS = [];
for (const access of ["open_call", "application_required"]) {
  for (const destination of ["creator_page", "brand_page", "both"]) COMBINATIONS.push({ objective: "content", access, destination });
  for (const objective of ["views", "signups", "downloads"]) COMBINATIONS.push({ objective, access });
}

COMBINATIONS.forEach((combo, index) => {
  const label = [combo.objective, combo.access, combo.destination].filter(Boolean).join(" × ");
  test(`launch matrix: ${label}`, async () => {
    const { brand, id } = await createAndPay(combo);
    const creator = await creatorFor(index);
    const placement = await takePlace({ brand, id, creator, access: combo.access });

    const deliver = combo.objective === "content" ? deliverContent : combo.objective === "views" ? deliverViews : deliverConversion;
    const { part, amount } = await deliver({ brand, id, creator, placement, destination: combo.destination, objective: combo.objective });

    const requested = await harness.api("POST", "/api/creators/withdrawals", { token: creator.token, body: { campaignId: id } });
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(requested.body[part], amount);
    assert.equal(requested.body.amount, amount);

    const paid = await harness.api("POST", `/api/admin/withdrawals/${requested.body.id}/review`, { token: admin.token, body: { approve: true } });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.withdrawal.status, "released");

    const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
    const result = await reconcileCampaignById(id);
    assert.ok(result.ok, `${label}: ${JSON.stringify(result.problems)}`);
    assert.equal(result.released, amount);
    assert.equal(
      Math.round(result.paidIn * 100),
      Math.round((result.released + result.inFlight + result.owed + result.platformFee + result.refunds + result.pendingRefunds + result.left) * 100)
    );
  });
});

test("launch matrix: objectives that aren't live yet can't be created", async () => {
  for (const objective of ["engagement", "leads", "sales", "other"]) {
    const res = await harness.api("POST", "/api/campaigns", {
      token: brands.plain.token,
      body: { name: "Not yet", category: "Tech", campaignObjective: objective, creatorAccess: "open_call", brief },
    });
    assert.equal(res.status, 400, `${objective}: ${JSON.stringify(res.body)}`);
  }
});
