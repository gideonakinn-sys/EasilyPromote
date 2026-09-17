// Seeds the throwaway database with launch-scale volume through the real API (in-process, Paystack
// stubbed; see test/e2e/harness.js), so every document looks exactly like production writes it:
// brands, creators with a connected account, niches and self-reported audiences, paid live
// campaigns of every type, places already taken (some in the last 72 hours, for Trending),
// completed content and applications in every state. Then it sets aside what the scenarios need.
const path = require("node:path");
const mongoose = require("mongoose");

const SRC = path.join(__dirname, "..", "..", "src");
const model = (name) => require(path.join(SRC, "models", name));

const NICHES = ["Music", "Fashion", "Tech", "Comedy", "Food"];
const LOCATIONS = ["Lagos", "Abuja", "Rivers", "Oyo", "Kano"];
const DAY = 24 * 60 * 60 * 1000;

// Campaign mix per 1,000 campaigns: [objective, access, share]
const MIX = [
  ["content", "open_call", 250],
  ["content", "application_required", 150],
  ["views", "open_call", 250],
  ["views", "application_required", 75],
  ["signups", "open_call", 125],
  ["signups", "application_required", 75],
  ["downloads", "open_call", 50],
  ["downloads", "application_required", 25],
];

const brief = { summary: "Show the product in use in your own style", dos: ["Show the app on screen"], hashtags: ["#Launch"] };

function bodyFor(objective, access, i) {
  const base = { name: `${objective} ${access} ${i}`, campaignObjective: objective, creatorAccess: access, brief };
  // One in four campaigns targets an audience or sets eligibility, like real brands do.
  const targeted = i % 4 === 3;
  const targeting = targeted
    ? { audienceTargeting: { locations: [LOCATIONS[i % LOCATIONS.length]], platforms: ["tiktok"] }, creatorEligibility: { minFollowers: 2000 } }
    : {};
  if (objective === "content") {
    return {
      ...base,
      ...targeting,
      category: "Fashion",
      contentDestination: ["creator_page", "brand_page", "both"][i % 3],
      contentPay: { ratePerDeliverable: 10000 + (i % 5) * 2500, deliverables: 5 + (i % 26) },
    };
  }
  if (objective === "views") return { ...base, ...targeting, category: "Music", targetViews: 50000 + (i % 10) * 25000, niches: ["Music"] };
  return { ...base, ...targeting, category: "Tech", targetViews: 100000, referral: { requestedBudget: 50000 + (i % 4) * 25000 } };
}

const pick = (list, i) => list[((i % list.length) + list.length) % list.length];

async function inBatches(items, size, fn, onProgress) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map((item, j) => fn(item, i + j)))));
    if (onProgress) onProgress(Math.min(i + size, items.length), items.length);
  }
  return out;
}

function progress(label) {
  let last = 0;
  return (done, total) => {
    if (done === total || Date.now() - last > 5000) {
      last = Date.now();
      console.log(`  ${label}: ${done}/${total}`);
    }
  };
}

async function createPaidCampaign(h, brand, body) {
  const created = await h.api("POST", "/api/campaigns", { token: brand.token, body });
  if (created.status !== 201) throw new Error(`Creating a campaign failed: ${created.status} ${JSON.stringify(created.body)}`);
  const checkout = await h.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  if (checkout.status !== 200) throw new Error(`Checkout failed: ${checkout.status} ${JSON.stringify(checkout.body)}`);
  h.paystack.markPaid(checkout.body.reference);
  const paid = await h.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  if (!paid.body || !paid.body.isPaid) throw new Error(`Payment didn't go through: ${JSON.stringify(paid.body)}`);
  return created.body.id;
}

async function seed(h, { creators: creatorCount, campaigns: campaignCount, brands: brandCount }) {
  const t0 = Date.now();

  console.log(`Seeding ${brandCount} brands, ${creatorCount} creators, ${campaignCount} campaigns...`);
  const brands = await inBatches(Array.from({ length: brandCount }), 25, () => h.registerBrand(), progress("brands"));
  const now = new Date();
  // Sign-up and download campaigns need a connected, verified app before they can be paid.
  await model("BusinessProfile").updateMany(
    { userId: { $in: brands.map((b) => b.id) } },
    { $set: { "referralVerification.codeCheckAt": now, "referralVerification.conversionAt": now, "referralVerification.verifiedAt": now } }
  );

  // The first sign-up per niche creates the niche; the rest run in parallel.
  const creators = [];
  for (const niche of NICHES) creators.push(await h.registerCreator({ niches: ["Music", niche].filter((n, i, a) => a.indexOf(n) === i) }));
  creators.push(
    ...(await inBatches(
      Array.from({ length: creatorCount - creators.length }),
      25,
      (_, i) => h.registerCreator({ niches: ["Music", pick(NICHES, i)].filter((n, j, a) => a.indexOf(n) === j) }),
      progress("creators")
    ))
  );

  // Self-reported audiences and follower counts, spread across locations.
  const CreatorProfile = model("CreatorProfile");
  await CreatorProfile.bulkWrite(
    creators.map((c, i) => ({
      updateOne: {
        filter: { userId: new mongoose.Types.ObjectId(c.id) },
        update: {
          $set: {
            socialAccounts: [{ platform: "tiktok", handle: c.username, followers: 500 + ((i * 7919) % 60000) }],
            audience: {
              locations: [
                { name: pick(LOCATIONS, i), percentage: 55 + (i % 30) },
                { name: pick(LOCATIONS, i + 1), percentage: 15 },
              ],
              source: "self_reported",
              updatedAt: now,
            },
          },
        },
      },
    }))
  );

  const specs = [];
  const scale = campaignCount / 1000;
  for (const [objective, access, share] of MIX) {
    for (let i = 0; i < Math.round(share * scale); i += 1) specs.push({ objective, access, i });
  }
  const campaigns = await inBatches(
    specs.map((spec, index) => ({ ...spec, brand: pick(brands, index) })),
    20,
    async ({ objective, access, i, brand }) => ({
      id: await createPaidCampaign(h, brand, bodyFor(objective, access, i)),
      objective,
      access,
      brand,
      targeted: i % 4 === 3,
    }),
    progress("campaigns")
  );

  // Race campaigns: fresh Open Call and Application Required content campaigns with 5 places each.
  const raceBody = (access, i) => ({
    name: `race ${access} ${i}`,
    campaignObjective: "content",
    creatorAccess: access,
    brief,
    category: "Fashion",
    contentDestination: "creator_page",
    contentPay: { ratePerDeliverable: 10000, deliverables: 5 },
  });
  const raceJoin = await inBatches(Array.from({ length: 40 }), 20, async (_, i) => {
    const brand = pick(brands, i);
    return { id: await createPaidCampaign(h, brand, raceBody("open_call", i)), brand, places: 5 };
  });
  const raceApprove = await inBatches(Array.from({ length: 40 }), 20, async (_, i) => {
    const brand = pick(brands, i + 3);
    return { id: await createPaidCampaign(h, brand, raceBody("application_required", i)), brand, places: 5 };
  });
  const raceIds = new Set([...raceJoin, ...raceApprove].map((c) => c.id));

  // Places already taken: about 40% of each campaign's places by creators who finished their work
  // (not active, so they can still join more), a fifth of them in the last 72 hours.
  const Slot = model("Slot");
  const Submission = model("Submission");
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const slots = await Slot.find({ campaignId: { $in: campaigns.map((c) => new mongoose.Types.ObjectId(c.id)) } })
    .select("campaignId")
    .sort({ campaignId: 1, createdAt: 1, _id: 1 })
    .lean();
  const byCampaign = new Map();
  for (const slot of slots) {
    const key = String(slot.campaignId);
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push(slot);
  }
  const slotUpdates = [];
  const submissions = [];
  let fillerCursor = 0;
  for (const [campaignId, list] of byCampaign) {
    const campaign = campaignById.get(campaignId);
    const fill = Math.floor(list.length * 0.4);
    for (let k = 0; k < fill; k += 1) {
      // Consecutive creators, so one creator never holds two places in a campaign.
      const creator = pick(creators, fillerCursor++);
      const claimedAt = new Date(Date.now() - (k % 5 === 0 ? 1 : 4 + (k % 20)) * DAY);
      slotUpdates.push({
        updateOne: {
          filter: { _id: list[k]._id },
          update: { $set: { creatorId: new mongoose.Types.ObjectId(creator.id), status: "approved", claimedAt, completedAt: now } },
        },
      });
      const content = campaign.objective === "content";
      submissions.push({
        campaignId: new mongoose.Types.ObjectId(campaignId),
        creatorId: new mongoose.Types.ObjectId(creator.id),
        creatorHandle: creator.username,
        slotId: list[k]._id,
        videoUrl: "https://www.tiktok.com/@c/video/1",
        caption: "#Launch",
        status: content ? "completed" : "awaiting_post",
        viewsDelivered: content ? 0 : 4000,
        ...(content && { completedAt: new Date(claimedAt.getTime() + DAY) }),
        submittedAt: new Date(claimedAt.getTime() + DAY / 2),
      });
    }
  }
  await inBatches(chunk(slotUpdates, 2000), 1, (batch) => Slot.bulkWrite(batch));
  await inBatches(chunk(submissions, 2000), 1, (batch) => Submission.insertMany(batch, { ordered: false }));

  // Applications in every state on Application Required campaigns, about 4 per campaign.
  const CampaignApplication = model("CampaignApplication");
  const { buildApplicantSnapshot } = require(path.join(SRC, "services", "applicantSnapshot"));
  const profiles = new Map((await CreatorProfile.find({}).lean()).map((p) => [String(p.userId), p]));
  const users = new Map((await model("User").find({ role: "creator" }).select("name avatar").lean()).map((u) => [String(u._id), u]));
  const appCampaigns = campaigns.filter((c) => c.access === "application_required");
  const statuses = ["pending", "pending", "approved", "rejected", "expired", "withdrawn"];
  const applications = [];
  const seen = new Set();
  // Applicants come from the back of the creator list, clear of the scenario creators at the front.
  const applicantPool = creators.slice(Math.floor(creators.length * 0.8));
  for (let i = 0; applications.length < appCampaigns.length * 4; i += 1) {
    const campaign = pick(appCampaigns, i);
    const creator = pick(applicantPool, i * 7 + 3);
    const key = `${campaign.id}:${creator.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    applications.push({
      campaign: new mongoose.Types.ObjectId(campaign.id),
      creator: new mongoose.Types.ObjectId(creator.id),
      status: pick(statuses, i),
      pitch: "I make videos like this every week",
      applicantSnapshot: buildApplicantSnapshot(profiles.get(creator.id), users.get(creator.id)),
      matchScore: (i * 13) % 100,
      appliedAt: new Date(Date.now() - ((i % 10) + 1) * DAY * 0.5),
    });
  }
  await inBatches(chunk(applications, 2000), 1, (batch) => CampaignApplication.insertMany(batch, { ordered: false }));

  const totals = {
    brands: brands.length,
    creators: creators.length,
    liveCampaigns: await model("Campaign").countDocuments({ status: "live" }),
    placements: await Slot.countDocuments(),
    placesTaken: await Slot.countDocuments({ creatorId: { $ne: null } }),
    placesOpen: await Slot.countDocuments({ status: "available" }),
    submissions: await Submission.countDocuments(),
    applications: await CampaignApplication.countDocuments(),
  };
  console.log(`Seeded in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${JSON.stringify(totals)}`);

  const untargeted = (c) => !c.targeted && !raceIds.has(c.id);
  return {
    totals,
    brands,
    creators,
    campaigns,
    raceJoin,
    raceApprove,
    joinTargets: campaigns.filter((c) => c.access === "open_call" && untargeted(c)),
    applyTargets: campaigns.filter((c) => c.access === "application_required" && untargeted(c)),
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

module.exports = { seed, pick };
