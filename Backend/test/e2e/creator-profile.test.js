// Creator Profile v2 (ticket 01): private basics, audience, portfolio, verification, stats.
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

async function profileId(creator) {
  const CreatorProfile = require("../../src/models/CreatorProfile");
  const profile = await CreatorProfile.findOne({ userId: creator.id }).select("_id").lean();
  return String(profile._id);
}

test("brand-facing profiles never show a creator's legal name, phone, email or bank details", async () => {
  const creator = await harness.registerCreator();

  const basics = await harness.api("PUT", "/api/creators/profile/me", {
    token: creator.token,
    body: { legalName: "Adaeze Okafor", phone: "+2348012345678", city: "Abuja", state: "FCT" },
  });
  assert.equal(basics.status, 200);

  const bank = await harness.api("POST", "/api/creators/bank-account", {
    token: creator.token,
    body: { accountNumber: "0123456789", bankCode: "058", bankName: "GTBank", accountName: "Adaeze Okafor" },
  });
  assert.equal(bank.status, 200);

  const own = await harness.api("GET", "/api/creators/profile/me", { token: creator.token });
  assert.equal(own.body.legalName, "Adaeze Okafor");
  assert.equal(own.body.phone, "+2348012345678");

  const id = await profileId(creator);
  for (const path of [`/api/creators/${id}`, "/api/creators", "/api/creators/leaderboard"]) {
    const res = await harness.api("GET", path);
    assert.equal(res.status, 200, path);
    const text = JSON.stringify(res.body);
    for (const secret of ["Adaeze Okafor", "+2348012345678", creator.email, "0123456789", "payoutAccount", "RCP_"]) {
      assert.ok(!text.includes(secret), `${path} exposes ${secret}`);
    }
  }

  const single = await harness.api("GET", `/api/creators/${id}`);
  assert.equal(single.body.username, creator.username);
  assert.equal(single.body.location.state, "FCT");
});

test("a creator records where their audience is, and brands see it", async () => {
  const creator = await harness.registerCreator();

  const saved = await harness.api("PUT", "/api/creators/profile/audience", {
    token: creator.token,
    body: {
      locations: [
        { name: "Lagos", percentage: 80 },
        { name: "Abuja", percentage: 12 },
      ],
      ages: [
        { range: "18-24", percentage: 55 },
        { range: "25-34", percentage: 35 },
      ],
      genders: { female: 60, male: 38, other: 2 },
      proofUrl: "https://files.example.com/tiktok-analytics.png",
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.audience.source, "self_reported");
  assert.ok(saved.body.audience.updatedAt);

  const id = await profileId(creator);
  const publicView = await harness.api("GET", `/api/creators/${id}`);
  assert.deepEqual(publicView.body.audience.locations, [
    { name: "Lagos", percentage: 80 },
    { name: "Abuja", percentage: 12 },
  ]);
  assert.deepEqual(publicView.body.audience.genders, { female: 60, male: 38, other: 2 });
  assert.equal(publicView.body.audience.source, "self_reported");
});

test("audience data must be complete, add up to 100% or less, and come with proof", async () => {
  const creator = await harness.registerCreator();
  const proofUrl = "https://files.example.com/proof.png";
  const cases = [
    {},
    { locations: [{ name: "Lagos", percentage: 50 }] },
    { proofUrl, locations: [{ name: "Lagos", percentage: 30 }, { name: "lagos", percentage: 20 }] },
    { proofUrl, ages: [{ range: "18-24", percentage: 30 }, { range: "18-24", percentage: 20 }] },
    { locations: [{ name: "Lagos", percentage: 70 }, { name: "Abuja", percentage: 40 }] },
    { ages: [{ range: "18-24", percentage: 90 }, { range: "25-34", percentage: 20 }] },
    { genders: { female: 60, male: 50, other: 0 } },
    { locations: ["Lagos", "Abuja", "Kano", "Ibadan", "Port Harcourt", "Enugu"].map((name) => ({ name, percentage: 10 })) },
  ];
  for (const [i, body] of cases.entries()) {
    const withProof = i < 2 || body.proofUrl ? body : { proofUrl, ...body };
    const res = await harness.api("PUT", "/api/creators/profile/audience", { token: creator.token, body: withProof });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error, "explains what's wrong");
  }
});

test("a creator curates categories, follower counts and a portfolio that brands can see", async () => {
  const creator = await harness.registerCreator();

  const categories = await harness.api("PUT", "/api/creators/profile/me", {
    token: creator.token,
    body: { categories: ["Music", "Comedy"] },
  });
  assert.equal(categories.status, 200);
  const unknownCategory = await harness.api("PUT", "/api/creators/profile/me", {
    token: creator.token,
    body: { categories: ["Astrology"] },
  });
  assert.equal(unknownCategory.status, 400);

  const social = await harness.api("POST", "/api/creators/profile/socials", {
    token: creator.token,
    body: { platform: "tiktok", handle: "@adaeze", followers: 48200 },
  });
  assert.equal(social.status, 200);

  const first = { url: "https://www.tiktok.com/@adaeze/video/1", platform: "tiktok", title: "Dance challenge", views: 120000, category: "Music" };
  const second = { url: "https://www.instagram.com/reel/abc", platform: "instagram", title: "Skit", views: 40000, category: "Comedy" };
  const third = { url: "https://www.youtube.com/watch?v=xyz", platform: "youtube", title: "Vlog", views: 9000, category: "Music" };

  const added = await harness.api("PUT", "/api/creators/profile/portfolio", { token: creator.token, body: { items: [first, second, third] } });
  assert.equal(added.status, 200);
  const reordered = await harness.api("PUT", "/api/creators/profile/portfolio", { token: creator.token, body: { items: [third, first] } });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.portfolio.map((p) => p.title), ["Vlog", "Dance challenge"]);

  const tooMany = await harness.api("PUT", "/api/creators/profile/portfolio", {
    token: creator.token,
    body: { items: Array.from({ length: 13 }, (_, i) => ({ ...first, url: `https://www.tiktok.com/@adaeze/video/${i}` })) },
  });
  assert.equal(tooMany.status, 400);

  const publicView = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.deepEqual(publicView.body.categories, ["Music", "Comedy"]);
  assert.deepEqual(publicView.body.portfolio.map((p) => p.title), ["Vlog", "Dance challenge"]);
  const tiktok = publicView.body.socialAccounts.find((s) => s.platform === "tiktok");
  assert.equal(tiktok.followers, 48200);

  const nullName = await harness.api("PUT", "/api/creators/profile/me", { token: creator.token, body: { displayName: null } });
  assert.equal(nullName.status, 400);
});

test("admin verifies a creator with a connected social account, and brands see the badge", async () => {
  const admin = await harness.registerAdmin();
  const creator = await harness.registerCreator();
  const unconnected = await harness.registerCreator({ connected: false });

  const before = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.equal(before.body.verified, false);

  const selfVerify = await harness.api("PATCH", `/api/admin/creators/${creator.id}/verification`, {
    token: creator.token,
    body: { verified: true },
  });
  assert.equal(selfVerify.status, 403);

  const refused = await harness.api("PATCH", `/api/admin/creators/${unconnected.id}/verification`, {
    token: admin.token,
    body: { verified: true },
  });
  assert.equal(refused.status, 409);

  const verified = await harness.api("PATCH", `/api/admin/creators/${creator.id}/verification`, {
    token: admin.token,
    body: { verified: true },
  });
  assert.equal(verified.status, 200);

  const after = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.equal(after.body.verified, true);

  const own = await harness.api("GET", "/api/creators/profile/me", { token: creator.token });
  assert.equal(own.body.verified, true);

  const revoked = await harness.api("PATCH", `/api/admin/creators/${creator.id}/verification`, {
    token: admin.token,
    body: { verified: false },
  });
  assert.equal(revoked.status, 200);
  const afterRevoke = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.equal(afterRevoke.body.verified, false);
});

test("a creator who disconnects their last social account loses the verified badge", async () => {
  const admin = await harness.registerAdmin();
  const creator = await harness.registerCreator();
  await harness.api("PATCH", `/api/admin/creators/${creator.id}/verification`, { token: admin.token, body: { verified: true } });

  const disconnected = await harness.api("POST", "/api/tiktok/disconnect", { token: creator.token });
  assert.equal(disconnected.status, 200);

  const publicView = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.equal(publicView.body.verified, false);
});

test("campaign stats come from a creator's delivered submissions", async () => {
  const admin = await harness.registerAdmin();
  const creator = await harness.registerCreator();

  // Posting and view syncing need the real TikTok API, so delivered submissions are fixtures.
  const mongoose = require("mongoose");
  const Submission = require("../../src/models/Submission");
  const campaignA = new mongoose.Types.ObjectId();
  const campaignB = new mongoose.Types.ObjectId();
  const base = { creatorId: creator.id, creatorHandle: creator.username };
  await Submission.create([
    { ...base, campaignId: campaignA, status: "posted", viewsDelivered: 10000, postedPlatforms: [{ platform: "tiktok", views: 10000, likes: 800, comments: 200 }] },
    { ...base, campaignId: campaignB, status: "verifying", viewsDelivered: 20000, postedPlatforms: [{ platform: "instagram", views: 20000, likes: 1500, comments: 500 }] },
    { ...base, campaignId: campaignB, status: "rejected", viewsDelivered: 99999, postedPlatforms: [{ platform: "tiktok", views: 99999, likes: 99999, comments: 0 }] },
  ]);

  const recalculated = await harness.api("POST", "/api/admin/rank/recalculate", { token: admin.token });
  assert.equal(recalculated.status, 200);

  const publicView = await harness.api("GET", `/api/creators/${await profileId(creator)}`);
  assert.deepEqual(
    { ...publicView.body.stats, updatedAt: undefined },
    { avgViews: 15000, engagementRate: 10, pastCampaigns: 2, totalCampaignViews: 30000, updatedAt: undefined }
  );
  assert.ok(publicView.body.stats.updatedAt);
});
