#!/usr/bin/env node
// Load test for the marketplace, join, apply and approve (ticket 11). Local only, repeatable:
//
//   npm run load-test -- [--creators 5000] [--campaigns 2000] [--brands 250] [--concurrency 50]
//                        [--mongo-uri mongodb://127.0.0.1:27099/ep_load] [--out results.json]
//
// 1. Starts a throwaway mongod (or uses --mongo-uri, which must be on this machine) and seeds it
//    through the real API in-process with Paystack stubbed (seed.js).
// 2. Starts the API as its own process against that database, from an empty working directory with
//    an environment built from scratch, so no .env file or shell variable (production keys,
//    MONGODB_URI) can reach it. It never talks to Paystack, email or storage.
// 3. Runs the scenarios below from this process over keep-alive HTTP and reports requests per second,
//    p50 / p95 / p99 latency and error rates, plus slow and unindexed queries MongoDB's profiler saw.
// 4. Checks the invariants concurrency could break (invariants.js) and exits non-zero if any fails or
//    any request errored (5xx or a dropped connection).
//
// safety.js refuses any MongoDB URI or API URL that isn't 127.0.0.1 / localhost / ::1. Results are
// recorded in docs/campaign-engine/LOAD_TEST.md.
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");

const { assertLocalMongoUri, assertLocalUrl } = require("./safety");
const { createClient } = require("./load");
const { seed, pick } = require("./seed");
const { checkInvariants } = require("./invariants");

const SRC = path.join(__dirname, "..", "..", "src");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

const OPTIONS = {
  creators: Number(arg("creators", 5000)),
  campaigns: Number(arg("campaigns", 2000)),
  brands: Number(arg("brands", 250)),
  concurrency: Number(arg("concurrency", 50)),
  mongoUri: arg("mongo-uri", null),
  out: arg("out", null),
  marketplaceRequests: Number(arg("marketplace-requests", 1000)),
  // Comma-separated: marketplace, join, apply, approve, races (default all).
  scenarios: new Set(String(arg("scenarios", "all")).split(",").map((x) => x.trim())),
  // Seed once, run many: --save-seed writes what the scenarios need; --reuse-seed (with --mongo-uri
  // pointing at the same database) skips seeding.
  saveSeed: arg("save-seed", null),
  reuseSeed: arg("reuse-seed", null),
  // Writes a V8 CPU profile of the API process into this directory.
  cpuProf: arg("cpu-prof", null),
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Only what Node needs to run on this OS; nothing else from the caller's shell.
function baseEnv() {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "windir", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "NUMBER_OF_PROCESSORS"];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

async function startApi({ mongoUri, secrets, cpuProf }) {
  const port = await freePort();
  const baseUrl = assertLocalUrl(`http://127.0.0.1:${port}`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ep-load-api-"));
  const stderr = [];
  const nodeArgs = cpuProf ? ["--cpu-prof", `--cpu-prof-dir=${path.resolve(cpuProf)}`] : [];
  const proc = spawn(process.execPath, [...nodeArgs, "-r", path.join(__dirname, "apiPreload.js"), path.join(SRC, "server.js")], {
    cwd,
    env: {
      ...baseEnv(),
      NODE_ENV: "production",
      PORT: String(port),
      MONGODB_URI: assertLocalMongoUri(mongoUri),
      JWT_SECRET: secrets.jwt,
      JWT_REFRESH_SECRET: secrets.refresh,
      JWT_EXPIRES_IN: "12h",
      TOKEN_ENCRYPTION_KEY: secrets.encryption,
      PAYSTACK_SECRET_KEY: "sk_test_load_test_not_a_real_key",
      DEFAULT_ADMIN_EMAIL: "load-test-admin@load.test",
      DEFAULT_ADMIN_PASSWORD: crypto.randomBytes(16).toString("hex"),
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  proc.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) stderr.push(line);
  });
  let exited = false;
  proc.on("exit", () => {
    exited = true;
  });

  const deadline = Date.now() + 60000;
  for (;;) {
    if (exited) throw new Error(`The API exited while starting:\n${stderr.slice(-20).join("\n")}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("The API didn't start within 60 seconds");
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    baseUrl,
    pid: proc.pid,
    stderr,
    async stop() {
      if (!exited) {
        // A normal exit (apiPreload.js), so a CPU profile is written; killed if it doesn't go.
        const gone = new Promise((resolve) => proc.once("exit", resolve));
        proc.send("exit");
        const timer = setTimeout(() => proc.kill(), 15000);
        await gone;
        clearTimeout(timer);
      }
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

// Slow (≥ 25 ms) and unindexed operations while the scenarios run.
async function startProfiler(db) {
  await db.dropCollection("system.profile").catch(() => {});
  await db.command({ profile: 1, slowms: 25, filter: { $or: [{ millis: { $gte: 25 } }, { planSummary: { $regex: "COLLSCAN" } }] } });
}

async function profilerReport(db) {
  await db.command({ profile: 0 });
  const rows = await db.collection("system.profile").find({ ns: { $not: /system\.profile$/ } }).toArray();
  const groups = new Map();
  for (const row of rows) {
    const command = row.command || {};
    const shape = command.filter || command.q || (command.pipeline && command.pipeline[0]) || command.query || {};
    const keys = Object.keys(shape).sort().join(",");
    const op = command.aggregate ? "aggregate" : command.find ? "find" : command.findAndModify ? "findAndModify" : command.count ? "count" : row.op;
    const key = `${row.ns} ${op} {${keys}} ${row.planSummary || ""}`;
    const g = groups.get(key) || { ns: row.ns, op, shape: keys, plan: row.planSummary || "", count: 0, totalMs: 0, maxMs: 0, docsExamined: 0 };
    g.count += 1;
    g.totalMs += row.millis || 0;
    g.maxMs = Math.max(g.maxMs, row.millis || 0);
    g.docsExamined = Math.max(g.docsExamined, row.docsExamined || 0);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, 15);
}

const expectCodes = (okStatuses, codes = []) => (res) => okStatuses.includes(res.status) || Boolean(res.body && codes.includes(res.body.code));

// Races run many requests at once, capped so the OS doesn't refuse connections before they reach
// the API. Requests are ordered by the resource they race for, so each group is in flight together.
const BURST = 240;

// A join or approval can be refused for good reasons (full, already joined, not eligible, at the
// placement limit); those are expected outcomes, not errors.
const JOIN_REFUSALS = ["CAMPAIGN_FULL", "ALREADY_JOINED", "NOT_ELIGIBLE", "CONTENT_REJECTED"];
const APPLY_REFUSALS = ["ALREADY_APPLIED", "CAMPAIGN_FULL", "NOT_ELIGIBLE", "ALREADY_JOINED"];
const APPROVE_REFUSALS = ["CAMPAIGN_FULL", "CREATOR_CANNOT_JOIN", "NOT_PENDING"];

// Campaigns from `list` with at least `minOpen` open places right now, most open first.
async function withOpenPlaces(list, minOpen) {
  const Slot = require(path.join(SRC, "models", "Slot"));
  const rows = await Slot.aggregate([
    { $match: { campaignId: { $in: list.map((c) => new mongoose.Types.ObjectId(c.id)) }, status: "available" } },
    { $group: { _id: "$campaignId", open: { $sum: 1 } } },
    { $match: { open: { $gte: minOpen } } },
    { $sort: { open: -1, _id: 1 } },
  ]);
  const byId = new Map(list.map((c) => [c.id, c]));
  return rows.map((r) => ({ ...byId.get(String(r._id)), open: r.open }));
}

async function runScenarios(client, data, only) {
  const { creators, joinTargets, applyTargets, raceJoin, raceApprove } = data;
  const C = OPTIONS.concurrency;
  const slice = (from, to) => creators.slice(from, Math.min(to, creators.length));
  const wanted = (name) => only.has("all") || only.has(name);
  const results = [];
  // Race outcomes read from the responses: { name, violations: count }.
  const findings = [];
  const record = (r) => {
    results.push(r.summary);
    const s = r.summary;
    console.log(
      `  ${s.name}: ${s.requests} req, ${s.rps.toFixed(0)}/s, p50 ${s.p50.toFixed(0)} ms, p95 ${s.p95.toFixed(0)} ms, p99 ${s.p99.toFixed(0)} ms, errors ${s.errors}, unexpected ${s.unexpected}`
    );
    return r;
  };
  // Pairs of identical requests: how many pairs both "won".
  const bothWon = (r, ok) => {
    let both = 0;
    for (let i = 0; i < r.results.length; i += 2) if (ok(r.results[i]) && ok(r.results[i + 1])) both += 1;
    return both;
  };
  const joinSpec = (campaign, creator) => ({
    method: "POST",
    path: `/api/campaigns/${campaign.id}/join`,
    token: creator.token,
    body: {},
    expect: expectCodes([200], JOIN_REFUSALS),
  });
  const applySpec = (campaign, creator, codes = APPLY_REFUSALS) => ({
    method: "POST",
    path: `/api/campaigns/${campaign.id}/apply`,
    token: creator.token,
    body: { pitch: "I film this kind of content every week" },
    campaign,
    expect: expectCodes([201, 200], codes),
  });
  const approveSpec = (p) => ({
    method: "POST",
    path: `/api/campaigns/${p.campaign.id}/applications/${p.id}/approve`,
    token: p.campaign.brand.token,
    expect: expectCodes([200], APPROVE_REFUSALS),
  });
  const accepted = (r) => r.results.filter((x) => x.status === 201 || x.status === 200).map((x) => ({ campaign: x.spec.campaign, id: x.body.id }));

  console.log("\nThroughput:");
  if (wanted("marketplace")) {
    // 1. Marketplace: creators browsing the full marketplace.
    record(
      await client.run(
        "GET /api/creators/marketplace",
        Array.from({ length: OPTIONS.marketplaceRequests }, (_, i) => ({ path: "/api/creators/marketplace", token: pick(creators, i * 131).token })),
        { concurrency: C }
      )
    );
  }

  if (wanted("join")) {
    // 2. Join: 1,000 creators each join 3 Open Call campaigns that have places.
    const targets = await withOpenPlaces(joinTargets, 3);
    record(
      await client.run(
        "POST /api/campaigns/:id/join",
        slice(0, 1000).flatMap((creator, i) => [0, 1, 2].map((k) => joinSpec(pick(targets, i * 3 + k * 17), creator))),
        { concurrency: C }
      )
    );
  }

  let applied = null;
  if (wanted("apply") || wanted("approve")) {
    // 3. Apply: 1,000 creators each apply to 3 Application Required campaigns.
    const targets = await withOpenPlaces(applyTargets, 1);
    applied = record(
      await client.run(
        "POST /api/campaigns/:id/apply",
        slice(1000, 2000).flatMap((creator, i) => [0, 1, 2].map((k) => applySpec(pick(targets, i * 3 + k * 11), creator))),
        { concurrency: C }
      )
    );
  }

  if (wanted("approve") && applied) {
    // 4. Approve: brands approve the applications that just came in (more than there are places).
    record(await client.run("POST /api/campaigns/:id/applications/:id/approve", accepted(applied).map(approveSpec), { concurrency: C }));
  }

  if (!wanted("races")) return { results, findings };
  console.log("\nRaces:");

  // 5. Join race: 30 creators for each of 40 campaigns with 5 places.
  const raceJoiners = slice(2000, 3200);
  record(
    await client.run(
      "join race: 30 creators per 5 places, 40 campaigns",
      raceJoin.flatMap((campaign, c) => raceJoiners.slice(c * 30, c * 30 + 30).map((creator) => joinSpec(campaign, creator))),
      { concurrency: BURST }
    )
  );

  // 6. Double join: 50 creators send the same join twice at once.
  const doubleJoinTargets = await withOpenPlaces(joinTargets, 2);
  const doubleJoin = record(
    await client.run(
      "double join: same creator and campaign twice at once",
      slice(3200, 3250).flatMap((creator, i) => {
        const spec = joinSpec(pick(doubleJoinTargets, i), creator);
        return [spec, { ...spec }];
      }),
      { concurrency: BURST }
    )
  );
  findings.push({ name: "A double join never takes two places", violations: bothWon(doubleJoin, (x) => x.status === 200) });

  // 7. Placement limit race: 50 creators each join 6 different campaigns at once (3 active at most).
  const limitTargets = await withOpenPlaces(joinTargets, 5);
  record(
    await client.run(
      "placement limit race: 6 joins at once per creator (limit 3)",
      slice(3250, 3300).flatMap((creator, i) => [0, 1, 2, 3, 4, 5].map((k) => joinSpec(pick(limitTargets, 60 + i * 6 + k), creator))),
      { concurrency: BURST }
    )
  );

  // 8. Approve race: 15 applicants on each of 40 campaigns with 5 places; every application approved at once.
  const raceApplicants = slice(3300, 3900);
  const raceApplied = await client.run(
    "apply (approve race setup)",
    raceApprove.flatMap((campaign, c) => raceApplicants.slice(c * 15, c * 15 + 15).map((creator) => applySpec(campaign, creator, []))),
    { concurrency: C }
  );
  record(await client.run("approve race: 15 approvals per 5 places, 40 campaigns", accepted(raceApplied).map(approveSpec), { concurrency: BURST }));

  // 9. Double apply, then double approve of those applications.
  const doubleApplyTargets = await withOpenPlaces(applyTargets, 2);
  const doubleApplied = record(
    await client.run(
      "double apply: same creator and campaign twice at once",
      slice(3900, 3950).flatMap((creator, i) => {
        const spec = applySpec(pick(doubleApplyTargets, i), creator);
        return [spec, { ...spec }];
      }),
      { concurrency: BURST }
    )
  );
  findings.push({ name: "A double apply never creates two applications", violations: bothWon(doubleApplied, (x) => x.status === 201) });
  const unique = [...new Map(accepted(doubleApplied).map((p) => [String(p.id), p])).values()];
  const doubleApprove = record(
    await client.run(
      "double approve: same application twice at once",
      unique.flatMap((p) => [approveSpec(p), approveSpec(p)]),
      { concurrency: BURST }
    )
  );
  findings.push({ name: "A double approve never approves twice", violations: bothWon(doubleApprove, (x) => x.status === 200) });

  return { results, findings };
}

function printReport({ totals, results, invariants, slowOps, api }) {
  const pad = (v, w) => String(v).padStart(w);
  console.log("\n| Scenario | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Unexpected |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.requests} | ${r.rps.toFixed(0)} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.max.toFixed(0)} | ${r.errors} (${(r.errorRate * 100).toFixed(2)}%) | ${r.unexpected} |`
    );
  }
  console.log("\nOutcomes:");
  for (const r of results) console.log(`  ${r.name}: ${JSON.stringify(r.outcomes)}`);
  console.log("\nInvariants:");
  for (const c of invariants.checks) console.log(`  ${c.violations.length === 0 ? "PASS" : "FAIL"} ${c.name}${c.violations.length ? ` (${c.violations.length}: ${JSON.stringify(c.violations.slice(0, 3))})` : ""}`);
  console.log(`  ${JSON.stringify(invariants.info)}`);
  console.log("\nSlowest query shapes while the scenarios ran (≥ 25 ms or a collection scan):");
  for (const s of slowOps) {
    console.log(`  ${pad(s.count, 5)}x ${s.ns} ${s.op} {${s.shape}} ${s.plan} max ${s.maxMs} ms, total ${s.totalMs} ms, docs examined up to ${s.docsExamined}`);
  }
  if (api.stderr.length) console.log(`\nAPI stderr (last 10 of ${api.stderr.length}):\n  ${api.stderr.slice(-10).join("\n  ")}`);
  console.log(`\nSeeded: ${JSON.stringify(totals)}`);
}

async function main() {
  // Refuse before anything starts.
  if (OPTIONS.mongoUri) assertLocalMongoUri(OPTIONS.mongoUri);
  if (OPTIONS.reuseSeed && !OPTIONS.mongoUri) throw new Error("--reuse-seed needs --mongo-uri: the database the seed was written to");
  const { startHarness, startMongod } = require("../../test/e2e/harness");

  // The harness signs tokens with these; the API process gets the same ones.
  process.env.JWT_EXPIRES_IN = "12h";
  let mongod = null;
  let api = null;
  let failed = false;
  try {
    mongod = OPTIONS.mongoUri ? { uri: assertLocalMongoUri(OPTIONS.mongoUri), stop: async () => {} } : await startMongod();
    assertLocalMongoUri(mongod.uri);
    console.log(`Throwaway database: ${mongod.uri}`);

    // Quiet the in-process request log while seeding.
    const realWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => (/ ms - /.test(String(chunk)) || /^\[(Cloudinary|S3)\]/.test(String(chunk)) ? true : realWrite(chunk, ...rest));

    let data;
    let secrets;
    if (OPTIONS.reuseSeed) {
      ({ data, secrets } = JSON.parse(fs.readFileSync(OPTIONS.reuseSeed, "utf8")));
      console.log(`Reusing the seed in ${OPTIONS.reuseSeed}: ${JSON.stringify(data.totals)}`);
    } else {
      const h = await startHarness({ mongod });
      try {
        data = await seed(h, OPTIONS);
      } finally {
        await h.stop();
      }
      secrets = { jwt: process.env.JWT_SECRET, refresh: process.env.JWT_REFRESH_SECRET, encryption: process.env.TOKEN_ENCRYPTION_KEY };
      if (OPTIONS.saveSeed) fs.writeFileSync(OPTIONS.saveSeed, JSON.stringify({ data, secrets }));
    }

    api = await startApi({ mongoUri: mongod.uri, secrets, cpuProf: OPTIONS.cpuProf });
    console.log(`API process ${api.pid} on ${api.baseUrl} (NODE_ENV=production, no .env)`);
    // Let the API's startup jobs settle before measuring.
    await new Promise((r) => setTimeout(r, 5000));

    await mongoose.connect(mongod.uri);
    const db = mongoose.connection.db;
    await startProfiler(db);

    const client = createClient(api.baseUrl, { maxSockets: 2000 });
    const { results, findings } = await runScenarios(client, data, OPTIONS.scenarios);
    client.close();

    const slowOps = await profilerReport(db);
    const invariants = await checkInvariants(data);
    for (const f of findings) invariants.checks.push({ name: f.name, violations: Array.from({ length: f.violations }, () => "both requests succeeded") });
    invariants.ok = invariants.checks.every((c) => c.violations.length === 0);
    printReport({ totals: data.totals, results, invariants, slowOps, api });

    if (OPTIONS.out) {
      fs.writeFileSync(OPTIONS.out, JSON.stringify({ options: { ...OPTIONS, scenarios: [...OPTIONS.scenarios] }, totals: data.totals, results, invariants, slowOps }, null, 2));
      console.log(`\nWrote ${OPTIONS.out}`);
    }
    failed = !invariants.ok || results.some((r) => r.errors > 0);
    console.log(failed ? "\nLOAD TEST FAILED" : "\nLoad test passed: no errors, every invariant holds");
  } finally {
    if (api) await api.stop();
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop();
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
