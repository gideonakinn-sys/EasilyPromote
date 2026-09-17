#!/usr/bin/env node
// Read-only checks to run against the target database and environment before deploying the
// campaign engine (M7). It writes nothing, builds no index, creates no collection and never
// prints a secret's value.
//
//   MONGODB_URI=<connection string> node scripts/preDeployChecks.js [--staging]
//
// 1. Environment: the variables this release needs are set (names only). A test Paystack key is
//    blocking unless --staging.
// 1b. MongoDB server version 4.4 or newer (blocking).
// 2. Campaign v2 migration dry run: how many campaigns still need scripts/migrateCampaignV2.js
//    --apply, by objective (a warning; run the migration as its own step).
// 3. Unique index conflicts on transactions, slots and withdrawals (blocking).
// 4. Reconciliation: every campaign with money on record balances to the kobo (blocking).
//
// Exit code 1 when anything blocks, 0 otherwise (2 when the checks couldn't run).

// Variables this release reads. "required" blocks a deploy; "optional" warns.
const ENV_SPEC = [
  { name: "MONGODB_URI", level: "required", why: "Database connection" },
  { name: "JWT_SECRET", level: "required", why: "Signs access tokens" },
  { name: "JWT_REFRESH_SECRET", level: "required", why: "Signs refresh tokens; must differ from JWT_SECRET" },
  { name: "PAYSTACK_SECRET_KEY", level: "required", why: "Checkouts, payouts, refunds and webhook signatures; the payout reconcile job skips without it" },
  { name: "BREVO_API_KEY", level: "required", why: "Verification, password reset, application and alert emails" },
  { name: "TOKEN_ENCRYPTION_KEY", level: "required", why: "Encrypts social tokens and webhook signing secrets", fallback: "TIKTOK_TOKEN_KEY" },
  { name: "CLIENT_URL", level: "required", why: "CORS allow-list; without it only localhost origins are allowed" },
  { name: "OPS_ALERT_EMAIL", level: "optional", why: "Where ops alerts are emailed; alerts still show in the admin overview without it" },
  { name: "PAYSTACK_CALLBACK_URL", level: "optional", why: "Where Paystack returns brands after checkout" },
];

const isSet = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

// Pure. Returns { present: [names], blocking: [{ name, message }], warnings: [{ name, message }] }.
function checkEnvironment(env, { staging = false } = {}) {
  const present = [];
  const blocking = [];
  const warnings = [];

  for (const entry of ENV_SPEC) {
    if (isSet(env, entry.name)) {
      present.push(entry.name);
      continue;
    }
    if (entry.fallback && isSet(env, entry.fallback)) {
      present.push(entry.fallback);
      warnings.push({ name: entry.name, message: `${entry.name} isn't set; ${entry.fallback} is used instead. Move it to ${entry.name}.` });
      continue;
    }
    const problem = { name: entry.name, message: `${entry.name} isn't set (${entry.why})` };
    (entry.level === "required" ? blocking : warnings).push(problem);
  }

  if (isSet(env, "JWT_SECRET") && isSet(env, "JWT_REFRESH_SECRET") && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    blocking.push({ name: "JWT_REFRESH_SECRET", message: "JWT_REFRESH_SECRET is the same as JWT_SECRET" });
  }
  if (!staging && isSet(env, "PAYSTACK_SECRET_KEY") && !env.PAYSTACK_SECRET_KEY.trim().startsWith("sk_live_")) {
    blocking.push({ name: "PAYSTACK_SECRET_KEY", message: "PAYSTACK_SECRET_KEY isn't a live key (pass --staging for a test environment)" });
  }

  return { present, blocking, warnings };
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// The admin dashboard and creator join read with $unionWith, which needs MongoDB 4.4.
const MIN_SERVER_VERSION = [4, 4];

// Pure. Returns a blocking message when the server is older than 4.4 (or its version can't be read), null otherwise.
function checkServerVersion(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version || ""));
  if (!match) return `Couldn't read the MongoDB server version ("${version || ""}"); MongoDB ${MIN_SERVER_VERSION.join(".")} or newer is required`;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [minMajor, minMinor] = MIN_SERVER_VERSION;
  if (major > minMajor || (major === minMajor && minor >= minMinor)) return null;
  return `MongoDB ${version} is too old: ${MIN_SERVER_VERSION.join(".")} or newer is required ($unionWith)`;
}

// Pure. Combines every check into blocking problems, warnings and an exit code.
// `serverVersion` is left out when the database checks didn't run.
function summarizeChecks({ environment, migration, conflicts, reconciliation, serverVersion }) {
  const blocking = environment.blocking.map((p) => p.message);
  const warnings = environment.warnings.map((p) => p.message);
  if (serverVersion !== undefined) {
    const versionProblem = checkServerVersion(serverVersion);
    if (versionProblem) blocking.push(versionProblem);
  }

  if (migration && migration.toMigrate > 0) {
    const detail = Object.entries(migration.byObjective || {}).map(([objective, count]) => `${objective} ${count}`).join(", ");
    warnings.push(`${migration.toMigrate === 1 ? "1 campaign needs" : `${migration.toMigrate} campaigns need`} the Campaign v2 migration (${detail}). Run scripts/migrateCampaignV2.js --apply after a snapshot.`);
  }

  for (const check of conflicts || []) {
    if (check.rows.length > 0) blocking.push(`Unique index conflict: ${check.label} has ${plural(check.rows.length, "duplicated group")}`);
  }

  if (reconciliation && reconciliation.failing.length > 0) {
    const names = reconciliation.failing.slice(0, 5).map((f) => `${f.name || f.campaignId} (${f.status})`).join(", ");
    blocking.push(
      `${reconciliation.failing.length === 1 ? "1 campaign doesn't balance" : `${reconciliation.failing.length} campaigns don't balance`}: ${names}${reconciliation.failing.length > 5 ? ", …" : ""}. Run scripts/reconcileCampaigns.js for details.`
    );
  }

  return { blocking, warnings, exitCode: blocking.length > 0 ? 1 : 0 };
}

async function runChecks({ staging }) {
  // Before any model loads: nothing may build an index or create a collection.
  const { connectReadOnly, disableAutoBuild } = require("./readOnlyConnection");
  disableAutoBuild();
  const mongoose = require("mongoose");
  const { migrateCampaignsToV2 } = require("./migrateCampaignV2");
  const { findUniqueIndexConflicts } = require("./checkUniqueIndexConflicts");
  const { reconcileAllCampaigns } = require("../src/services/campaignReconciliation");

  const environment = checkEnvironment(process.env, { staging });
  console.log("Environment");
  for (const name of environment.present) console.log(`  set      ${name}`);
  for (const problem of environment.blocking) console.log(`  BLOCK    ${problem.message}`);
  for (const problem of environment.warnings) console.log(`  warn     ${problem.message}`);

  if (!isSet(process.env, "MONGODB_URI")) {
    const summary = summarizeChecks({ environment, migration: null, conflicts: [], reconciliation: null });
    console.log("\nMONGODB_URI isn't set, so the database checks didn't run.");
    return summary;
  }

  await connectReadOnly(process.env.MONGODB_URI);
  try {
    const buildInfo = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    const serverVersion = String((buildInfo && buildInfo.version) || "");
    const versionProblem = checkServerVersion(serverVersion);
    console.log(`\nMongoDB server\n  ${versionProblem ? "BLOCK   " : "ok      "} version ${serverVersion || "unknown"}`);

    // Dry run only: counts, no writes.
    const migration = await migrateCampaignsToV2({ dryRun: true });
    console.log(`\nCampaign v2 migration (dry run)\n  ${migration.toMigrate} to migrate ${JSON.stringify(migration.byObjective)}`);

    const conflicts = await findUniqueIndexConflicts();
    console.log("\nUnique index conflicts");
    for (const check of conflicts) console.log(`  ${check.rows.length === 0 ? "ok      " : "CONFLICT"} ${check.label}${check.rows.length ? `: ${check.rows.length}` : ""}`);

    const failing = [];
    let checked = 0;
    await reconcileAllCampaigns({
      onResult(result) {
        checked += 1;
        if (!result.ok) failing.push({ campaignId: String(result.campaignId), name: result.name, status: result.status, problems: result.problems });
      },
    });
    console.log(`\nReconciliation\n  ${checked} campaigns with money checked, ${failing.length} don't balance`);
    for (const f of failing.slice(0, 20)) console.log(`  FAIL ${f.campaignId} ${f.name || ""} (${f.status}): ${f.problems[0]}`);

    return { ...summarizeChecks({ environment, migration, conflicts, reconciliation: { checked, failing }, serverVersion }), serverVersion };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  require("dotenv").config();
  if (process.argv.includes("--apply")) {
    console.error("preDeployChecks only reads. To migrate, run scripts/migrateCampaignV2.js --apply as its own step.");
    process.exit(2);
  }
  runChecks({ staging: process.argv.includes("--staging") })
    .then((summary) => {
      console.log(`\n${summary.blocking.length === 0 ? "No blocking problems." : `${plural(summary.blocking.length, "blocking problem")}:`}`);
      for (const line of summary.blocking) console.log(`  - ${line}`);
      if (summary.warnings.length) console.log(`${plural(summary.warnings.length, "warning")}:`);
      for (const line of summary.warnings) console.log(`  - ${line}`);
      process.exit(summary.exitCode);
    })
    .catch((error) => {
      console.error("Checks couldn't run:", error.message);
      process.exit(2);
    });
}

module.exports = { ENV_SPEC, checkEnvironment, checkServerVersion, summarizeChecks, runChecks };
