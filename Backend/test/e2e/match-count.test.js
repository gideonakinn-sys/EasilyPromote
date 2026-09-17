// The wizard's live "about N creators match" count (ticket 11): brands only, rounded, rate-limited,
// counted with the join check so D8's hard requirements decide who matches.
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

const count = (who, body) => harness.api("POST", "/api/campaigns/match-count", { token: who && who.token, body });

test("brands see a rounded count of creators who could join, never who they are", async () => {
  const CreatorProfile = require("../../src/models/CreatorProfile");
  const { clearCreatorPool } = require("../../src/services/creatorMatchCount");
  const brand = await harness.registerBrand();

  const creators = [];
  for (let i = 0; i < 14; i += 1) creators.push(await harness.registerCreator());
  // Not counted: no connected account, and a deactivated creator.
  await harness.registerCreator({ connected: false });
  const User = require("../../src/models/User");
  await User.updateOne({ _id: creators[13].id }, { $set: { isActive: false } });
  // 11 creators have most of their audience in Lagos; 2 of them are verified.
  await CreatorProfile.updateMany(
    { userId: { $in: creators.slice(0, 11).map((c) => c.id) } },
    { $set: { audience: { locations: [{ name: "Lagos", percentage: 80 }], source: "self_reported" } } }
  );
  await CreatorProfile.updateMany({ userId: { $in: creators.slice(0, 2).map((c) => c.id) } }, { $set: { verifiedAt: new Date() } });
  clearCreatorPool();

  const everyone = await count(brand, {});
  assert.equal(everyone.status, 200, JSON.stringify(everyone.body));
  assert.deepEqual(everyone.body, { count: 10, fewerThan: false, label: "About 10 creators match" });
  assert.deepEqual(Object.keys(everyone.body).sort(), ["count", "fewerThan", "label"]);

  const lagos = await count(brand, { audienceTargeting: { locations: ["Lagos"], minLocationShare: 50 } });
  assert.deepEqual(lagos.body, { count: 10, fewerThan: false, label: "About 10 creators match" });

  // Age and gender only rank (D8): same count.
  const ranked = await count(brand, { audienceTargeting: { locations: ["Lagos"], minLocationShare: 50, ageRanges: ["18-24"], genders: ["female"] } });
  assert.deepEqual(ranked.body, lagos.body);

  // A small result isn't given exactly.
  const verified = await count(brand, { audienceTargeting: { locations: ["Lagos"], minLocationShare: 50 }, creatorEligibility: { verifiedOnly: true } });
  assert.deepEqual(verified.body, { count: 10, fewerThan: true, label: "Fewer than 10 creators match" });

  const nobody = await count(brand, { audienceTargeting: { platforms: ["youtube"] } });
  assert.deepEqual(nobody.body, { count: 0, fewerThan: false, label: "No creators match yet" });

  // Nothing about any creator is in any answer.
  const printed = JSON.stringify([everyone.body, lagos.body, verified.body]);
  for (const c of creators) assert.ok(!printed.includes(c.username) && !printed.includes(c.id));
});

test("only brands can ask, the settings are validated, and a brand is rate-limited", async () => {
  const creator = await harness.registerCreator();
  assert.equal((await count(null, {})).status, 401);
  assert.equal((await count(creator, {})).status, 403);

  const brand = await harness.registerBrand();
  const invalid = await count(brand, { audienceTargeting: { minLocationShare: 140 } });
  assert.equal(invalid.status, 400);
  const badPlatform = await count(brand, { audienceTargeting: { platforms: ["myspace"] } });
  assert.equal(badPlatform.status, 400);

  const results = [];
  for (let i = 0; i < 31; i += 1) results.push((await count(brand, {})).status);
  assert.equal(results.filter((s) => s === 200).length, 28, "two requests above already used the minute's allowance");
  assert.equal(results[results.length - 1], 429);
  // Another brand isn't affected.
  assert.equal((await count(await harness.registerBrand(), {})).status, 200);
});
