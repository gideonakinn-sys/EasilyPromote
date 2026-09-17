// Payout appeals and the admin appeals inbox (D23): a creator appeals a rejected withdrawal or voided pay
// within 7 days; admins see those beside content appeals in one inbox; anyone on the team can deny with a
// note, but only finance and super admins can grant, because granting moves money. Grants never pay
// twice, voided pay under appeal is never refunded, and every decision is logged and told to the creator.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startHarness } = require("./harness");

let harness;

before(async () => {
  harness = await startHarness();
  // These tests run the automatic refund job, which is off unless switched on.
  process.env.AUTO_REFUNDS_ENABLED = "true";
});

after(async () => {
  if (harness) await harness.stop();
});

const DAY = 24 * 60 * 60 * 1000;
const RATE = 15000;
const model = (name) => require(`../../src/models/${name}`);
const patch = (path, token, body) => harness.api("PATCH", path, { token, body });
const post = (path, token, body) => harness.api("POST", path, { token, body });

async function assertBalanced(campaignId) {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const result = await reconcileCampaignById(campaignId);
  assert.ok(result.ok, JSON.stringify(result.problems));
  return result;
}

async function liveContentCampaign({ destination = "creator_page", deliverables = 2 } = {}) {
  const brand = await harness.registerBrand();
  const created = await post("/api/campaigns", brand.token, {
    name: `Appeals ${destination}`,
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: RATE, deliverables },
    contentDestination: destination,
    creatorAccess: "open_call",
    brief: { summary: "Style it", hashtags: ["#Appeal"] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await post(`/api/campaigns/${id}/pay`, brand.token);
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  return { brand, id };
}

async function joinAndSubmit(campaignId) {
  const creator = await harness.registerCreator();
  const joined = await post(`/api/campaigns/${campaignId}/join`, creator.token);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  await post("/api/creators/bank-account", creator.token, { accountNumber: "0123456789", bankCode: "058", bankName: "Test Bank" });
  const submitted = await post("/api/submissions", creator.token, { campaignId, videoUrl: "https://drive.example.com/cut.mp4", caption: "Looks #Appeal" });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  return { ...creator, slotId: joined.body.id, submissionId: submitted.body.id };
}

// Creator page: approved, posted, post confirmed, 8 days ago, so the fixed pay can be withdrawn.
async function withdrawableFixedPay(brand, campaignId) {
  const creator = await joinAndSubmit(campaignId);
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/approve`, brand.token)).status, 200);
  const posted = await patch(`/api/submissions/${creator.submissionId}/mark-posted`, creator.token, {
    posts: [{ platform: "tiktok", postUrl: `https://www.tiktok.com/@c/video/${Date.now()}${Math.floor(Math.random() * 1e6)}` }],
    caption: "#Appeal",
  });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/confirm-post`, brand.token)).status, 200);
  await model("Submission").updateOne({ _id: creator.submissionId }, { $set: { completedAt: new Date(Date.now() - 8 * DAY) } });
  return creator;
}

const appealsOf = async (creator) => {
  const res = await harness.api("GET", "/api/creators/payout-appeals", { token: creator.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const inbox = async (admin, query = "") => {
  const res = await harness.api("GET", `/api/admin/appeals${query}`, { token: admin.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const resolve = (admin, appealId, body) => post(`/api/admin/payout-appeals/${appealId}/resolve`, admin.token, body);

test("a rejected withdrawal: appealed once within 7 days, only finance can grant it, and it goes back in the payout queue and is paid once", async () => {
  const { payoutWeekStart } = require("../../src/utils/payoutSchedule");
  const { brand, id } = await liveContentCampaign();
  const creator = await withdrawableFixedPay(brand, id);
  const requested = await post("/api/creators/withdrawals", creator.token, { campaignId: id });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const rejected = await post(`/api/admin/withdrawals/${requested.body.id}/review`, finance.token, { approve: false, note: "Bank details look wrong" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));

  // The creator sees it as appealable, with the reason.
  let mine = await appealsOf(creator);
  assert.equal(mine.appealable.length, 1);
  assert.deepEqual([mine.appealable[0].subjectType, mine.appealable[0].amount, mine.appealable[0].decisionReason], ["withdrawal", RATE, "Bank details look wrong"]);

  const short = await post("/api/creators/payout-appeals", creator.token, { subjectType: "withdrawal", subjectId: requested.body.id, reason: "wrong" });
  assert.equal(short.status, 400);
  const other = await harness.registerCreator();
  assert.equal((await post("/api/creators/payout-appeals", other.token, { subjectType: "withdrawal", subjectId: requested.body.id, reason: "Not mine but trying" })).status, 404);
  const filed = await post("/api/creators/payout-appeals", creator.token, { subjectType: "withdrawal", subjectId: requested.body.id, reason: "My bank details are correct, please pay" });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  const again = await post("/api/creators/payout-appeals", creator.token, { subjectType: "withdrawal", subjectId: requested.body.id, reason: "My bank details are correct, please pay" });
  assert.equal(again.body.code, "ALREADY_APPEALED");
  mine = await appealsOf(creator);
  assert.equal(mine.appealable.length, 0);
  assert.equal(mine.appeals[0].status, "open");

  // The inbox lists it with the payout filter, and not with the content filter.
  const support = await harness.registerAdmin({ role: "support" });
  const listed = await inbox(support, "?kind=payout&status=open");
  const row = listed.appeals.find((a) => String(a.id) === String(filed.body.appeal.id));
  assert.ok(row, "listed");
  assert.equal(row.moneyMoving, true);
  assert.equal(row.campaignName, "Appeals creator_page");
  assert.ok(listed.counts.payout >= 1);
  assert.ok(!(await inbox(support, "?kind=content&status=open")).appeals.some((a) => String(a.id) === String(filed.body.appeal.id)));
  assert.ok((await inbox(support, `?q=${encodeURIComponent("bank details are correct")}`)).appeals.some((a) => String(a.id) === String(filed.body.appeal.id)));

  // Granting moves money: support and admin can't.
  for (const who of [support, await harness.registerAdmin({ role: "admin" })]) {
    const refused = await resolve(who, filed.body.appeal.id, { decision: "grant", note: "Details check out" });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, "MONEY_ROLE_REQUIRED");
  }

  // Two finance admins granting at once reinstate it once.
  const second = await harness.registerAdmin({ role: "super_admin" });
  const grants = await Promise.all([resolve(finance, filed.body.appeal.id, { decision: "grant", note: "Details check out" }), resolve(second, filed.body.appeal.id, { decision: "grant", note: "Details check out" })]);
  assert.equal(grants.filter((g) => g.status === 200).length, 1, JSON.stringify(grants.map((g) => g.body)));
  const withdrawal = await model("Withdrawal").findById(requested.body.id).lean();
  assert.equal(withdrawal.status, "pending");
  assert.ok(withdrawal.appealReinstatedAt);
  assert.equal((await resolve(finance, filed.body.appeal.id, { decision: "deny", note: "Too late" })).body.code, "ALREADY_RESOLVED");
  assert.ok(await model("Notification").exists({ creatorId: creator.id, type: "payout_appeal_granted" }));
  assert.ok(await model("AdminActivity").exists({ action: "payout_appeal.granted", targetId: requested.body.id }));
  const resolved = await inbox(support, "?kind=payout&status=resolved");
  assert.equal(resolved.appeals.find((a) => String(a.id) === String(filed.body.appeal.id)).status, "granted");

  // Due in the payout run, paid once, and the books balance.
  await model("Withdrawal").updateOne({ _id: requested.body.id }, { $set: { requestedAt: new Date(payoutWeekStart(new Date()).getTime() - DAY) } });
  const paid = await post("/api/admin/payout-run/approve", finance.token, { withdrawalIds: [requested.body.id] });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.paid, 1);
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, type: "release", status: "released" }), 1);
  await assertBalanced(id);
});

test("a withdrawal appeal can't be granted when the money is already requested again; denying needs a note and is final", async () => {
  const { brand, id } = await liveContentCampaign();
  const creator = await withdrawableFixedPay(brand, id);
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const first = await post("/api/creators/withdrawals", creator.token, { campaignId: id });
  await post(`/api/admin/withdrawals/${first.body.id}/review`, finance.token, { approve: false, note: "Checking" });
  const filed = await post("/api/creators/payout-appeals", creator.token, { subjectType: "withdrawal", subjectId: first.body.id, reason: "Please pay the first request" });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));

  // The creator requested it again meanwhile, so granting would pay it twice.
  const again = await post("/api/creators/withdrawals", creator.token, { campaignId: id });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const refused = await resolve(finance, filed.body.appeal.id, { decision: "grant" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "WITHDRAWAL_IN_FLIGHT");
  assert.equal((await model("PayoutAppeal").findById(filed.body.appeal.id).lean()).status, "open", "back to open");
  assert.equal((await model("Withdrawal").findById(first.body.id).lean()).status, "rejected");

  const support = await harness.registerAdmin({ role: "support" });
  assert.equal((await resolve(support, filed.body.appeal.id, { decision: "deny" })).body.code, "NOTE_REQUIRED");
  const denied = await resolve(support, filed.body.appeal.id, { decision: "deny", note: "Your second request covers it" });
  assert.equal(denied.status, 200, JSON.stringify(denied.body));
  assert.equal(denied.body.appeal.status, "denied");
  assert.ok(await model("Notification").exists({ creatorId: creator.id, type: "payout_appeal_denied" }));
  assert.ok(await model("AdminActivity").exists({ action: "payout_appeal.denied", targetId: first.body.id }));
  assert.equal((await resolve(finance, filed.body.appeal.id, { decision: "grant" })).body.code, "ALREADY_RESOLVED");
});

test("voided pay under appeal is never refunded; granting restores the pay and the place once, denying makes it refundable", async () => {
  const { runAutoRefunds } = require("../../src/services/autoRefunds");
  const { brand, id } = await liveContentCampaign({ destination: "brand_page", deliverables: 3 });
  const finance = await harness.registerAdmin({ role: "finance_admin" });
  const restored = await joinAndSubmit(id);
  const refused = await joinAndSubmit(id);
  for (const c of [restored, refused]) assert.equal((await patch(`/api/submissions/${c.submissionId}/approve`, brand.token)).status, 200);
  await model("Submission").updateMany({ _id: { $in: [restored.submissionId, refused.submissionId] } }, { $set: { reviewedAt: new Date(Date.now() - 15 * DAY) } });
  for (const c of [restored, refused]) {
    const voided = await post(`/api/admin/submissions/${c.submissionId}/void-undelivered`, finance.token, { note: "Never delivered" });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.amount, RATE);
  }
  const stored = await model("Submission").findById(restored.submissionId).lean();
  assert.ok(stored.voidAppealableUntil > new Date(Date.now() + 6 * DAY), "appealable for 7 days");
  assert.equal((await model("Slot").findById(restored.slotId).lean()).creatorId, null, "the place was freed");

  // Ended: only the deliverable nobody took is refunded; both voided ones can still be appealed.
  assert.equal((await patch(`/api/admin/campaigns/${id}/status`, finance.token, { status: "completed" })).status, 200);
  await runAutoRefunds();
  let refunds = await model("Transaction").find({ campaignId: id, type: "refund" }).lean();
  assert.deepEqual(refunds.map((r) => r.refundBreakdown.deliverables), [1]);

  const mine = await appealsOf(restored);
  assert.deepEqual(mine.appealable.map((a) => [a.subjectType, a.amount]), [["fixed_void", RATE]]);
  const appeal = await post("/api/creators/payout-appeals", restored.token, { subjectType: "fixed_void", subjectId: restored.submissionId, reason: "I shared the download link by email" });
  assert.equal(appeal.status, 201, JSON.stringify(appeal.body));
  const denyAppeal = await post("/api/creators/payout-appeals", refused.token, { subjectType: "fixed_void", subjectId: refused.submissionId, reason: "I did deliver the video" });
  assert.equal(denyAppeal.status, 201, JSON.stringify(denyAppeal.body));

  // The appeal window passing doesn't make an appealed deliverable refundable.
  await model("Submission").updateMany({ _id: { $in: [restored.submissionId, refused.submissionId] } }, { $set: { voidAppealableUntil: new Date(Date.now() - 1000) } });
  await runAutoRefunds();
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, type: "refund" }), 1);

  // Granted: back to awaiting delivery, pay credited again, the place back, once.
  const admin = await harness.registerAdmin({ role: "admin" });
  assert.equal((await resolve(admin, appeal.body.appeal.id, { decision: "grant" })).status, 403);
  const granted = await resolve(finance, appeal.body.appeal.id, { decision: "grant", note: "Brand confirmed they got it" });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  assert.deepEqual(granted.body.outcome, { restoredAmount: RATE });
  const submission = await model("Submission").findById(restored.submissionId).lean();
  assert.equal(submission.status, "awaiting_delivery");
  assert.equal(submission.voidAppealOpen, undefined);
  const credit = await model("Transaction").findOne({ reference: `fixed_${restored.submissionId}` }).lean();
  assert.equal(credit.status, "credited");
  assert.equal((await model("Transaction").findOne({ reference: `fixed_void_${restored.submissionId}` }).lean()).status, "reinstated");
  assert.equal(String((await model("Slot").findById(restored.slotId).lean()).creatorId), restored.id);
  // Taking over a grant a crash interrupted changes nothing more.
  const { restoreVoidedPay } = require("../../src/utils/fixedPay");
  await restoreVoidedPay({ submissionId: restored.submissionId });
  const campaign = await model("Campaign").findById(id).lean();
  assert.equal(campaign.fixedPay.creditedSubmissions.filter((s) => String(s) === restored.submissionId).length, 1);
  assert.equal(campaign.fixedPay.credited, RATE);
  await assertBalanced(id);

  // The creator can deliver and be paid as normal.
  const delivered = await patch(`/api/submissions/${restored.submissionId}/deliver`, restored.token, { url: "https://drive.example.com/final.mp4", acceptUsageRights: true });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));

  // Denied: decided, so its deliverable is unused and the job refunds it.
  const denied = await resolve(finance, denyAppeal.body.appeal.id, { decision: "deny", note: "The brand never received it" });
  assert.equal(denied.status, 200, JSON.stringify(denied.body));
  await runAutoRefunds();
  refunds = await model("Transaction").find({ campaignId: id, type: "refund" }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(refunds.map((r) => r.refundBreakdown.deliverables), [1, 1]);
  await runAutoRefunds();
  assert.equal(await model("Transaction").countDocuments({ campaignId: id, type: "refund" }), 2);
  const result = await assertBalanced(id);
  assert.equal(result.owed, RATE, "the restored pay is owed to its creator");
});

test("content appeals share the inbox and their decisions are logged", async () => {
  const { brand, id } = await liveContentCampaign({ destination: "creator_page", deliverables: 1 });
  const creator = await joinAndSubmit(id);
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/reject`, brand.token, { reason: "Wrong product" })).status, 200);
  assert.equal((await patch(`/api/submissions/${creator.submissionId}/appeal`, creator.token, { reason: "It is the right product" })).status, 200);

  const support = await harness.registerAdmin({ role: "support" });
  let listed = await inbox(support, "?kind=content&status=open");
  const row = listed.appeals.find((a) => String(a.id) === creator.submissionId);
  assert.ok(row, "listed");
  assert.deepEqual([row.kind, row.reason, row.decisionReason, row.moneyMoving], ["content", "It is the right product", "Wrong product", false]);
  assert.ok((await inbox(support, `?campaignId=${id}`)).appeals.some((a) => String(a.id) === creator.submissionId));
  assert.ok(!(await inbox(support, "?campaignId=000000000000000000000000")).appeals.some((a) => String(a.id) === creator.submissionId));

  const decided = await patch(`/api/admin/submissions/${creator.submissionId}/appeal`, support.token, { decision: "approve", notes: "Matches the brief" });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.ok(await model("AdminActivity").exists({ action: "submission.appeal_approved", targetId: creator.submissionId }));
  listed = await inbox(support, "?kind=content&status=resolved");
  const done = listed.appeals.find((a) => String(a.id) === creator.submissionId);
  assert.deepEqual([done.status, done.resolutionNote], ["granted", "Matches the brief"]);
});
