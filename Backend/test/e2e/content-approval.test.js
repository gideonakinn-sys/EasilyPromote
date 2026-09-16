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

test("rejecting or requesting changes never touches the creator's placement", async () => {
  const Slot = require("../../src/models/Slot");
  const { brand, id } = await liveContentCampaign();
  const creator = await joinedCreator(id);
  const submitted = await submit(creator, id);
  await harness.api("PATCH", `/api/submissions/${submitted.body.id}/request-changes`, { token: brand.token, body: { notes: "Closer" } });
  await harness.api("PUT", `/api/submissions/${submitted.body.id}`, { token: creator.token, body: { caption: "#SummerDrop #ad" } });
  await harness.api("PATCH", `/api/submissions/${submitted.body.id}/reject`, { token: brand.token, body: { reason: "No" } });

  const slot = await Slot.findById(creator.slotId).lean();
  assert.equal(String(slot.creatorId), creator.id);
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
  assert.equal(delivered.body.status, "delivered");
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
  assert.equal(delivered.body.status, "delivered");

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
  await Submission.updateOne({ _id: staleSub }, { $set: { awaitingReviewSince: new Date(now.getTime() - 73 * HOUR) } });

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

  await Submission.updateOne({ _id: submitted.body.id }, { $set: { awaitingReviewSince: new Date(Date.now() - 100 * HOUR), submittedAt: new Date(Date.now() - 100 * HOUR) } });
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
