// The pre-deploy check scripts run against production before the new API is deployed, so they must
// never build an index or create a collection there (M7). Runs them against a throwaway database
// and compares its collections and indexes before and after.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { startMongod } = require("./harness");

let mongod;
let client;

before(async () => {
  mongod = await startMongod();
  client = new mongoose.mongo.MongoClient(mongod.uri);
  await client.connect();
});

after(async () => {
  if (client) await client.close();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

// Every collection and its index names, from a separate client.
async function schemaOf(db) {
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();
  const indexes = {};
  for (const name of collections) indexes[name] = (await db.collection(name).indexes()).map((i) => i.name).sort();
  return { collections, indexes };
}

test("the pre-deploy checks, conflict check, reconciliation and migration dry run create no collection or index", async () => {
  const db = client.db();
  // Production already has data but not the new collections and indexes.
  const campaignId = new mongoose.Types.ObjectId();
  await db.collection("campaigns").insertOne({ _id: campaignId, name: "Old views", objective: "views", status: "live", targetViews: 1000 });
  await db.collection("transactions").insertOne({ campaignId, type: "escrow_deposit", bucket: "views", amount: 4300, status: "escrow_deposit", reference: "ref_old" });
  const beforeRun = await schemaOf(db);

  const { runChecks } = require("../../scripts/preDeployChecks");
  const previousUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = mongod.uri;
  const log = console.log;
  console.log = () => {};
  let summary;
  try {
    summary = await runChecks({ staging: true });
  } finally {
    console.log = log;
    if (previousUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousUri;
  }

  // The same functions through the shared read-only connection, then every model's
  // index and collection step allowed to finish.
  const { connectReadOnly } = require("../../scripts/readOnlyConnection");
  const { findUniqueIndexConflicts } = require("../../scripts/checkUniqueIndexConflicts");
  const { migrateCampaignsToV2 } = require("../../scripts/migrateCampaignV2");
  const { reconcileAllCampaigns } = require("../../src/services/campaignReconciliation");
  require("../../src/models/OpsAlert");
  require("../../src/models/CampaignApplication");
  await connectReadOnly(mongod.uri);
  try {
    await findUniqueIndexConflicts();
    const migration = await migrateCampaignsToV2({ dryRun: true });
    assert.equal(migration.toMigrate, 1);
    await reconcileAllCampaigns();
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  } finally {
    await mongoose.disconnect();
  }

  assert.deepEqual(await schemaOf(db), beforeRun, "no collection or index was added");
  assert.ok(summary.serverVersion, "the server version was read");
});

test("every check script connects through the read-only connection", () => {
  for (const script of ["preDeployChecks.js", "reconcileCampaigns.js", "checkUniqueIndexConflicts.js", "migrateCampaignV2.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", script), "utf8");
    assert.match(source, /connectReadOnly\(/, `${script} uses connectReadOnly`);
    assert.doesNotMatch(source, /mongoose\s*\.connect\(/, `${script} doesn't connect on its own`);
  }
});
