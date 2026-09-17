// Application Required (ticket 06): a creator applies with a frozen profile snapshot, the brand
// reviews applicants for this campaign and approves (reserving a place) or rejects.
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

const DAY = 24 * 60 * 60 * 1000;

const brief = {
  summary: "Style three looks from the summer drop",
  dos: ["Show the fabric up close"],
  donts: ["No competitor brands in frame"],
  hashtags: ["#SummerDrop"],
};

async function liveCampaign(body = {}) {
  const Campaign = require("../../src/models/Campaign");
  const { ensureCampaignSlots } = require("../../src/utils/ensureSlots");
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Summer lookbook",
      category: "Fashion",
      campaignObjective: "content",
      contentPay: { ratePerDeliverable: 15000, deliverables: 2 },
      creatorAccess: "application_required",
      brief,
      ...body,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const campaign = await Campaign.findByIdAndUpdate(created.body.id, { $set: { status: "live" } }, { new: true });
  await ensureCampaignSlots(campaign);
  return { brand, id: created.body.id };
}

async function creatorWithAudience(locations) {
  const creator = await harness.registerCreator();
  const saved = await harness.api("PUT", "/api/creators/profile/audience", {
    token: creator.token,
    body: { locations, genders: { female: 60, male: 40, other: 0 }, proofUrl: "https://files.example.com/analytics.png" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return creator;
}

const apply = (id, creator, body) => harness.api("POST", `/api/campaigns/${id}/apply`, { token: creator.token, body });
const heldPlacements = (campaignId) => require("../../src/models/Slot").find({ campaignId, status: { $ne: "available" } }).lean();
const notificationsFor = (token) => harness.api("GET", "/api/notifications", { token }).then((r) => r.body);

test("an eligible creator applies with a pitch; the snapshot is frozen and nothing is reserved", async () => {
  const { id } = await liveCampaign();
  const creator = await harness.registerCreator();
  await harness.api("PUT", "/api/creators/profile/me", { token: creator.token, body: { city: "Ikeja", state: "Lagos" } });

  const applied = await apply(id, creator, { pitch: "I style summer looks every week" });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.status, "pending");
  assert.equal(applied.body.pitch, "I style summer looks every week");
  assert.equal((await heldPlacements(id)).length, 0);

  // Later profile changes don't change what the brand reviews.
  await harness.api("PUT", "/api/creators/profile/me", { token: creator.token, body: { city: "Kano", state: "Kano" } });
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const stored = await CampaignApplication.findById(applied.body.id).lean();
  assert.equal(stored.applicantSnapshot.username, creator.username);
  assert.equal(stored.applicantSnapshot.location.city, "Ikeja");

  const again = await apply(id, creator, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "ALREADY_APPLIED");
});

test("apply is only for live Application Required campaigns and runs the shared eligibility check", async () => {
  const openCall = await liveCampaign({ creatorAccess: "open_call" });
  const creator = await harness.registerCreator();
  const refused = await apply(openCall.id, creator, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "OPEN_CALL");

  const { id } = await liveCampaign({
    audienceTargeting: { platforms: ["instagram"] },
    creatorEligibility: { minFollowers: 5000, verifiedOnly: true },
  });
  const locked = await harness.registerCreator({ niches: [], connected: false });
  const ineligible = await apply(id, locked, {});
  assert.equal(ineligible.status, 403);
  assert.equal(ineligible.body.code, "NOT_ELIGIBLE");
  assert.deepEqual(
    ineligible.body.failures.map((f) => f.criterion).sort(),
    ["minFollowers", "niches", "platform", "socialAccount", "verified"]
  );
  const CampaignApplication = require("../../src/models/CampaignApplication");
  assert.equal(await CampaignApplication.countDocuments({ campaign: id }), 0);

  const tooLong = await apply(id, creator, { pitch: "x".repeat(501) });
  assert.equal(tooLong.status, 400);
});

test("a creator withdraws a pending application and can apply again later", async () => {
  const { id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});

  const withdrawn = await harness.api("POST", `/api/campaigns/${id}/apply/withdraw`, { token: creator.token });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
  assert.equal(withdrawn.body.status, "withdrawn");

  const twice = await harness.api("POST", `/api/campaigns/${id}/apply/withdraw`, { token: creator.token });
  assert.equal(twice.status, 409);

  const reapplied = await apply(id, creator, { pitch: "Changed my mind" });
  assert.equal(reapplied.status, 201);
  assert.equal(reapplied.body.id, applied.body.id, "still one application per creator per campaign");
  assert.equal(reapplied.body.status, "pending");
});

test("the brand lists applicants with counts, filters by status and sorts by match score", async () => {
  const { brand, id } = await liveCampaign({ audienceTargeting: { locations: ["Lagos"] } });
  const low = await creatorWithAudience([{ name: "Lagos", percentage: 20 }, { name: "Abuja", percentage: 70 }]);
  const high = await creatorWithAudience([{ name: "Lagos", percentage: 90 }]);
  const withdrawer = await harness.registerCreator();
  await apply(id, low, {});
  await apply(id, high, {});
  await apply(id, withdrawer, {});
  await harness.api("POST", `/api/campaigns/${id}/apply/withdraw`, { token: withdrawer.token });

  const list = await harness.api("GET", `/api/campaigns/${id}/applications?sort=match`, { token: brand.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.counts, { all: 3, pending: 2, approved: 0, rejected: 0, withdrawn: 1, expired: 0 });
  assert.equal(list.body.applications.length, 3);

  const pending = await harness.api("GET", `/api/campaigns/${id}/applications?status=pending&sort=match`, { token: brand.token });
  assert.deepEqual(pending.body.applications.map((a) => a.creator.username), [high.username, low.username]);
  assert.ok(pending.body.applications[0].matchScore > pending.body.applications[1].matchScore);

  const snapshot = await harness.api("GET", `/api/campaigns/${id}/applications/${pending.body.applications[1].id}`, { token: brand.token });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.sections[0].key, "audience");
  assert.equal(snapshot.body.sections[0].data.targetedShare, 20);
  assert.equal(snapshot.body.applicant.username, low.username);
  const text = JSON.stringify(snapshot.body);
  assert.ok(!text.includes(low.email), "no creator email in the snapshot");

  const otherBrand = await harness.registerBrand();
  const denied = await harness.api("GET", `/api/campaigns/${id}/applications`, { token: otherBrand.token });
  assert.equal(denied.status, 403);
  const creatorDenied = await harness.api("GET", `/api/campaigns/${id}/applications`, { token: low.token });
  assert.equal(creatorDenied.status, 403);
});

test("approve reserves a place, tells the creator they've been selected and unlocks the brief", async () => {
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});

  const otherBrand = await harness.registerBrand();
  const notMine = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: otherBrand.token });
  assert.equal(notMine.status, 403);

  const approved = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "approved");
  assert.equal(approved.body.placement.kind, "deliverable");
  assert.equal(approved.body.placesLeft, 1);

  const held = await heldPlacements(id);
  assert.equal(held.length, 1);
  assert.equal(String(held[0].creatorId), creator.id);

  const notes = await notificationsFor(creator.token);
  assert.ok(notes.some((n) => n.type === "application_approved" && n.title === "You've been selected"));

  const dashboard = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  const mine = dashboard.body.campaigns.campaigns.find((c) => String(c.id) === id);
  assert.ok(mine, "approved campaign is in the creator's campaigns");
  assert.deepEqual(mine.brief.dos, brief.dos);
  const application = dashboard.body.applications.find((a) => String(a.campaignId) === id);
  assert.equal(application.status, "approved");
  assert.equal(application.campaignName, "Summer lookbook");
  assert.equal(application.pay.amount, 15000);

  const twice = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.code, "NOT_PENDING");
});

test("approving when no places are left is refused and the application stays pending", async () => {
  const { brand, id } = await liveCampaign({ contentPay: { ratePerDeliverable: 15000, deliverables: 1 } });
  const [first, second] = await Promise.all([harness.registerCreator(), harness.registerCreator()]);
  const a = await apply(id, first, {});
  const b = await apply(id, second, {});

  const ok = await harness.api("POST", `/api/campaigns/${id}/applications/${a.body.id}/approve`, { token: brand.token });
  assert.equal(ok.status, 200);
  const full = await harness.api("POST", `/api/campaigns/${id}/applications/${b.body.id}/approve`, { token: brand.token });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, "CAMPAIGN_FULL");
  assert.ok(full.body.error.length > 0);

  const detail = await harness.api("GET", `/api/campaigns/${id}/applications/${b.body.id}`, { token: brand.token });
  assert.equal(detail.body.status, "pending");
  assert.equal((await heldPlacements(id)).length, 1);
});

test("reject records the optional reason and tells the creator", async () => {
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});

  const rejected = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/reject`, {
    token: brand.token,
    body: { reason: "We need creators with more fashion content" },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, "rejected");
  assert.equal((await heldPlacements(id)).length, 0);

  const notes = await notificationsFor(creator.token);
  const note = notes.find((n) => n.type === "application_rejected");
  assert.ok(note && note.body.includes("We need creators with more fashion content"));

  const dashboard = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  const application = dashboard.body.applications.find((a) => String(a.campaignId) === id);
  assert.equal(application.status, "rejected");
  assert.equal(application.rejectionReason, "We need creators with more fashion content");

  const approveAfter = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approveAfter.status, 409);
  const reapply = await apply(id, creator, {});
  assert.equal(reapply.status, 409);
});

test("approving a sign-up campaign's applicant creates their referral code, as joining does", async () => {
  const { brand, id } = await liveCampaign({
    campaignObjective: "signups",
    contentPay: undefined,
    targetViews: 100000,
    referral: { requestedBudget: 50000 },
  });
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  const approved = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.ok(approved.body.placement.referralCode, "referral code is ready on approval");
});

test("Creator Approval never reads or writes submissions (ADR 0002)", async () => {
  const Submission = require("../../src/models/Submission");
  const { brand, id } = await liveCampaign({ contentPay: { ratePerDeliverable: 15000, deliverables: 3 } });
  const [approvedCreator, rejectedCreator] = await Promise.all([harness.registerCreator(), harness.registerCreator()]);
  const subs = await Promise.all(
    [approvedCreator, rejectedCreator].map((c) =>
      Submission.create({ campaignId: id, creatorId: c.id, creatorHandle: c.username, videoUrl: "https://www.tiktok.com/@c/video/1", status: "rejected", rejectionReason: "Earlier content" })
    )
  );
  const before = await Submission.find({ _id: { $in: subs.map((s) => s._id) } }).lean();

  const a = await apply(id, approvedCreator, {});
  const r = await apply(id, rejectedCreator, {});
  assert.equal((await harness.api("POST", `/api/campaigns/${id}/applications/${a.body.id}/approve`, { token: brand.token })).status, 200);
  assert.equal((await harness.api("POST", `/api/campaigns/${id}/applications/${r.body.id}/reject`, { token: brand.token, body: {} })).status, 200);

  const afterDocs = await Submission.find({ _id: { $in: subs.map((s) => s._id) } }).lean();
  assert.deepEqual(afterDocs, before);
});

test("pending applications remind the brand on day 3 once and expire after 7 days", async () => {
  const { processApplicationDeadlines } = require("../../src/services/applications");
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  const appliedAt = (await CampaignApplication.findById(applied.body.id).lean()).appliedAt.getTime();
  const brandReminders = async () => (await notificationsFor(brand.token)).filter((n) => n.type === "applications_reminder" && String(n.campaignId) === id);

  await processApplicationDeadlines({ now: new Date(appliedAt + 2 * DAY) });
  assert.equal((await brandReminders()).length, 0);

  await processApplicationDeadlines({ now: new Date(appliedAt + 3 * DAY + 1000) });
  assert.equal((await brandReminders()).length, 1);
  await processApplicationDeadlines({ now: new Date(appliedAt + 4 * DAY) });
  assert.equal((await brandReminders()).length, 1, "reminded once");
  assert.equal((await CampaignApplication.findById(applied.body.id).lean()).status, "pending");

  await processApplicationDeadlines({ now: new Date(appliedAt + 7 * DAY + 1000) });
  const expired = await CampaignApplication.findById(applied.body.id).lean();
  assert.equal(expired.status, "expired");
  const notes = await notificationsFor(creator.token);
  assert.ok(notes.some((n) => n.type === "application_expired"));

  const approve = await harness.api("POST", `/api/campaigns/${id}/applications/${applied.body.id}/approve`, { token: brand.token });
  assert.equal(approve.status, 409);
});

// ── Review fixes ─────────────────────────────────────────────────────────────────────────

const approveUrl = (id, applicationId) => `/api/campaigns/${id}/applications/${applicationId}/approve`;

test("approve returns the brief so the creator's screen can unlock it", async () => {
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  const approved = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body.brief.dos, brief.dos);
});

test("approving a creator who already holds a place here links to that place", async () => {
  const Slot = require("../../src/models/Slot");
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  // As an earlier approval that failed part-way could have left it.
  const slot = await Slot.findOneAndUpdate(
    { campaignId: id, status: "available" },
    { $set: { creatorId: creator.id, status: "claimed", claimedAt: new Date() } },
    { new: true }
  );

  const approved = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(String(approved.body.placement.id), String(slot._id));
  assert.equal((await heldPlacements(id)).length, 1);
});

test("a failure after the place is taken gives the place back and leaves the application pending", async () => {
  const { testHooks } = require("../../src/services/placements");
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});

  testHooks.afterTake = async () => {
    throw new Error("database hiccup");
  };
  try {
    const failed = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
    assert.equal(failed.status, 500);
  } finally {
    testHooks.afterTake = null;
  }
  assert.equal((await heldPlacements(id)).length, 0);
  const detail = await harness.api("GET", `/api/campaigns/${id}/applications/${applied.body.id}`, { token: brand.token });
  assert.equal(detail.body.status, "pending");

  const retried = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal((await heldPlacements(id)).length, 1);
});

test("approve takes no place on a campaign paused after the brand's request loaded it", async () => {
  const Campaign = require("../../src/models/Campaign");
  const { testHooks } = require("../../src/services/placements");
  const { brand, id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});

  // Paused between loading the campaign and reserving the place.
  testHooks.beforeReserve = () => Campaign.updateOne({ _id: id }, { $set: { status: "paused" } });
  try {
    const refused = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "CAMPAIGN_NOT_LIVE");
  } finally {
    testHooks.beforeReserve = null;
  }
  assert.equal((await heldPlacements(id)).length, 0, "no place taken");
  let detail = await harness.api("GET", `/api/campaigns/${id}/applications/${applied.body.id}`, { token: brand.token });
  assert.equal(detail.body.status, "pending");

  // Paused while the place was being taken: it's given back.
  await Campaign.updateOne({ _id: id }, { $set: { status: "live" } });
  testHooks.beforeReserve = null;
  testHooks.afterTake = () => Campaign.updateOne({ _id: id }, { $set: { status: "paused" } });
  try {
    const refused = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "CAMPAIGN_NOT_LIVE");
  } finally {
    testHooks.afterTake = null;
  }
  assert.equal((await heldPlacements(id)).length, 0, "the place was given back");
  detail = await harness.api("GET", `/api/campaigns/${id}/applications/${applied.body.id}`, { token: brand.token });
  assert.equal(detail.body.status, "pending");

  // The pool check reads the campaign's current creator pool, not the one loaded with the request.
  await Campaign.updateOne({ _id: id }, { $set: { status: "live" } });
  testHooks.afterTake = () => Campaign.updateOne({ _id: id }, { $set: { creatorPool: 100 } });
  try {
    const refused = await harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "CAMPAIGN_FULL");
  } finally {
    testHooks.afterTake = null;
  }
  assert.equal((await heldPlacements(id)).length, 0);
});

test("the deadline job puts an approved application with no place back to pending", async () => {
  const { processApplicationDeadlines } = require("../../src/services/applications");
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const { id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  const now = Date.now();
  await CampaignApplication.updateOne({ _id: applied.body.id }, { $set: { status: "approved", reviewedAt: new Date(now - 60 * 60 * 1000) } });

  await processApplicationDeadlines({ now: new Date(now) });
  assert.equal((await CampaignApplication.findById(applied.body.id).lean()).status, "pending");
});

test("an approval still in progress isn't repaired by the deadline job", async () => {
  const { processApplicationDeadlines } = require("../../src/services/applications");
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const { id } = await liveCampaign();
  const creator = await harness.registerCreator();
  const applied = await apply(id, creator, {});
  const now = Date.now();
  await CampaignApplication.updateOne({ _id: applied.body.id }, { $set: { status: "approved", reviewedAt: new Date(now - 1000) } });

  await processApplicationDeadlines({ now: new Date(now) });
  assert.equal((await CampaignApplication.findById(applied.body.id).lean()).status, "approved");
});

test("no reminders for campaigns that aren't live; closed campaigns expire their pending applications", async () => {
  const { processApplicationDeadlines } = require("../../src/services/applications");
  const CampaignApplication = require("../../src/models/CampaignApplication");
  const Campaign = require("../../src/models/Campaign");

  const paused = await liveCampaign();
  const pausedCreator = await harness.registerCreator();
  const pausedApp = await apply(paused.id, pausedCreator, {});
  await Campaign.updateOne({ _id: paused.id }, { $set: { status: "paused" } });
  const appliedAt = (await CampaignApplication.findById(pausedApp.body.id).lean()).appliedAt.getTime();
  await processApplicationDeadlines({ now: new Date(appliedAt + 4 * DAY) });
  const pausedNotes = (await notificationsFor(paused.brand.token)).filter((n) => n.type === "applications_reminder");
  assert.equal(pausedNotes.length, 0);
  const pausedAfter = await CampaignApplication.findById(pausedApp.body.id).lean();
  assert.equal(pausedAfter.remindedAt, null);
  assert.equal(pausedAfter.status, "pending");

  const cancelled = await liveCampaign();
  const creator = await harness.registerCreator();
  const cancelledApp = await apply(cancelled.id, creator, {});
  await Campaign.updateOne({ _id: cancelled.id }, { $set: { status: "cancelled" } });
  await processApplicationDeadlines({ now: new Date() });
  assert.equal((await CampaignApplication.findById(cancelledApp.body.id).lean()).status, "expired");
  assert.ok((await notificationsFor(creator.token)).some((n) => n.type === "application_expired"));
});

test("a brand-picked creator skips a place's rank requirement but not the campaign's rules or account limits", async () => {
  const Slot = require("../../src/models/Slot");

  const ranked = await liveCampaign();
  await Slot.updateMany({ campaignId: ranked.id }, { $set: { rankRequired: "rank3" } });
  const creator = await harness.registerCreator();
  const applied = await apply(ranked.id, creator, {});
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const approved = await harness.api("POST", approveUrl(ranked.id, applied.body.id), { token: ranked.brand.token });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));

  const minRank = await liveCampaign({ creatorEligibility: { minRank: "rank2" } });
  const refused = await apply(minRank.id, await harness.registerCreator(), {});
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.body.failures.map((f) => f.criterion), ["minRank"]);

  const busy = await liveCampaign();
  const busyCreator = await harness.registerCreator();
  const busyApp = await apply(busy.id, busyCreator, {});
  for (let i = 0; i < 3; i += 1) {
    const open = await liveCampaign({ creatorAccess: "open_call" });
    assert.equal((await harness.api("POST", `/api/campaigns/${open.id}/join`, { token: busyCreator.token })).status, 200);
  }
  const atLimit = await harness.api("POST", approveUrl(busy.id, busyApp.body.id), { token: busy.brand.token });
  assert.equal(atLimit.status, 409);
  assert.equal(atLimit.body.code, "CREATOR_CANNOT_JOIN");
  assert.deepEqual(atLimit.body.failures.map((f) => f.criterion), ["placementLimit"]);
});

test("brands only see their own campaigns' applications and creators only their own", async () => {
  const mine = await liveCampaign();
  const theirs = await liveCampaign();
  const creator = await harness.registerCreator();
  const other = await harness.registerCreator();
  const applied = await apply(mine.id, creator, {});

  const readOther = await harness.api("GET", `/api/campaigns/${mine.id}/applications/${applied.body.id}`, { token: theirs.brand.token });
  assert.equal(readOther.status, 403);
  const viaOwnCampaign = await harness.api("GET", `/api/campaigns/${theirs.id}/applications/${applied.body.id}`, { token: theirs.brand.token });
  assert.equal(viaOwnCampaign.status, 404);
  const listOther = await harness.api("GET", `/api/campaigns/${mine.id}/applications`, { token: theirs.brand.token });
  assert.equal(listOther.status, 403);
  const approveOther = await harness.api("POST", approveUrl(theirs.id, applied.body.id), { token: theirs.brand.token });
  assert.equal(approveOther.status, 404);

  const creatorRead = await harness.api("GET", `/api/campaigns/${mine.id}/applications/${applied.body.id}`, { token: other.token });
  assert.equal(creatorRead.status, 403);
  const otherWithdraw = await harness.api("POST", `/api/campaigns/${mine.id}/apply/withdraw`, { token: other.token });
  assert.equal(otherWithdraw.status, 404);
  const dashboard = await harness.api("GET", "/api/creators/dashboard", { token: other.token });
  assert.ok(!dashboard.body.applications.some((a) => String(a.campaignId) === mine.id));

  const stillPending = await harness.api("GET", `/api/campaigns/${mine.id}/applications/${applied.body.id}`, { token: mine.brand.token });
  assert.equal(stillPending.body.status, "pending");
});

test("approve and withdraw at the same moment: exactly one wins and no place is stranded", async () => {
  const CampaignApplication = require("../../src/models/CampaignApplication");
  for (let round = 0; round < 4; round += 1) {
    const { brand, id } = await liveCampaign();
    const creator = await harness.registerCreator();
    const applied = await apply(id, creator, {});

    const [approved, withdrawn] = await Promise.all([
      harness.api("POST", approveUrl(id, applied.body.id), { token: brand.token }),
      harness.api("POST", `/api/campaigns/${id}/apply/withdraw`, { token: creator.token }),
    ]);
    assert.equal([approved.status, withdrawn.status].filter((s) => s === 200).length, 1, JSON.stringify([approved.body, withdrawn.body]));

    const status = (await CampaignApplication.findById(applied.body.id).lean()).status;
    const held = await heldPlacements(id);
    if (approved.status === 200) {
      assert.equal(status, "approved");
      assert.equal(held.length, 1);
    } else {
      assert.equal(status, "withdrawn");
      assert.equal(held.length, 0);
    }
  }
});
