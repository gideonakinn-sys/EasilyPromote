#!/usr/bin/env node
// Times the hot endpoints against a throwaway database it seeds itself (M7 speed check). It uses the
// end-to-end harness: a scratch mongod, the real Express app in-process and a Paystack stub. It never
// reads Backend/.env or MONGODB_URI and writes only to the scratch database it deletes afterwards.
//
//   node scripts/measureEndpoints.js [--runs 20] [--trace]
//
// Seeds 50 brands, 300 creators, 200 live campaigns of mixed types (content, views, sign-ups,
// downloads; Open Call and Application Required), ~2,000 placements, ~1,500 submissions and ~600
// applications, then reports p50/p95 latency over N runs per endpoint and the MongoDB queries each
// request makes (counted with mongoose's debug hook). Mutating endpoints get a fresh subject per run.
//
// Results on a dev laptop (Windows, local mongod, 20 runs each). Queries are every MongoDB operation
// the request makes, the auth lookup included. Locally every query is ~1 ms; against Atlas from
// Render each one costs a network round trip, so the query count is the number that matters.
//
//                                         before (m6 tip)            after (m7/hardening)
//   endpoint                              p50    p95    queries      p50    p95    queries
//   GET  /api/creators/dashboard          65.9   81.5   33           41.0   44.8   14
//   POST /api/campaigns/:id/join          19.5   24.5   15            11.3   12.7    8
//   POST /api/campaigns/:id/apply         11.0   12.6   11             9.9   11.1    8
//   GET  /api/campaigns/:id/applications   9.7   11.3    4             8.2    9.5    4
//   POST /applications/:id/approve        24.2   27.5   20            15.7   17.6   11
//   GET  /api/submissions/campaign/:id    23.5   27.8   10            11.9   14.6    5
//   GET  /api/campaigns (brand list)       7.7    8.8    4             6.3    7.7    4
//   GET  /api/admin/campaigns             36.2   41.7    5            20.6   23.4    5
//   GET  /api/creators/wallet             21.1   25.3   19            12.5   14.2    9
//
// What changed: the dashboard and wallet load the creator's rows once and build every section from
// them (they used to reload slots, submissions, campaigns and earnings per section); profile and
// social connections are one $unionWith query; joining reads the campaign's open and held places in
// one query and counts places left in the pool re-check it already ran; approval reuses the campaign
// and brand it loaded; the brand's submission list counts statuses in one aggregation instead of five
// sequential counts; the admin campaign list counts matching creators in the database instead of
// loading every creator profile. New indexes: transactions {creatorId, type, status} and
// {submissionId, type} (fixed credits and releases had no creator index), applications
// {creator, appliedAt}.

const path = require("node:path");
const mongoose = require("mongoose");
const { startHarness } = require("../test/e2e/harness");

const SRC = path.join(__dirname, "..", "src");
const model = (name) => require(path.join(SRC, "models", name));

const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) || 20 : 20;

const COUNTS = { brands: 50, creators: 300, campaigns: 200, submissions: 1500, applications: 600 };

// Quiet the request log so it doesn't swamp the report.
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => (/\d+\.\d+ ms - /.test(String(chunk)) ? true : realWrite(chunk, ...rest));

let queries = 0;
// --trace prints every query of each endpoint's first timed run.
const TRACE = process.argv.includes("--trace");
let tracing = false;
mongoose.set("debug", (collection, method, filter) => {
  queries += 1;
  if (tracing) console.log(`    ${collection}.${method} ${JSON.stringify(filter || {}).slice(0, 160)}`);
});

const brief = { summary: "Show the product in use", hashtags: ["#Launch"] };

// Campaign mix: [objective, access, count]
const MIX = [
  ["views", "open_call", 60],
  ["views", "application_required", 20],
  ["content", "open_call", 30],
  ["content", "application_required", 30],
  ["signups", "open_call", 20],
  ["signups", "application_required", 20],
  ["downloads", "open_call", 10],
  ["downloads", "application_required", 10],
];
const DELIVERABLES = 22;

function bodyFor(objective, access, i) {
  const base = { name: `${objective} ${access} ${i}`, campaignObjective: objective, creatorAccess: access, brief };
  if (objective === "content") {
    return { ...base, category: "Fashion", contentDestination: ["creator_page", "brand_page", "both"][i % 3], contentPay: { ratePerDeliverable: 10000, deliverables: DELIVERABLES } };
  }
  if (objective === "views") return { ...base, category: "Music", targetViews: 100000, niches: ["Music"] };
  return { ...base, category: "Tech", targetViews: 100000, referral: { requestedBudget: 50000 } };
}

const pick = (list, i) => list[i % list.length];

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function seed(h) {
  const t0 = Date.now();
  const brands = await inBatches(Array.from({ length: COUNTS.brands }), 10, () => h.registerBrand());
  const now = new Date();
  await model("BusinessProfile").updateMany(
    { userId: { $in: brands.map((b) => b.id) } },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } }
  );
  // The first sign-up creates the shared niche; the rest can run in parallel.
  const creators = [await h.registerCreator()];
  creators.push(...(await inBatches(Array.from({ length: COUNTS.creators - 1 }), 10, () => h.registerCreator())));
  const admin = await h.registerAdmin({ role: "admin" });

  const specs = [];
  for (const [objective, access, count] of MIX) for (let i = 0; i < count; i += 1) specs.push({ objective, access, i });
  const campaigns = await inBatches(
    specs.map((spec, index) => ({ ...spec, brand: pick(brands, index) })),
    10,
    async ({ objective, access, i, brand }) => {
      const created = await h.api("POST", "/api/campaigns", { token: brand.token, body: bodyFor(objective, access, i) });
      if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
      const checkout = await h.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
      h.paystack.markPaid(checkout.body.reference);
      const paid = await h.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
      if (!paid.body.isPaid) throw new Error(`pay failed: ${JSON.stringify(paid.body)}`);
      return { id: created.body.id, objective, access, brand };
    }
  );

  // Subjects the timed requests use, kept clear of seeded placements and applications.
  const measured = {
    creator: creators[0],
    brand: brands[0],
    admin,
    joiners: creators.slice(1, 1 + RUNS + 2),
    appliers: creators.slice(1 + RUNS + 2, 1 + 2 * (RUNS + 2)),
    approvees: creators.slice(1 + 2 * (RUNS + 2), 1 + 3 * (RUNS + 2)),
  };
  const reserved = new Set([measured.creator, ...measured.joiners, ...measured.appliers, ...measured.approvees].map((c) => c.id));
  const fillers = creators.filter((c) => !reserved.has(c.id));

  const openContent = campaigns.filter((c) => c.objective === "content" && c.access === "open_call");
  const appContent = campaigns.filter((c) => c.objective === "content" && c.access === "application_required");
  const approveCampaign = appContent.find((c) => c.brand.id === brands[0].id) || appContent[0];
  const reviewCampaign = openContent.find((c) => c.brand.id === brands[0].id) || openContent[0];

  // Placements: fill most places, leaving 3 open on each content campaign (joins) and the approval
  // campaign empty (approvals).
  const Slot = model("Slot");
  const Submission = model("Submission");
  const slots = await Slot.find({}).sort({ campaignId: 1, _id: 1 }).lean();
  const byCampaign = new Map();
  for (const slot of slots) {
    const key = String(slot.campaignId);
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push(slot);
  }
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const slotUpdates = [];
  const submissions = [];
  let fillerIndex = 0;
  let creatorPlacements = 0;
  for (const [campaignId, list] of byCampaign) {
    if (campaignId === approveCampaign.id) continue;
    const campaign = campaignById.get(campaignId);
    const fill = campaign.objective === "content" ? list.length - 3 : 3;
    const used = new Set();
    for (const slot of list.slice(0, fill)) {
      if (submissions.length >= COUNTS.submissions) break;
      let creator;
      if (creatorPlacements < 10 && !used.has(measured.creator.id)) {
        creator = measured.creator;
        creatorPlacements += 1;
      } else {
        do creator = pick(fillers, fillerIndex++);
        while (used.has(creator.id));
      }
      used.add(creator.id);
      const active = creator === measured.creator ? creatorPlacements <= 3 : fillerIndex % 3 === 0;
      const slotStatus = active ? "submitted" : "approved";
      slotUpdates.push({
        updateOne: {
          filter: { _id: slot._id },
          update: { $set: { creatorId: new mongoose.Types.ObjectId(creator.id), status: slotStatus, claimedAt: new Date(Date.now() - 5 * 86400000) } },
        },
      });
      const content = campaign.objective === "content";
      submissions.push({
        campaignId: new mongoose.Types.ObjectId(campaignId),
        creatorId: new mongoose.Types.ObjectId(creator.id),
        creatorHandle: creator.username,
        slotId: slot._id,
        videoUrl: "https://www.tiktok.com/@c/video/1",
        caption: "#Launch",
        status: active ? "new" : content ? "completed" : "awaiting_post",
        viewsDelivered: content ? 0 : 5000,
        ...(active && content && { awaitingBrandSince: new Date() }),
        ...(!active && content && { completedAt: new Date(Date.now() - 2 * 86400000) }),
        submittedAt: new Date(Date.now() - 4 * 86400000),
      });
    }
  }
  await Slot.bulkWrite(slotUpdates);
  await Submission.insertMany(submissions);

  // Applications on Application Required campaigns from filler creators.
  const CampaignApplication = model("CampaignApplication");
  const { buildApplicantSnapshot } = require(path.join(SRC, "services", "applicantSnapshot"));
  const profiles = new Map((await model("CreatorProfile").find({}).lean()).map((p) => [String(p.userId), p]));
  const users = new Map((await model("User").find({ role: "creator" }).select("name avatar").lean()).map((u) => [String(u._id), u]));
  const appCampaigns = campaigns.filter((c) => c.access === "application_required");
  const applications = [];
  const statuses = ["pending", "pending", "pending", "approved", "rejected", "expired"];
  for (let i = 0; applications.length < COUNTS.applications; i += 1) {
    const campaign = pick(appCampaigns, i);
    const creator = pick(fillers, i * 7 + 3);
    if (applications.some((a) => String(a.campaign) === campaign.id && String(a.creator) === creator.id)) continue;
    applications.push({
      campaign: new mongoose.Types.ObjectId(campaign.id),
      creator: new mongoose.Types.ObjectId(creator.id),
      status: pick(statuses, i),
      pitch: "I make videos like this every week",
      applicantSnapshot: buildApplicantSnapshot(profiles.get(creator.id), users.get(creator.id)),
      matchScore: (i * 13) % 100,
      appliedAt: new Date(Date.now() - ((i % 6) + 1) * 86400000),
    });
  }
  await CampaignApplication.insertMany(applications);

  // Approvals need pending applications from creators who can take a place.
  const approvals = [];
  for (const creator of measured.approvees) {
    const applied = await h.api("POST", `/api/campaigns/${approveCampaign.id}/apply`, { token: creator.token, body: { pitch: "Pick me" } });
    if (applied.status !== 201) throw new Error(`apply for approval failed: ${JSON.stringify(applied.body)}`);
    approvals.push(applied.body.id);
  }

  const totals = {
    brands: brands.length,
    creators: creators.length,
    campaigns: campaigns.length,
    placements: await Slot.countDocuments(),
    heldPlacements: await Slot.countDocuments({ creatorId: { $ne: null } }),
    submissions: await Submission.countDocuments(),
    applications: await CampaignApplication.countDocuments(),
  };
  console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(totals)}`);
  return { measured, campaigns, openContent, appContent, approveCampaign, reviewCampaign, approvals };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measure(h, label, makeRequest, { expect = [200, 201] } = {}) {
  const times = [];
  const counts = [];
  // Warm up (not timed): first requests compile paths and fill connection pools.
  for (let i = 0; i < 2; i += 1) await makeRequest(-1 - i);
  for (let i = 0; i < RUNS; i += 1) {
    queries = 0;
    tracing = TRACE && i === 0;
    if (tracing) console.log(`${label}:`);
    const start = process.hrtime.bigint();
    const res = await makeRequest(i);
    tracing = false;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (!expect.includes(res.status)) throw new Error(`${label} run ${i}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    times.push(ms);
    counts.push(queries);
  }
  times.sort((a, b) => a - b);
  const sortedCounts = [...counts].sort((a, b) => a - b);
  return { label, p50: percentile(times, 50), p95: percentile(times, 95), queries: percentile(sortedCounts, 50), maxQueries: sortedCounts[sortedCounts.length - 1] };
}

async function main() {
  const h = await startHarness();
  try {
    const { measured, openContent, appContent, approveCampaign, reviewCampaign, approvals } = await seed(h);
    const { creator, brand, admin, joiners, appliers } = measured;
    const results = [];

    results.push(await measure(h, "GET  /api/creators/dashboard", () => h.api("GET", "/api/creators/dashboard", { token: creator.token })));

    // Each run: a fresh creator joins a different Open Call content campaign (the two warm-ups use the spares).
    results.push(
      await measure(h, "POST /api/campaigns/:id/join", (i) => {
        const index = i < 0 ? RUNS - 1 - i : i;
        return h.api("POST", `/api/campaigns/${pick(openContent, index).id}/join`, { token: joiners[index].token });
      })
    );

    const appTargets = appContent.filter((c) => c.id !== approveCampaign.id);
    results.push(
      await measure(h, "POST /api/campaigns/:id/apply", (i) => {
        const index = i < 0 ? RUNS - 1 - i : i;
        return h.api("POST", `/api/campaigns/${pick(appTargets, index).id}/apply`, { token: appliers[index].token, body: { pitch: "Hello" } });
      })
    );

    const approveBrand = approveCampaign.brand;
    results.push(
      await measure(h, "GET  /api/campaigns/:id/applications", () =>
        h.api("GET", `/api/campaigns/${approveCampaign.id}/applications?sort=match`, { token: approveBrand.token })
      )
    );

    results.push(
      await measure(h, "POST /applications/:id/approve", (i) => {
        const index = i < 0 ? RUNS - 1 - i : i;
        return h.api("POST", `/api/campaigns/${approveCampaign.id}/applications/${approvals[index]}/approve`, { token: approveBrand.token });
      })
    );

    results.push(
      await measure(h, "GET  /api/submissions/campaign/:id", () =>
        h.api("GET", `/api/submissions/campaign/${reviewCampaign.id}`, { token: reviewCampaign.brand.token })
      )
    );
    results.push(await measure(h, "GET  /api/campaigns (brand list)", () => h.api("GET", "/api/campaigns", { token: brand.token })));
    results.push(await measure(h, "GET  /api/admin/campaigns", () => h.api("GET", "/api/admin/campaigns", { token: admin.token })));
    results.push(await measure(h, "GET  /api/creators/wallet", () => h.api("GET", "/api/creators/wallet", { token: creator.token })));

    const pad = (value, width) => String(value).padStart(width);
    console.log(`\n${RUNS} runs each; queries = median (max) MongoDB operations per request\n`);
    console.log(`${"endpoint".padEnd(42)} ${pad("p50 ms", 8)} ${pad("p95 ms", 8)} ${pad("queries", 12)}`);
    for (const r of results) {
      console.log(`${r.label.padEnd(42)} ${pad(r.p50.toFixed(1), 8)} ${pad(r.p95.toFixed(1), 8)} ${pad(`${r.queries} (${r.maxQueries})`, 12)}`);
    }
  } finally {
    await h.stop();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { seed };
