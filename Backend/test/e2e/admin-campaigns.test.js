// Admin campaign list: each campaign shows how many creators' niches match its niches or category.
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

test("the admin campaign list counts creators whose niches match, ignoring case and spaces", async () => {
  const CreatorProfile = require("../../src/models/CreatorProfile");
  const brand = await harness.registerBrand();
  const admin = await harness.registerAdmin();
  const music = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Matcher music", category: "Tech", targetViews: 100000, niches: ["Music"] } });
  const food = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Matcher food", category: "Food", targetViews: 100000 } });
  assert.equal(music.status, 201);
  assert.equal(food.status, 201);

  const creators = await Promise.all([1, 2, 3, 4].map(() => harness.registerCreator({ niches: ["Travel"] })));
  const setNiches = (creator, niches) => CreatorProfile.updateOne({ userId: creator.id }, { $set: { niches } });
  await setNiches(creators[0], [" music "]);
  await setNiches(creators[1], ["TECH", "Travel"]);
  await setNiches(creators[2], ["Food"]);
  await setNiches(creators[3], []);

  const list = await harness.api("GET", "/api/admin/campaigns?q=Matcher", { token: admin.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const byName = Object.fromEntries(list.body.campaigns.map((c) => [c.name, c]));
  assert.equal(byName["Matcher music"].creatorCount, 2, "music and tech (category) match");
  assert.equal(byName["Matcher food"].creatorCount, 1);
});
