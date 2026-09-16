// Applicant snapshot (ticket 06): what a brand sees of an applicant, ordered so what matters
// for this campaign comes first.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildApplicantSnapshot, orderSnapshot } = require("../../src/services/applicantSnapshot");

function profile(overrides = {}) {
  return {
    _id: "p1",
    userId: "u1",
    username: "ada",
    displayName: "Ada",
    city: "Abuja",
    state: "FCT",
    country: "Nigeria",
    legalName: "Adaeze Okafor",
    phone: "+2348012345678",
    payoutAccount: { accountNumber: "0123456789" },
    verifiedAt: new Date("2026-09-01"),
    socialAccounts: [
      { platform: "tiktok", handle: "@ada", followers: 20000 },
      { platform: "instagram", handle: "@ada.ig", followers: 50000 },
    ],
    categories: ["Fashion", "Beauty"],
    badges: ["reliable_creator"],
    completionRate: 92,
    stats: { avgViews: 12000, engagementRate: 6.5, pastCampaigns: 4, totalCampaignViews: 48000 },
    audience: {
      source: "self_reported",
      locations: [
        { name: "Abuja", percentage: 20 },
        { name: "Lagos", percentage: 60 },
        { name: "Kano", percentage: 10 },
      ],
      ages: [
        { range: "25-34", percentage: 30 },
        { range: "18-24", percentage: 55 },
      ],
      genders: { female: 62, male: 36, other: 2 },
      proofUrl: "https://files.example.com/proof.png",
    },
    portfolio: [
      { url: "https://t.co/1", thumbnailUrl: "https://img/1", platform: "tiktok", title: "Makeup", category: "Beauty", views: 100 },
      { url: "https://t.co/2", thumbnailUrl: "https://img/2", platform: "tiktok", title: "Outfit", category: "Fashion", views: 200 },
      { url: "https://t.co/3", platform: "instagram", title: "Vlog", views: 300 },
    ],
    ...overrides,
  };
}

const user = { name: "Ada O", avatar: "https://img/avatar.png", email: "ada@example.com" };
const keys = (ordered) => ordered.sections.map((s) => s.key);

test("the snapshot carries brand-safe fields only", () => {
  const snapshot = buildApplicantSnapshot(profile(), user);
  assert.equal(snapshot.name, "Ada");
  assert.equal(snapshot.photo, "https://img/avatar.png");
  assert.equal(snapshot.verified, true);
  assert.deepEqual(snapshot.location, { city: "Abuja", state: "FCT", country: "Nigeria" });
  assert.deepEqual(snapshot.platforms[0], { platform: "instagram", handle: "@ada.ig", followers: 50000 });
  assert.equal(snapshot.completionRate, 92);
  assert.equal(snapshot.portfolio.length, 3);
  const text = JSON.stringify(snapshot);
  for (const secret of ["Adaeze Okafor", "+2348012345678", "0123456789", "ada@example.com", "proof.png"]) {
    assert.ok(!text.includes(secret), `snapshot exposes ${secret}`);
  }
});

test("with nothing campaign-specific, sections come in the default order", () => {
  const ordered = orderSnapshot({ campaignModel: "content" }, buildApplicantSnapshot(profile(), user));
  assert.deepEqual(keys(ordered), ["platforms", "categories", "audience", "performance", "portfolio", "badges"]);
  assert.ok(ordered.sections.every((s) => s.emphasis === false));
});

test("a location-targeted campaign shows the share of audience in those locations first", () => {
  const campaign = { campaignModel: "content", audienceTargeting: { locations: ["lagos", "Kano"] } };
  const ordered = orderSnapshot(campaign, buildApplicantSnapshot(profile(), user));
  assert.equal(keys(ordered)[0], "audience");
  const audience = ordered.sections[0];
  assert.equal(audience.emphasis, true);
  assert.equal(audience.data.targetedShare, 70);
  assert.deepEqual(audience.data.locations.map((l) => l.name), ["Lagos", "Kano", "Abuja"]);
  assert.deepEqual(audience.data.topLocation, { name: "Lagos", percentage: 60 });
  assert.deepEqual(audience.data.topAge, { range: "18-24", percentage: 55 });
  assert.deepEqual(audience.data.genders, { female: 62, male: 36, other: 2 });
});

test("a performance campaign shows performance stats first", () => {
  const ordered = orderSnapshot({ campaignModel: "performance" }, buildApplicantSnapshot(profile(), user));
  assert.equal(keys(ordered)[0], "performance");
  assert.deepEqual(ordered.sections[0].data, { avgViews: 12000, engagementRate: 6.5, pastCampaigns: 4, totalCampaignViews: 48000 });
});

test("campaigns from before the campaign engine read as performance campaigns", () => {
  const ordered = orderSnapshot({ objective: "views" }, buildApplicantSnapshot(profile(), user));
  assert.equal(keys(ordered)[0], "performance");
});

test("a category campaign shows portfolio items in those categories first", () => {
  const campaign = { campaignModel: "content", creatorEligibility: { categories: ["Fashion"] } };
  const ordered = orderSnapshot(campaign, buildApplicantSnapshot(profile(), user));
  assert.equal(keys(ordered)[0], "portfolio");
  assert.deepEqual(ordered.sections[0].data.items.map((i) => i.title), ["Outfit", "Makeup", "Vlog"]);
  assert.equal(ordered.sections[0].data.items[0].matchesCampaign, true);
});

test("several rules together: location, then performance, then portfolio", () => {
  const campaign = {
    campaignModel: "performance",
    audienceTargeting: { locations: ["Lagos"] },
    creatorEligibility: { categories: ["Beauty"] },
  };
  const ordered = orderSnapshot(campaign, buildApplicantSnapshot(profile(), user));
  assert.deepEqual(keys(ordered), ["audience", "performance", "portfolio", "platforms", "categories", "badges"]);
});

test("a creator with no audience data still gets an audience section with nothing in it", () => {
  const snapshot = buildApplicantSnapshot(profile({ audience: undefined }), user);
  const ordered = orderSnapshot({ audienceTargeting: { locations: ["Lagos"] } }, snapshot);
  assert.equal(ordered.sections[0].key, "audience");
  assert.equal(ordered.sections[0].data.targetedShare, 0);
  assert.equal(ordered.sections[0].data.topLocation, null);
  assert.equal(ordered.sections[0].data.genders, null);
});
