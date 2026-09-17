// Follower counts from Instagram: read on connect and refreshed once a day, replacing the
// self-reported number that campaigns' follower minimums check.
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

test("a connected Instagram account's followers come from the API, at most once a day", async () => {
  const meta = require("../../src/services/meta");
  const CreatorProfile = require("../../src/models/CreatorProfile");
  const MetaConnection = require("../../src/models/MetaConnection");
  const { refreshInstagramFollowers } = require("../../src/utils/socialFollowers");

  const creator = await harness.registerCreator();
  await CreatorProfile.updateOne(
    { userId: creator.id },
    { $push: { socialAccounts: { platform: "instagram", handle: "@easilypromote", verified: true, followers: 12, followersSource: "self_reported" } } }
  );
  const connection = await MetaConnection.create({ userId: creator.id, provider: "instagram", providerUserId: "ig1", username: "easilypromote" });

  const original = { token: meta.getValidAccessToken, profile: meta.getInstagramProfile };
  let calls = 0;
  meta.getValidAccessToken = async () => "token";
  meta.getInstagramProfile = async () => {
    calls += 1;
    return { user_id: "ig1", username: "easilypromote", followers_count: 4821 };
  };
  try {
    await refreshInstagramFollowers([connection]);
    let account = (await CreatorProfile.findOne({ userId: creator.id }).lean()).socialAccounts.find((a) => a.platform === "instagram");
    assert.equal(account.followers, 4821);
    assert.equal(account.followersSource, "api");
    assert.ok(account.followersSyncedAt);

    await refreshInstagramFollowers([await MetaConnection.findById(connection._id)]);
    assert.equal(calls, 1, "not read again within a day");

    meta.getInstagramProfile = async () => {
      throw new Error("token expired");
    };
    await refreshInstagramFollowers([await MetaConnection.findByIdAndUpdate(connection._id, { $unset: { followersSyncedAt: 1 } }, { new: true })]);
    account = (await CreatorProfile.findOne({ userId: creator.id }).lean()).socialAccounts.find((a) => a.platform === "instagram");
    assert.equal(account.followers, 4821, "a failed read keeps the last count");
  } finally {
    meta.getValidAccessToken = original.token;
    meta.getInstagramProfile = original.profile;
  }
});
