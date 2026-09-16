// Content Approval and delivery (ticket 07): a creator in a content campaign submits content,
// the brand approves, requests changes (at most 2 rounds) or rejects, and approved content goes
// where the campaign says: the creator's page, the brand's page, or both.
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

const HOUR = 60 * 60 * 1000;

const brief = {
  summary: "Style three looks from the summer drop",
  dos: ["Show the fabric up close"],
  donts: ["No competitor brands in frame"],
  hashtags: ["#SummerDrop", "ad"],
};

// A paid, live content campaign with the brand's chosen destination.
async function liveContentCampaign({ destination = "creator_page", deliverables = 2 } = {}) {
  const brand = await harness.registerBrand();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: {
      name: "Summer lookbook",
      category: "Fashion",
      campaignObjective: "content",
      contentPay: { ratePerDeliverable: 15000, deliverables },
      contentDestination: destination,
      creatorAccess: "open_call",
      brief,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  harness.paystack.markPaid(checkout.body.reference);
  const payment = await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  assert.deepEqual(payment.body, { status: "live", isPaid: true });
  return { brand, id };
}

async function joinedCreator(campaignId) {
  const creator = await harness.registerCreator();
  const joined = await harness.api("POST", `/api/campaigns/${campaignId}/join`, { token: creator.token });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return { ...creator, slotId: joined.body.id };
}

async function submit(creator, campaignId, overrides = {}) {
  return harness.api("POST", "/api/submissions", {
    token: creator.token,
    body: { campaignId, videoUrl: "https://drive.example.com/cut-1.mp4", caption: "Summer looks #SummerDrop #ad", ...overrides },
  });
}

async function brandSubmission(brand, campaignId, submissionId) {
  const list = await harness.api("GET", `/api/submissions/campaign/${campaignId}`, { token: brand.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  return { list: list.body, submission: list.body.submissions.find((s) => String(s.id) === String(submissionId)) };
}

async function creatorCampaign(creator, campaignId) {
  const dashboard = await harness.api("GET", "/api/creators/dashboard", { token: creator.token });
  assert.equal(dashboard.status, 200);
  return dashboard.body.campaigns.campaigns.find((c) => String(c.id) === String(campaignId));
}

async function events(submissionId) {
  const SubmissionEvent = require("../../src/models/SubmissionEvent");
  return SubmissionEvent.find({ submissionId }).sort({ createdAt: 1, _id: 1 }).lean();
}

async function notificationsFor(user) {
  const res = await harness.api("GET", "/api/notifications", { token: user.token });
  return res.body;
}

async function approve(brand, submissionId) {
  const res = await harness.api("PATCH", `/api/submissions/${submissionId}/approve`, { token: brand.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

test("submitting to a content campaign needs a placement, and one placement carries one submission", async () => {
  const { id } = await liveContentCampaign();
  const outsider = await harness.registerCreator();

  const refused = await submit(outsider, id);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, "PLACEMENT_REQUIRED");

  const creator = await joinedCreator(id);
  const first = await submit(creator, id);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.status, "new");

  const second = await submit(creator, id);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "SUBMISSION_LIMIT");
});

test("change requests round trip: notes, resubmission, history, then at most 2 rounds", async () => {
  const { brand, id } = await liveContentCampaign();
  const creator = await joinedCreator(id);
  const submitted = await submit(creator, id);
  const submissionId = submitted.body.id;

  const noNotes = await harness.api("PATCH", `/api/submissions/${submissionId}/request-changes`, { token: brand.token, body: { notes: " " } });
  assert.equal(noNotes.status, 400);

  const notByCreator = await harness.api("PATCH", `/api/submissions/${submissionId}/request-changes`, { token: creator.token, body: { notes: "x" } });
  assert.equal(notByCreator.status, 403);

  const first = await harness.api("PATCH", `/api/submissions/${submissionId}/request-changes`, {
    token: brand.token,
    body: { notes: "Show the fabric closer" },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, "changes_requested");
  assert.equal(first.body.changeRequestsLeft, 1);

  // The creator is told, and sees the feedback on their campaign.
  const creatorNotes = await notificationsFor(creator);
  assert.ok(creatorNotes.some((n) => n.type === "content_changes_requested"));
  let mine = await creatorCampaign(creator, id);
  assert.equal(mine.contentApproval.status, "changes_requested");
  assert.equal(mine.contentApproval.changeRequests.length, 1);
  assert.equal(mine.contentApproval.changeRequests[0].notes, "Show the fabric closer");
  assert.equal(mine.contentApproval.changeRequestsLeft, 1);

  // Brand can't approve or ask again while the creator is making changes.
  const early = await harness.api("PATCH", `/api/submissions/${submissionId}/approve`, { token: brand.token });
  assert.equal(early.status, 400);

  const resubmitted = await harness.api("PUT", `/api/submissions/${submissionId}`, {
    token: creator.token,
    body: { videoUrl: "https://drive.example.com/cut-2.mp4", caption: "Closer look #SummerDrop #ad" },
  });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  assert.equal(resubmitted.body.status, "new");
  assert.ok((await notificationsFor(brand)).some((n) => n.type === "content_resubmitted"));

  const second = await harness.api("PATCH", `/api/submissions/${submissionId}/request-changes`, { token: brand.token, body: { notes: "Brighter light" } });
  assert.equal(second.status, 200);
  assert.equal(second.body.changeRequestsLeft, 0);
  await harness.api("PUT", `/api/submissions/${submissionId}`, { token: creator.token, body: { videoUrl: "https://drive.example.com/cut-3.mp4" } });

  const third = await harness.api("PATCH", `/api/submissions/${submissionId}/request-changes`, { token: brand.token, body: { notes: "One more" } });
  assert.equal(third.status, 409);
  assert.equal(third.body.code, "CHANGE_REQUESTS_USED");

  // History is kept: both rounds, what was reviewed each time, and when the creator resubmitted.
  const { submission } = await brandSubmission(brand, id, submissionId);
  assert.equal(submission.changeRequests.length, 2);
  assert.equal(submission.changeRequests[0].videoUrl, "https://drive.example.com/cut-1.mp4");
  assert.ok(submission.changeRequests[0].resubmittedAt);
  assert.equal(submission.changeRequests[1].notes, "Brighter light");
  assert.equal(submission.changeRequestsLeft, 0);
  assert.equal(submission.videoUrl, "https://drive.example.com/cut-3.mp4");

  const types = (await events(submissionId)).map((e) => e.type);
  assert.deepEqual(types, ["submitted", "changes_requested", "resubmitted", "changes_requested", "resubmitted"]);

  // After the rounds, reject is still open and the creator can appeal it.
  const rejected = await harness.api("PATCH", `/api/submissions/${submissionId}/reject`, { token: brand.token, body: { reason: "Off brief" } });
  assert.equal(rejected.status, 200);
  const edit = await harness.api("PUT", `/api/submissions/${submissionId}`, { token: creator.token, body: { caption: "again" } });
  assert.equal(edit.status, 400);
  const appealed = await harness.api("PATCH", `/api/submissions/${submissionId}/appeal`, { token: creator.token, body: { reason: "It matches the brief" } });
  assert.equal(appealed.status, 200, JSON.stringify(appealed.body));
  assert.equal(appealed.body.status, "appealed");
});

test("a change request keeps the placement; a rejection releases it; an upheld appeal takes it back only while it's free", async () => {
  const Slot = require("../../src/models/Slot");
  const Submission = require("../../src/models/Submission");
  const admin = await harness.registerAdmin();
  const { brand, id } = await liveContentCampaign({ deliverables: 3 });

  const creator = await joinedCreator(id);
  const submitted = await submit(creator, id);
  await harness.api("PATCH", `/api/submissions/${submitted.body.id}/request-changes`, { token: brand.token, body: { notes: "Closer" } });
  assert.equal(String((await Slot.findById(creator.slotId).lean()).creatorId), creator.id);
  await harness.api("PUT", `/api/submissions/${submitted.body.id}`, { token: creator.token, body: { caption: "#SummerDrop #ad" } });

  const rejected = await harness.api("PATCH", `/api/submissions/${submitted.body.id}/reject`, { token: brand.token, body: { reason: "No" } });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  let slot = await Slot.findById(creator.slotId).lean();
  assert.equal(slot.creatorId, null);
  assert.equal(slot.status, "available");

  // The rejected creator still sees the campaign, can appeal, and can't resubmit by joining again.
  const mine = await creatorCampaign(creator, id);
  assert.equal(mine.status, "rejected");
  assert.equal(mine.contentApproval.status, "rejected");
  const rejoined = await harness.api("POST", `/api/campaigns/${id}/join`, { token: creator.token });
  assert.equal(rejoined.status, 409, JSON.stringify(rejoined.body));
  assert.equal(rejoined.body.code, "CONTENT_REJECTED");
  assert.equal(await Slot.countDocuments({ campaignId: id, creatorId: creator.id }), 0, "no place wasted on a creator who can't submit");

  // Appeal while the place is still free: upheld, and the place is the creator's again.
  await Slot.updateMany({ campaignId: id, creatorId: creator.id }, { $set: { creatorId: null, status: "available" } });
  const appealed = await harness.api("PATCH", `/api/submissions/${submitted.body.id}/appeal`, { token: creator.token, body: { reason: "On brief" } });
  assert.equal(appealed.status, 200, JSON.stringify(appealed.body));
  const upheld = await harness.api("PATCH", `/api/admin/submissions/${submitted.body.id}/appeal`, { token: admin.token, body: { decision: "approve" } });
  assert.equal(upheld.status, 200, JSON.stringify(upheld.body));
  assert.equal((await Submission.findById(submitted.body.id).lean()).status, "awaiting_post");
  slot = await Slot.findById(creator.slotId).lean();
  assert.equal(String(slot.creatorId), creator.id);

  // A second creator's rejected place is taken by someone else before the appeal: it can't be upheld.
  const other = await joinedCreator(id);
  const otherSub = (await submit(other, id)).body.id;
  await harness.api("PATCH", `/api/submissions/${otherSub}/reject`, { token: brand.token, body: { reason: "No" } });
  await harness.api("PATCH", `/api/submissions/${otherSub}/appeal`, { token: other.token, body: { reason: "On brief" } });
  const taker = await harness.registerCreator();
  await Slot.updateOne({ _id: other.slotId }, { $set: { creatorId: taker.id, status: "claimed" } });
  const blocked = await harness.api("PATCH", `/api/admin/submissions/${otherSub}/appeal`, { token: admin.token, body: { decision: "approve" } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /place/i);
  assert.equal((await Submission.findById(otherSub).lean()).status, "appealed");
});

test("two submits at once for one placement: one is accepted", async () => {
  const { id } = await liveContentCampaign();
  const creator = await joinedCreator(id);
  const results = await Promise.all([submit(creator, id), submit(creator, id), submit(creator, id)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
});

test("confirming a live post or a receipt twice at once completes once", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "creator_page" });
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  await approve(brand, submissionId);
  await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }], caption: "#SummerDrop #ad" },
  });
  const confirms = await Promise.all([1, 2, 3].map(() => harness.api("PATCH", `/api/submissions/${submissionId}/confirm-post`, { token: brand.token })));
  assert.equal(confirms.filter((r) => r.status === 200).length, 1);
  assert.ok(confirms.every((r) => [200, 400, 409].includes(r.status)));
  const types = (await events(submissionId)).map((e) => e.type);
  for (const type of ["post_verified", "fixed_pay_due", "completed"]) assert.equal(types.filter((t) => t === type).length, 1, type);
  assert.equal((await notificationsFor(creator)).filter((n) => n.type === "content_completed").length, 1);

  const brandPage = await liveContentCampaign({ destination: "brand_page" });
  const deliverer = await joinedCreator(brandPage.id);
  const deliveredId = (await submit(deliverer, brandPage.id)).body.id;
  await approve(brandPage.brand, deliveredId);
  await harness.api("PATCH", `/api/submissions/${deliveredId}/deliver`, {
    token: deliverer.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  const receipts = await Promise.all([1, 2, 3].map(() => harness.api("PATCH", `/api/submissions/${deliveredId}/confirm-receipt`, { token: brandPage.brand.token })));
  assert.equal(receipts.filter((r) => r.status === 200).length, 1);
  assert.ok(receipts.every((r) => [200, 400, 409].includes(r.status)));
  const deliveredTypes = (await events(deliveredId)).map((e) => e.type);
  for (const type of ["receipt_confirmed", "fixed_pay_due", "completed"]) assert.equal(deliveredTypes.filter((t) => t === type).length, 1, type);
});

test("a brand rejection racing the auto-approve: exactly one decision wins", async () => {
  const Submission = require("../../src/models/Submission");
  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
  const { brand, id } = await liveContentCampaign();
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  const now = new Date(Date.now() + 73 * HOUR);

  const [rejected] = await Promise.all([
    harness.api("PATCH", `/api/submissions/${submissionId}/reject`, { token: brand.token, body: { reason: "Off brief" } }),
    autoApproveStaleSubmissions(now),
  ]);
  const final = await Submission.findById(submissionId).lean();
  const types = (await events(submissionId)).map((e) => e.type);
  const decisions = types.filter((t) => t === "approved" || t === "rejected");
  assert.equal(decisions.length, 1, JSON.stringify(types));
  if (rejected.status === 200) {
    assert.equal(final.status, "rejected");
    assert.deepEqual(decisions, ["rejected"]);
  } else {
    assert.ok([400, 409].includes(rejected.status));
    assert.equal(final.status, "awaiting_post");
    assert.deepEqual(decisions, ["approved"]);
  }
});

test("admin review and appeal decisions only apply from the statuses they belong to", async () => {
  const Submission = require("../../src/models/Submission");
  const admin = await harness.registerAdmin();
  const { brand, id } = await liveContentCampaign({ destination: "brand_page" });
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  await approve(brand, submissionId);
  await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-receipt`, { token: brand.token });

  for (const body of [{ status: "approved" }, { status: "rejected", rejectionReason: "late" }]) {
    const res = await harness.api("PATCH", `/api/admin/submissions/${submissionId}/review`, { token: admin.token, body });
    assert.equal(res.status, 409, JSON.stringify(res.body));
  }
  const appeal = await harness.api("PATCH", `/api/admin/submissions/${submissionId}/appeal`, { token: admin.token, body: { decision: "approve" } });
  assert.equal(appeal.status, 409);
  assert.equal((await Submission.findById(submissionId).lean()).status, "completed");
  assert.equal((await events(submissionId)).filter((e) => e.type === "fixed_pay_due").length, 1);

  // From awaiting review, admin approval sends it where the campaign says, and pay is due once.
  const second = await joinedCreator(id);
  const secondId = (await submit(second, id)).body.id;
  const reviewed = await harness.api("PATCH", `/api/admin/submissions/${secondId}/review`, { token: admin.token, body: { status: "approved" } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal((await Submission.findById(secondId).lean()).status, "awaiting_delivery");
  const again = await harness.api("PATCH", `/api/admin/submissions/${secondId}/review`, { token: admin.token, body: { status: "approved" } });
  assert.equal(again.status, 409);
  assert.equal((await events(secondId)).filter((e) => e.type === "fixed_pay_due").length, 1);
});

test("brief hashtags can't contain spaces; referral content needs the creator's code as a whole word", async () => {
  const Campaign = require("../../src/models/Campaign");
  const ReferralCode = require("../../src/models/ReferralCode");
  const brandForSpaces = await harness.registerBrand();
  const spaced = await harness.api("POST", "/api/campaigns", {
    token: brandForSpaces.token,
    body: { name: "Spaces", category: "Fashion", campaignObjective: "content", contentPay: { ratePerDeliverable: 15000, deliverables: 1 }, brief: { hashtags: ["#summer drop"] } },
  });
  assert.equal(spaced.status, 400);
  assert.match(JSON.stringify(spaced.body), /space/i);

  const { brand, id } = await liveContentCampaign();
  await Campaign.updateOne({ _id: id }, { $set: { "referral.enabled": true, "referral.codeSource": "business" } });
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  await approve(brand, submissionId);
  const posts = [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }];

  const noCode = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, { token: creator.token, body: { posts, caption: "#SummerDrop #ad" } });
  assert.equal(noCode.status, 409);
  assert.equal(noCode.body.code, "REFERRAL_CODE_PENDING");

  await ReferralCode.create({ businessId: brand.id, campaignId: id, slotId: creator.slotId, creatorId: creator.id, code: "ADA-25", source: "business", status: "active" });
  const glued = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, { token: creator.token, body: { posts, caption: "#SummerDrop #ad ADA-250" } });
  assert.equal(glued.status, 400);
  assert.equal(glued.body.code, "MISSING_REFERRAL_CODE");
  const ok = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, { token: creator.token, body: { posts, caption: "#SummerDrop #ad code ada-25" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  const mine = await creatorCampaign(creator, id);
  assert.deepEqual(mine.contentApproval.requiredHashtags, ["#SummerDrop", "ad"]);
});

test("deleting a creator account keeps placements whose content is owed pay", async () => {
  const Slot = require("../../src/models/Slot");
  const { brand, id } = await liveContentCampaign({ destination: "brand_page" });
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  await approve(brand, submissionId);

  const deleted = await harness.api("DELETE", "/api/auth/account", { token: creator.token, body: { password: "password123" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const slot = await Slot.findById(creator.slotId).lean();
  assert.equal(String(slot.creatorId), creator.id);
});

test("approved-ish counts include completed and delivery statuses", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "brand_page" });
  const creator = await joinedCreator(id);
  const submissionId = (await submit(creator, id)).body.id;
  await approve(brand, submissionId);
  let stats = await harness.api("GET", `/api/campaigns/${id}`, { token: brand.token });
  assert.equal(stats.body.submissionsApproved, 1);
  await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-receipt`, { token: brand.token });
  stats = await harness.api("GET", `/api/campaigns/${id}`, { token: brand.token });
  assert.equal(stats.body.submissionsApproved, 1);
});

test("with no brand response for 72 hours, a delivery's receipt and a live post are confirmed automatically", async () => {
  const Submission = require("../../src/models/Submission");
  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");

  const brandPage = await liveContentCampaign({ destination: "brand_page" });
  const deliverer = await joinedCreator(brandPage.id);
  const deliveredId = (await submit(deliverer, brandPage.id)).body.id;
  await approve(brandPage.brand, deliveredId);
  await harness.api("PATCH", `/api/submissions/${deliveredId}/deliver`, {
    token: deliverer.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });

  const creatorPage = await liveContentCampaign({ destination: "creator_page" });
  const poster = await joinedCreator(creatorPage.id);
  const postedId = (await submit(poster, creatorPage.id)).body.id;
  await approve(creatorPage.brand, postedId);
  await harness.api("PATCH", `/api/submissions/${postedId}/mark-posted`, {
    token: poster.token,
    body: { posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }], caption: "#SummerDrop #ad" },
  });

  await autoApproveStaleSubmissions(new Date(Date.now() + 71 * HOUR));
  assert.equal((await Submission.findById(deliveredId).lean()).status, "awaiting_receipt");
  assert.equal((await Submission.findById(postedId).lean()).status, "verifying");

  await autoApproveStaleSubmissions(new Date(Date.now() + 73 * HOUR));
  for (const [submissionId, creator, brand, confirmType] of [
    [deliveredId, deliverer, brandPage.brand, "receipt_confirmed"],
    [postedId, poster, creatorPage.brand, "post_verified"],
  ]) {
    assert.equal((await Submission.findById(submissionId).lean()).status, "completed");
    const confirmEvent = (await events(submissionId)).find((e) => e.type === confirmType);
    assert.equal(confirmEvent.actor, "system");
    assert.ok((await notificationsFor(creator)).some((n) => n.type === "content_completed"));
    assert.ok((await notificationsFor(brand)).some((n) => n.type === "content_auto_confirmed"));
  }
});

test("creator page: approved → live post link with the brief's hashtags → verifying → brand confirms → completed", async () => {
  const Slot = require("../../src/models/Slot");
  const { brand, id } = await liveContentCampaign({ destination: "creator_page" });
  const creator = await joinedCreator(id);
  const { body: { id: submissionId } } = await submit(creator, id);

  const approved = await approve(brand, submissionId);
  assert.equal(approved.body.status, "awaiting_post");
  assert.ok((await notificationsFor(creator)).some((n) => n.type === "content_approved"));

  // Delivery links are for the brand page only.
  const wrongPath = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  assert.equal(wrongPath.status, 400);

  const posts = [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/123" }];
  const missing = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts, caption: "Summer looks #summerdrop" },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "MISSING_HASHTAGS");
  assert.deepEqual(missing.body.missing, ["#ad"]);

  const noLink = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts: [{ platform: "tiktok", postUrl: "" }], caption: "#SummerDrop #ad" },
  });
  assert.equal(noLink.status, 400);

  const posted = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts, caption: "Summer looks #summerdrop #AD" },
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.status, "verifying");
  assert.ok((await notificationsFor(brand)).some((n) => n.type === "content_posted"));

  const confirmed = await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-post`, { token: brand.token });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "completed");
  assert.ok((await notificationsFor(creator)).some((n) => n.type === "content_completed"));

  const types = (await events(submissionId)).map((e) => e.type);
  assert.deepEqual(types, ["submitted", "approved", "posted", "post_verified", "fixed_pay_due", "completed"]);

  const slot = await Slot.findById(creator.slotId).lean();
  assert.equal(String(slot.creatorId), creator.id);
  assert.equal(slot.status, "approved");

  const mine = await creatorCampaign(creator, id);
  assert.equal(mine.contentApproval.status, "completed");
  assert.equal(mine.contentApproval.destination, "creator_page");
});

test("brand page: approved → creator shares a download link and accepts usage rights → delivered → brand confirms → completed", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "brand_page" });
  const creator = await joinedCreator(id);
  const { body: { id: submissionId } } = await submit(creator, id);

  const approved = await approve(brand, submissionId);
  assert.equal(approved.body.status, "awaiting_delivery");

  const posting = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/1" }], caption: "#SummerDrop #ad" },
  });
  assert.equal(posting.status, 400);

  const noRights = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4" },
  });
  assert.equal(noRights.status, 400);
  assert.equal(noRights.body.code, "USAGE_RIGHTS_REQUIRED");

  const badLink = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "not a link", acceptUsageRights: true },
  });
  assert.equal(badLink.status, 400);

  const delivered = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  assert.equal(delivered.body.status, "awaiting_receipt");
  assert.ok((await notificationsFor(brand)).some((n) => n.type === "content_delivered"));

  const byCreator = await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-receipt`, { token: creator.token });
  assert.equal(byCreator.status, 403);

  const { submission } = await brandSubmission(brand, id, submissionId);
  assert.equal(submission.delivery.url, "https://drive.example.com/final.mp4");
  assert.equal(submission.usageRights.acceptedBy, creator.id);
  assert.ok(submission.usageRights.acceptedAt);
  assert.match(submission.usageRights.licence, /perpetual, non-exclusive/);

  const confirmed = await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-receipt`, { token: brand.token });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "completed");
  assert.ok((await notificationsFor(creator)).some((n) => n.type === "content_completed"));

  // D1: brand-page fixed pay is due on approval.
  const types = (await events(submissionId)).map((e) => e.type);
  assert.deepEqual(types, ["submitted", "approved", "fixed_pay_due", "delivery_shared", "receipt_confirmed", "completed"]);
});

test("both: delivery with usage rights, then the live post, then completed", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "both" });
  const creator = await joinedCreator(id);
  const { body: { id: submissionId } } = await submit(creator, id);

  assert.equal((await approve(brand, submissionId)).body.status, "awaiting_delivery");

  const noRights = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: false },
  });
  assert.equal(noRights.status, 400);

  const delivered = await harness.api("PATCH", `/api/submissions/${submissionId}/deliver`, {
    token: creator.token,
    body: { url: "https://drive.example.com/final.mp4", acceptUsageRights: true },
  });
  assert.equal(delivered.body.status, "awaiting_receipt");

  const received = await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-receipt`, { token: brand.token });
  assert.equal(received.status, 200);
  assert.equal(received.body.status, "awaiting_post");
  assert.ok((await notificationsFor(creator)).some((n) => n.type === "content_receipt_confirmed"));

  const posted = await harness.api("PATCH", `/api/submissions/${submissionId}/mark-posted`, {
    token: creator.token,
    body: { posts: [{ platform: "instagram", postUrl: "https://www.instagram.com/p/abc" }], caption: "#SummerDrop #ad" },
  });
  assert.equal(posted.body.status, "verifying");

  const confirmed = await harness.api("PATCH", `/api/submissions/${submissionId}/confirm-post`, { token: brand.token });
  assert.equal(confirmed.body.status, "completed");

  const { submission } = await brandSubmission(brand, id, submissionId);
  assert.equal(submission.usageRights.acceptedBy, creator.id);

  const types = (await events(submissionId)).map((e) => e.type);
  assert.deepEqual(types, ["submitted", "approved", "delivery_shared", "receipt_confirmed", "posted", "post_verified", "fixed_pay_due", "completed"]);
});

test("content with no brand response for 72 hours is approved automatically", async () => {
  const Submission = require("../../src/models/Submission");
  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 3 });
  const stale = await joinedCreator(id);
  const fresh = await joinedCreator(id);
  const staleSub = (await submit(stale, id)).body.id;
  const freshSub = (await submit(fresh, id)).body.id;

  const now = new Date(Date.now() + 71 * HOUR);
  await Submission.updateOne({ _id: staleSub }, { $set: { awaitingBrandSince: new Date(now.getTime() - 73 * HOUR) } });

  const result = await autoApproveStaleSubmissions(now);
  assert.ok(result.approved >= 1);

  const { submission: autoApproved } = await brandSubmission(brand, id, staleSub);
  assert.equal(autoApproved.status, "awaiting_delivery");
  assert.equal(autoApproved.autoApproved, true);
  const { submission: untouched } = await brandSubmission(brand, id, freshSub);
  assert.equal(untouched.status, "new");

  const approvedEvent = (await events(staleSub)).find((e) => e.type === "approved");
  assert.equal(approvedEvent.actor, "system");

  assert.ok((await notificationsFor(stale)).some((n) => n.type === "content_auto_approved"));
  assert.ok((await notificationsFor(brand)).some((n) => n.type === "content_auto_approved"));

  const mine = await creatorCampaign(stale, id);
  assert.equal(mine.contentApproval.autoApproved, true);

  // Running again does nothing more.
  const again = await autoApproveStaleSubmissions(now);
  assert.equal((await events(staleSub)).filter((e) => e.type === "approved").length, 1);
  assert.ok(again.approved >= 0);
});

test("views campaigns keep their submission path: no change requests, no auto-approve", async () => {
  const Submission = require("../../src/models/Submission");
  const { autoApproveStaleSubmissions } = require("../../src/services/contentApproval");
  const brand = await harness.registerBrand();
  const creator = await harness.registerCreator();
  const created = await harness.api("POST", "/api/campaigns", {
    token: brand.token,
    body: { name: "Afrobeats launch", category: "Music", targetViews: 100000, platforms: ["tiktok"], niches: ["Music"] },
  });
  const checkout = await harness.api("POST", `/api/campaigns/${created.body.id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${created.body.id}/payment-status`, { token: brand.token });
  await harness.api("POST", "/api/slots/claim", { token: creator.token, body: { campaignId: created.body.id } });
  const submitted = await submit(creator, created.body.id, { caption: "no hashtags needed" });
  assert.equal(submitted.status, 201);

  const changes = await harness.api("PATCH", `/api/submissions/${submitted.body.id}/request-changes`, { token: brand.token, body: { notes: "x" } });
  assert.equal(changes.status, 400);
  assert.equal(changes.body.code, "NOT_CONTENT_CAMPAIGN");

  await Submission.updateOne({ _id: submitted.body.id }, { $set: { awaitingBrandSince: new Date(Date.now() - 100 * HOUR), submittedAt: new Date(Date.now() - 100 * HOUR) } });
  await autoApproveStaleSubmissions(new Date());
  assert.equal((await Submission.findById(submitted.body.id).lean()).status, "new");

  // Rejected views content can still be fixed and resubmitted, as today.
  await harness.api("PATCH", `/api/submissions/${submitted.body.id}/reject`, { token: brand.token, body: { reason: "Too dark" } });
  const resubmitted = await harness.api("PUT", `/api/submissions/${submitted.body.id}`, { token: creator.token, body: { caption: "brighter" } });
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.body.status, "new");

  await approve(brand, submitted.body.id);
  const posted = await harness.api("PATCH", `/api/submissions/${submitted.body.id}/mark-posted`, {
    token: creator.token,
    body: { posts: [{ platform: "tiktok", postUrl: "https://www.tiktok.com/@c/video/9" }] },
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.status, "posted");
});
