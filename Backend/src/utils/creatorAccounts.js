// A creator's profile and connected social accounts in one query: the profile, then TikTok and Meta
// connections through $unionWith. Encrypted tokens are left out, as the models' `select: false`
// leaves them out of a find. Used by joining and by the creator dashboard, which both need all three.
const { toObjectId } = require("./objectId");
const CreatorProfile = require("../models/CreatorProfile");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");

// Returns { profile, tiktok, metaConnections, extra } as lean documents (null / [] when missing).
// Options (the paged marketplace, M8): `profileFields`, a space-separated list, loads only those profile
// fields; `unions`, { [source]: { coll, pipeline } }, adds more of the creator's rows to the same round
// trip, returned as extra[source] (an array).
async function loadCreatorAccounts(userId, { profileFields = null, unions = {} } = {}) {
  const id = toObjectId(userId);
  const extraStages = Object.entries(unions).map(([source, { coll, pipeline }]) => ({
    $unionWith: { coll, pipeline: [...pipeline, { $addFields: { _accountSource: source } }] },
  }));
  const rows = await CreatorProfile.aggregate([
    { $match: { userId: id } },
    { $limit: 1 },
    ...(profileFields ? [{ $project: Object.fromEntries(profileFields.split(" ").map((field) => [field, 1])) }] : []),
    { $addFields: { _accountSource: "profile" } },
    {
      $unionWith: {
        coll: TikTokConnection.collection.name,
        pipeline: [
          { $match: { userId: id } },
          { $limit: 1 },
          { $project: { accessTokenEnc: 0, refreshTokenEnc: 0 } },
          { $addFields: { _accountSource: "tiktok" } },
        ],
      },
    },
    {
      $unionWith: {
        coll: MetaConnection.collection.name,
        pipeline: [
          { $match: { userId: id } },
          { $project: { accessTokenEnc: 0, "pages.accessTokenEnc": 0 } },
          { $addFields: { _accountSource: "meta" } },
        ],
      },
    },
    ...extraStages,
  ]);
  const from = (source) =>
    rows
      .filter((row) => row._accountSource === source)
      .map((row) => {
        const doc = { ...row };
        delete doc._accountSource;
        return doc;
      });
  const extra = Object.fromEntries(Object.keys(unions).map((source) => [source, from(source)]));
  return { profile: from("profile")[0] || null, tiktok: from("tiktok")[0] || null, metaConnections: from("meta"), extra };
}

module.exports = { loadCreatorAccounts };
