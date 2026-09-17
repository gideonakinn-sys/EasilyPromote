// A creator's profile and connected social accounts in one query: the profile, then TikTok and Meta
// connections through $unionWith. Encrypted tokens are left out, as the models' `select: false`
// leaves them out of a find. Used by joining and by the creator dashboard, which both need all three.
const mongoose = require("mongoose");
const CreatorProfile = require("../models/CreatorProfile");
const TikTokConnection = require("../models/TikTokConnection");
const MetaConnection = require("../models/MetaConnection");

const toObjectId = (value) => (value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value)));

// Returns { profile, tiktok, metaConnections } as lean documents (null / [] when missing).
async function loadCreatorAccounts(userId) {
  const id = toObjectId(userId);
  const rows = await CreatorProfile.aggregate([
    { $match: { userId: id } },
    { $limit: 1 },
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
  ]);
  const from = (source) =>
    rows
      .filter((row) => row._accountSource === source)
      .map((row) => {
        const doc = { ...row };
        delete doc._accountSource;
        return doc;
      });
  return { profile: from("profile")[0] || null, tiktok: from("tiktok")[0] || null, metaConnections: from("meta") };
}

module.exports = { loadCreatorAccounts };
