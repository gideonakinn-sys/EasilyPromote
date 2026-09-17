// Brand ratings and automated badges (M8, D24 and D25): who can rate whom and when, what creators,
// brands and admins see, hiding a rating, the badge job with its minimums and hysteresis, admin
// overrides, and keeping badges held before automatic badges.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  if (harness) await harness.stop();
});

const DAY = 24 * 60 * 60 * 1000;
const models = () => ({
  AdminActivity: require("../../src/models/AdminActivity"),
  CreatorProfile: require("../../src/models/CreatorProfile"),
  CreatorRating: require("../../src/models/CreatorRating"),
  Notification: require("../../src/models/Notification"),
  Submission: require("../../src/models/Submission"),
});
const brief = { summary: "Style three looks from the summer drop", hashtags: ["#SummerDrop"] };

async function liveContentCampaign({ brand, deliverables = 4, creatorAccess = "open_call", creatorEligibility } = {}) {
  brand = brand || (await harness.registerBrand());
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Summer lookbook",
      category: "Fashion",
      campaignObjective: "content",
      contentPay: { ratePerDeliverable: 15000, deliverables },
      contentDestination: "brand_page",
      creatorAccess,
      ...(creatorEligibility && { creatorEligibility }),
      brief,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.equal(payment.body.status, "live");
  return { brand, id };
}

async function joinAndSubmit(campaignId, creator) {
  creator = creator || (await harness.registerCreator());
  const joined = await harness.api("POST", `/api/campaigns/${campaignId}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const submitted = await harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId, videoUrl: "https://drive.example.com/cut-1.mp4", caption: "Summer looks #SummerDrop" },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { ...creator, submissionId: submitted.body.id };
}

// Brand page: approve → the creator shares the download link → the brand confirms → completed.
async function complete(brand, creator) {
  const patch = (path, token, body) => harness.api("PATCH", path, { token, body });
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/approve`, brand.token)).status, 200);
  const delivered = await patch(`/api/submissions/${creator.submissionId}/deliver`, creator.token, {
    url: "https://drive.example.com/final.mp4",
    acceptUsageRights: true,
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  const confirmed = await patch(`/api/submissions/${creator.submissionId}/confirm-receipt`, brand.token);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "completed");
}

const rate = (brand, campaignId, creatorId, body) => harness.api("PUT", `/api/campaigns/${campaignId}/ratings/${creatorId}`, { token: brand.token, body });
const listRatings = (brand, campaignId) => harness.api("GET", `/api/campaigns/${campaignId}/ratings`, { token: brand.token });
const profileOf = async (creator) => (await harness.api("GET", "/api/creators/profile/me", { token: creator.token })).body;
const recalculateAll = async (admin) => {
  const res = await harness.api("POST", "/api/admin/rank/recalculate", { token: admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.summary;
};
const oid = () => new mongoose.Types.ObjectId();

// Ratings from other brands on other campaigns, written directly.
async function seedRatings(creatorId, scores, extra = {}) {
  const { CreatorRating } = models();
  for (const score of scores) {
    await CreatorRating.create({ campaignId: oid(), creatorId, businessId: oid(), score, editableUntil: new Date(Date.now() + 7 * DAY), ...extra });
  }
}

// A creator's finished and abandoned content placements, written directly (one campaign each).
async function seedPlacements(creator, { finished = 0, notDelivered = 0 }) {
  const { Submission } = models();
  const make = (status) =>
    Submission.create({
      campaignId: oid(),
      creatorId: creator.id,
      creatorHandle: creator.username,
      slotId: oid(),
      status,
      ...(status === "completed" && { completedAt: new Date() }),
    });
  for (let i = 0; i < finished; i += 1) await make("completed");
  for (let i = 0; i < notDelivered; i += 1) await make("not_delivered");
}

test("a brand rates a creator once their content is complete: once per creator, editable for 7 days, never someone who didn't take part", async () => {
  const { CreatorRating } = models();
  const { brand, id } = await liveContentCampaign();
  const done = await joinAndSubmit(id);
  const racer = await joinAndSubmit(id);
  const unfinished = await joinAndSubmit(id);
  const stranger = await harness.registerCreator();
  await complete(brand, done);
  await complete(brand, racer);

  const before = await listRatings(brand, id);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.deepEqual(before.body.creators.map((c) => c.creatorId).sort(), [done.id, racer.id].sort());
  assert.equal(before.body.toRate, 2);
  assert.equal(before.body.editWindowDays, 7);
  assert.ok(before.body.tags.some((t) => t.value === "on_brief"));

  for (const creator of [unfinished, stranger]) {
    const refused = await rate(brand, id, creator.id, { score: 5 });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "NOT_RATEABLE");
  }
  assert.equal((await rate(brand, id, "not-an-id", { score: 5 })).body.code, "NOT_RATEABLE");

  for (const bad of [{}, { score: 0 }, { score: 6 }, { score: 4.5 }, { score: "5" }, { score: 4, tags: ["nope"] }, { score: 4, comment: "x".repeat(501) }]) {
    const res = await rate(brand, id, done.id, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }

  const otherBrand = await harness.registerBrand();
  assert.equal((await rate(otherBrand, id, done.id, { score: 1 })).status, 403);
  assert.equal((await listRatings(otherBrand, id)).status, 403);
  assert.equal((await harness.api("PUT", `/api/campaigns/${id}/ratings/${done.id}`, { token: done.token, body: { score: 5 } })).status, 403);

  const first = await rate(brand, id, done.id, { score: 4, comment: "  Lovely work, a day late  ", tags: ["on_time", "on_brief", "on_brief"] });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.rating.score, 4);
  assert.equal(first.body.rating.comment, "Lovely work, a day late");
  assert.deepEqual(first.body.rating.tags, ["on_brief", "on_time"]);
  assert.equal(first.body.rating.editable, true);
  const windowDays = (new Date(first.body.rating.editableUntil) - new Date(first.body.rating.createdAt)) / DAY;
  assert.ok(Math.abs(windowDays - 7) < 0.01);

  const edited = await rate(brand, id, done.id, { score: 5, tags: ["communication"] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.rating.score, 5);
  assert.equal(edited.body.rating.comment, "");
  assert.equal(await CreatorRating.countDocuments({ campaignId: id, creatorId: done.id }), 1);

  // Two saves at once for a creator not yet rated: one creates, the other edits.
  const raced = await Promise.all([rate(brand, id, racer.id, { score: 3 }), rate(brand, id, racer.id, { score: 2 })]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 201]);
  assert.equal(await CreatorRating.countDocuments({ campaignId: id, creatorId: racer.id }), 1);

  const after = await listRatings(brand, id);
  assert.equal(after.body.toRate, 0);
  assert.equal(after.body.creators.find((c) => c.creatorId === done.id).rating.score, 5);

  // After 7 days the rating is fixed.
  await CreatorRating.updateOne({ campaignId: id, creatorId: done.id }, { $set: { editableUntil: new Date(Date.now() - 1000) } });
  const late = await rate(brand, id, done.id, { score: 1 });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "EDIT_WINDOW_CLOSED");
  assert.equal((await listRatings(brand, id)).body.creators.find((c) => c.creatorId === done.id).rating.editable, false);

  // The creator sees a count, no average below 3 ratings, and never who rated or what they wrote.
  const profile = await profileOf(done);
  assert.deepEqual(profile.rating, { average: null, count: 1 });
  assert.ok(!JSON.stringify(profile).includes("Lovely work"));
});

test("a performance campaign's creators can be rated once the campaign is completed, only if they delivered verified results", async () => {
  const { Submission } = models();
  const admin = await harness.registerAdmin();
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Afrobeats launch", category: "Music", targetViews: 100000, platforms: ["tiktok"], niches: ["Music"] },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  assert.equal((await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token })).body.status, "live");

  const deliverer = await harness.registerCreator();
  const idle = await harness.registerCreator();
  for (const creator of [deliverer, idle]) {
    const claim = await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: id } });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
  }
  const submitted = await harness.api("POST", "/api/submissions", {
    token: deliverer.token,
    body: { campaignId: id, videoUrl: "https://www.tiktok.com/@creator/video/1", caption: "Out now" },
  });
  assert.equal(submitted.status, 201);
  // The views sync would do this: the post is live and has verified views.
  await Submission.updateOne({ _id: submitted.body.id }, { $set: { status: "posted", viewsDelivered: 12000 } });

  assert.equal((await listRatings(brand, id)).body.creators.length, 0, "not while the campaign is live");
  assert.equal((await rate(brand, id, deliverer.id, { score: 5 })).body.code, "NOT_RATEABLE");

  const completed = await harness.api("POST", `/api/admin/campaigns/${id}/complete`, { token: admin.token });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));

  assert.deepEqual((await listRatings(brand, id)).body.creators.map((c) => c.creatorId), [deliverer.id]);
  assert.equal((await rate(brand, id, idle.id, { score: 2 })).body.code, "NOT_RATEABLE");
  assert.equal((await rate(brand, id, deliverer.id, { score: 5 })).status, 201);
});

test("brands see the average from 3 ratings on applicants; admins see every rating and can hide and unhide one, logged", async () => {
  const { AdminActivity } = models();
  const creator = await harness.registerCreator();
  const { brand, id } = await liveContentCampaign({ deliverables: 1 });
  const joined = await joinAndSubmit(id, creator);
  await complete(brand, joined);
  assert.equal((await rate(brand, id, creator.id, { score: 2, comment: "Rude to our team", tags: ["on_time"] })).status, 201);
  await seedRatings(creator.id, [5, 4]);
  // Any change recalculates the summary from every visible rating.
  assert.equal((await rate(brand, id, creator.id, { score: 1, comment: "Rude to our team" })).status, 200);

  assert.deepEqual((await profileOf(creator)).rating, { average: 3.3, count: 3 });

  // An Application Required campaign: the brand reviewing applicants sees the current rating and badges.
  const review = await liveContentCampaign({ creatorAccess: "application_required", deliverables: 2 });
  const applied = await harness.api("POST", `/api/campaigns/${review.id}/apply`, { token: creator.token, body: { pitch: "Pick me" } });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const rows = await harness.api("GET", `/api/campaigns/${review.id}/applications`, { token: review.brand.token });
  assert.equal(rows.status, 200);
  assert.deepEqual(rows.body.applications[0].creator.rating, { average: 3.3, count: 3 });
  assert.deepEqual(rows.body.applications[0].creator.badges, []);
  const detail = await harness.api("GET", `/api/campaigns/${review.id}/applications/${rows.body.applications[0].id}`, { token: review.brand.token });
  const badgesSection = detail.body.sections.find((s) => s.key === "badges");
  assert.deepEqual(badgesSection.data.rating, { average: 3.3, count: 3 });
  assert.ok(!JSON.stringify(detail.body).includes("Rude to our team"), "brands never see comments");

  // Admin: everything, including the comment and the brand.
  const support = await harness.registerAdmin({ role: "support" });
  const list = await harness.api("GET", `/api/admin/ratings?creatorId=${creator.id}`, { token: support.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 3);
  assert.deepEqual(list.body.summary, { average: 3.33, count: 3 });
  const abusive = list.body.ratings.find((r) => r.comment === "Rude to our team");
  assert.equal(abusive.brand.name, "Test Brand");
  assert.equal(abusive.campaign.name, "Summer lookbook");

  assert.equal((await harness.api("GET", "/api/admin/ratings", { token: brand.token })).status, 403);
  assert.equal((await harness.api("PATCH", `/api/admin/ratings/${abusive.id}/visibility`, { token: creator.token, body: { hidden: true, reason: "x" } })).status, 403);

  const path = `/api/admin/ratings/${abusive.id}/visibility`;
  const noReason = await harness.api("PATCH", path, { token: support.token, body: { hidden: true } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, "REASON_REQUIRED");

  const hidden = await harness.api("PATCH", path, { token: support.token, body: { hidden: true, reason: "Personal attack, not about the work" } });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal(hidden.body.rating.hidden, true);
  assert.equal(hidden.body.rating.hiddenReason, "Personal attack, not about the work");
  assert.equal((await harness.api("PATCH", path, { token: support.token, body: { hidden: true, reason: "again" } })).body.code, "NO_CHANGE");

  assert.deepEqual((await profileOf(creator)).rating, { average: null, count: 2 }, "hidden ratings don't count");
  const brandList = await listRatings(brand, id);
  assert.equal(brandList.body.creators[0].rating.hidden, true);
  assert.equal(brandList.body.creators[0].rating.editable, false);
  const edit = await rate(brand, id, creator.id, { score: 3 });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, "RATING_HIDDEN");

  const onlyHidden = await harness.api("GET", "/api/admin/ratings?hidden=true", { token: support.token });
  assert.ok(onlyHidden.body.ratings.every((r) => r.hidden));
  assert.ok(onlyHidden.body.ratings.some((r) => r.id === abusive.id));

  const logged = await AdminActivity.findOne({ action: "rating.hidden", targetId: abusive.id }).lean();
  assert.ok(logged, "hiding is audit-logged");
  assert.equal(logged.targetType, "rating");
  assert.equal(logged.note, "Personal attack, not about the work");
  assert.equal(String(logged.businessId), brand.id);
  assert.equal(logged.metadata.score, 1);

  const shown = await harness.api("PATCH", path, { token: support.token, body: { hidden: false } });
  assert.equal(shown.status, 200);
  assert.deepEqual((await profileOf(creator)).rating, { average: 3.3, count: 3 });
  assert.ok(await AdminActivity.findOne({ action: "rating.unhidden", targetId: abusive.id }).lean());
});

test("the badge job: minimum samples, a notification once on gain, hysteresis, loss, and requiredBadges eligibility following it", async () => {
  const { CreatorProfile, Notification } = models();
  const admin = await harness.registerAdmin();
  const steady = await harness.registerCreator();
  const newcomer = await harness.registerCreator();
  const hopeful = await harness.registerCreator();

  // Two finished campaigns can't earn Reliable Creator (needs 3 finished and 5 counted).
  await seedPlacements(newcomer, { finished: 2 });
  await seedPlacements(steady, { finished: 5 });
  const summary = await recalculateAll(admin);
  assert.ok(summary.badgesGained >= 1);

  let profile = await CreatorProfile.findOne({ userId: steady.id }).lean();
  assert.deepEqual(profile.badges, ["reliable_creator"]);
  assert.equal(profile.completionRate, 100);
  assert.equal(profile.badgeEvaluation.metrics.finishedCampaigns, 5);
  assert.deepEqual((await CreatorProfile.findOne({ userId: newcomer.id }).lean()).badges, []);
  const earned = () => Notification.countDocuments({ creatorId: steady.id, type: "badge_earned" });
  assert.equal(await earned(), 1);
  assert.deepEqual((await profileOf(steady)).badges, ["reliable_creator"]);

  // Recalculating again changes nothing and doesn't notify again.
  await recalculateAll(admin);
  assert.equal(await earned(), 1);

  // requiredBadges eligibility reads the automatic badges.
  const exclusive = await liveContentCampaign({ creatorEligibility: { requiredBadges: ["reliable_creator"] }, deliverables: 2 });
  const refused = await harness.api("POST", `/api/campaigns/${exclusive.id}/join`, { token: newcomer.token });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "NOT_ELIGIBLE");
  assert.match(refused.body.error, /Reliable Creator/);
  assert.equal((await harness.api("POST", `/api/campaigns/${exclusive.id}/join`, { token: steady.token })).status, 200);

  // 5 finished, 1 never delivered: 83%. Keeps it (keep bar 80%); someone new with 83% doesn't gain it (gain bar 90%).
  await seedPlacements(steady, { notDelivered: 1 });
  await seedPlacements(hopeful, { finished: 5, notDelivered: 1 });
  await recalculateAll(admin);
  profile = await CreatorProfile.findOne({ userId: steady.id }).lean();
  assert.equal(profile.completionRate, 83);
  assert.deepEqual(profile.badges, ["reliable_creator"]);
  const hopefulProfile = await CreatorProfile.findOne({ userId: hopeful.id }).lean();
  assert.equal(hopefulProfile.completionRate, 83);
  assert.deepEqual(hopefulProfile.badges, []);
  const why = hopefulProfile.badgeEvaluation.results.reliable_creator;
  assert.equal(why.stage, "gain");
  assert.deepEqual(why.checks.filter((c) => !c.pass).map((c) => [c.metric, c.value, c.need]), [["completionRate", 83, 90]]);

  // One more never delivered: 71%, below the keep bar. Lost, without a notification.
  await seedPlacements(steady, { notDelivered: 1 });
  await recalculateAll(admin);
  assert.deepEqual((await CreatorProfile.findOne({ userId: steady.id }).lean()).badges, []);
  assert.equal(await earned(), 1);

  // Ratings count towards the score and Top Creator; 5 top ratings plus a strong record earn more badges.
  const star = await harness.registerCreator();
  await seedPlacements(star, { finished: 10 });
  await seedRatings(star.id, [5, 5, 5, 5, 4]);
  // Ratings written directly: summarise them as a rating change would, then run the job.
  await require("../../src/services/creatorRatings").refreshCreatorRating(star.id);
  await recalculateAll(admin);
  const starProfile = await CreatorProfile.findOne({ userId: star.id }).lean();
  assert.equal(starProfile.brandRating.count, 5);
  assert.equal(starProfile.scoreBreakdown.brandRatings.sample, 5);
  assert.ok(starProfile.scoreBreakdown.brandRatings.value > 0.9);
  assert.deepEqual(starProfile.badges, ["top_creator", "reliable_creator", "campaign_pro"]);
});

test("admin overrides: grant, revoke and back to automatic need a note, are logged and survive the job; badges held before automatic badges are kept for review", async () => {
  const { AdminActivity, CreatorProfile, Notification } = models();
  const admin = await harness.registerAdmin();
  const brand = await harness.registerBrand();

  // Held by hand before automatic badges (never evaluated), with no record that earns it.
  const veteran = await harness.registerCreator();
  await CreatorProfile.updateOne({ userId: veteran.id }, { $set: { badges: ["top_creator", "campaign_pro"] } });
  await recalculateAll(admin);
  let profile = await CreatorProfile.findOne({ userId: veteran.id }).lean();
  assert.deepEqual(profile.badges, ["top_creator", "campaign_pro"], "not wiped on the first run");
  assert.deepEqual(profile.badgeOverrides.map((o) => [o.badge, o.mode, o.source]), [
    ["top_creator", "grant", "migration"],
    ["campaign_pro", "grant", "migration"],
  ]);
  assert.equal(await Notification.countDocuments({ creatorId: veteran.id, type: "badge_earned" }), 0);
  await recalculateAll(admin);
  assert.equal((await CreatorProfile.findOne({ userId: veteran.id }).lean()).badgeOverrides.length, 2, "migrated once");

  const review = await harness.api("GET", "/api/admin/badges/review", { token: admin.token });
  assert.equal(review.status, 200);
  const entry = review.body.creators.find((c) => c.creatorId === veteran.id);
  assert.deepEqual(entry.keptBadges, ["top_creator", "campaign_pro"]);

  const report = await harness.api("GET", `/api/admin/creators/${veteran.id}/badges`, { token: admin.token });
  assert.equal(report.status, 200);
  assert.equal(report.body.needsReview, true);
  const top = report.body.items.find((i) => i.badge === "top_creator");
  assert.equal(top.held, true);
  assert.equal(top.earnedByRules, false);
  assert.equal(top.override.source, "migration");
  assert.equal(top.evaluation.minimumsMet, false);
  assert.ok(top.rule.gain.length > 0);

  const put = (creator, badge, body, token = admin.token) => harness.api("PUT", `/api/admin/creators/${creator.id}/badges/${badge}`, { token, body });

  assert.equal((await put(veteran, "top_creator", { mode: "auto" })).body.code, "NOTE_REQUIRED");
  assert.equal((await put(veteran, "shiny", { mode: "grant", note: "x" })).body.code, "UNKNOWN_BADGE");
  assert.equal((await put(veteran, "top_creator", { mode: "maybe", note: "x" })).body.code, "INVALID_MODE");
  assert.equal((await put(veteran, "top_creator", { mode: "auto", note: "x" }, brand.token)).status, 403);
  assert.equal((await put(veteran, "top_creator", { mode: "auto", note: "x" }, veteran.token)).status, 403);

  // Review: Top Creator goes back to the rules (and is lost); Campaign Pro is confirmed as an admin grant.
  const cleared = await put(veteran, "top_creator", { mode: "auto", note: "Reviewed: no longer meets the bar" });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.deepEqual(cleared.body.badges, ["campaign_pro"]);
  const kept = await put(veteran, "campaign_pro", { mode: "grant", note: "Reviewed: long-standing partner" });
  assert.equal(kept.status, 200);
  assert.equal(kept.body.items.find((i) => i.badge === "campaign_pro").override.source, "admin");
  assert.equal(kept.body.needsReview, false);
  assert.ok(!(await harness.api("GET", "/api/admin/badges/review", { token: admin.token })).body.creators.some((c) => c.creatorId === veteran.id));
  assert.equal((await put(veteran, "campaign_pro", { mode: "grant", note: "again" })).body.code, "NO_CHANGE");
  assert.equal(await Notification.countDocuments({ creatorId: veteran.id, type: "badge_earned" }), 0, "confirming a held badge isn't a gain");

  const clearedLog = await AdminActivity.findOne({ action: "creator.badge_override_cleared", targetId: veteran.id }).lean();
  assert.ok(clearedLog);
  assert.equal(clearedLog.note, "Reviewed: no longer meets the bar");
  assert.equal(clearedLog.metadata.badge, "top_creator");
  assert.deepEqual(clearedLog.metadata.badgesBefore, ["top_creator", "campaign_pro"]);
  assert.deepEqual(clearedLog.metadata.badgesAfter, ["campaign_pro"]);

  // Grant a badge the rules don't give: the creator is told, the job keeps it.
  const granted = await put(veteran, "high_performer", { mode: "grant", note: "Top results on off-platform campaign" });
  assert.equal(granted.status, 200);
  assert.deepEqual(granted.body.badges, ["high_performer", "campaign_pro"]);
  assert.equal(await Notification.countDocuments({ creatorId: veteran.id, type: "badge_earned" }), 1);
  assert.ok(await AdminActivity.findOne({ action: "creator.badge_granted", targetId: veteran.id }).lean());

  // Revoke a badge the rules give: gone, and stays gone after the job.
  const earner = await harness.registerCreator();
  await seedPlacements(earner, { finished: 5 });
  await recalculateAll(admin);
  assert.deepEqual((await CreatorProfile.findOne({ userId: earner.id }).lean()).badges, ["reliable_creator"]);
  const revoked = await put(earner, "reliable_creator", { mode: "revoke", note: "Fake deliveries under investigation" });
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.body.badges, []);
  const item = revoked.body.items.find((i) => i.badge === "reliable_creator");
  assert.equal(item.earnedByRules, true);
  assert.equal(item.override.mode, "revoke");
  assert.ok(await AdminActivity.findOne({ action: "creator.badge_revoked", targetId: earner.id }).lean());

  await recalculateAll(admin);
  assert.deepEqual((await CreatorProfile.findOne({ userId: earner.id }).lean()).badges, []);
  assert.deepEqual((await CreatorProfile.findOne({ userId: veteran.id }).lean()).badges, ["high_performer", "campaign_pro"]);

  // Back to automatic: the rules' badge returns.
  const restored = await put(earner, "reliable_creator", { mode: "auto", note: "Investigation closed" });
  assert.deepEqual(restored.body.badges, ["reliable_creator"]);

  // An override on a creator never evaluated evaluates them first, so their old badges are kept too.
  const untouched = await harness.registerCreator();
  await CreatorProfile.updateOne({ userId: untouched.id }, { $set: { badges: ["reliable_creator"] } });
  const first = await put(untouched, "top_creator", { mode: "grant", note: "Flagship creator" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.badges, ["top_creator", "reliable_creator"]);
  assert.equal(first.body.items.find((i) => i.badge === "reliable_creator").override.source, "migration");

  const recalculated = await harness.api("POST", `/api/admin/creators/${earner.id}/badges/recalculate`, { token: admin.token });
  assert.equal(recalculated.status, 200);
  assert.ok(recalculated.body.evaluatedAt);
  assert.equal((await harness.api("GET", `/api/admin/creators/${oid()}/badges`, { token: admin.token })).status, 404);
});
