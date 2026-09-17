// The brand payment statement (ticket 11): per campaign and overall, paid in, deliverables paid,
// performance paid (views, referrals, bonus), platform fee, refunds issued and pending, and remaining.
// Every figure is the campaign reconciliation's, to the kobo, and the parts add up to what was paid in.
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

const model = (name) => require(`../../src/models/${name}`);
const patch = (path, token, body) => harness.api("PATCH", path, { token, body });
const kobo = (value) => Math.round(value * 100);

async function pay(brand, body) {
  const created = await harness.api("POST", "/api/campaigns", { token: brand.token, body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const checkout = await harness.api("POST", `/api/campaigns/${id}/pay`, { token: brand.token });
  harness.paystack.markPaid(checkout.body.reference);
  await harness.api("GET", `/api/campaigns/${id}/payment-status`, { token: brand.token });
  return id;
}

test("the statement matches reconciliation to the kobo per campaign and overall, and downloads as CSV", async () => {
  const { reconcileCampaignById } = require("../../src/services/campaignReconciliation");
  const { runAutoRefunds } = require("../../src/services/autoRefunds");
  const { applyRefundEvent } = require("../../src/utils/refunds");
  const brand = await harness.registerBrand();
  await model("BusinessProfile").updateOne(
    { userId: brand.id },
    { $set: { "referralVerification.codeCheckAt": new Date(), "referralVerification.conversionAt": new Date(), "referralVerification.verifiedAt": new Date() } },
    { upsert: true }
  );
  const finance = await harness.registerAdmin({ role: "finance_admin" });

  // A content campaign: one deliverable credited (owed), the other two refunded automatically.
  const content = await pay(brand, {
    name: "Statement content",
    category: "Fashion",
    campaignObjective: "content",
    contentPay: { ratePerDeliverable: 15000, deliverables: 3 },
    contentDestination: "brand_page",
    creatorAccess: "open_call",
    brief: { summary: "Style it" },
  });
  const creator = await harness.registerCreator();
  assert.equal((await harness.api("POST", `/api/campaigns/${content}/join`, { token: creator.token })).status, 200);
  const submitted = await harness.api("POST", "/api/submissions", { token: creator.token, body: { campaignId: content, videoUrl: "https://drive.example.com/a.mp4", caption: "Look" } });
  assert.equal((await patch(`/api/submissions/${submitted.body.id}/approve`, brand.token)).status, 200);
  assert.equal((await patch(`/api/admin/campaigns/${content}/status`, finance.token, { status: "completed" })).status, 200);
  await runAutoRefunds();

  // A hybrid campaign still live, and a sign-up campaign cancelled with its refunds, one confirmed by Paystack.
  const hybrid = await pay(brand, {
    name: "Statement hybrid",
    category: "Beauty",
    campaignObjective: "content",
    payShape: "hybrid",
    contentPay: { ratePerDeliverable: 5000, deliverables: 2 },
    hybridBonus: { metric: "views", pool: 10000, capPerCreator: 5000 },
    contentDestination: "creator_page",
    creatorAccess: "open_call",
    brief: { summary: "Glow" },
  });
  const signups = await pay(brand, {
    name: "Statement, \"signups\"",
    category: "Tech",
    campaignObjective: "signups",
    targetViews: 100000,
    referral: { requestedBudget: 50000 },
    creatorAccess: "open_call",
    brief: { summary: "Sign up" },
  });
  assert.equal((await harness.api("PATCH", `/api/campaigns/${signups}/cancel`, { token: brand.token })).status, 200);
  const viewsRefund = await model("Transaction").findOne({ campaignId: signups, type: "refund", bucket: "views" }).lean();
  assert.ok(await applyRefundEvent("refund.processed", { id: viewsRefund.refundParts[0].paystackRefundId }));
  // A draft with no money isn't on the statement.
  const draft = await harness.api("POST", "/api/campaigns", { token: brand.token, body: { name: "Draft", category: "Tech", targetViews: 100000 } });
  assert.equal(draft.status, 201);

  const res = await harness.api("GET", "/api/payouts/statement", { token: brand.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { campaigns, totals } = res.body;
  assert.deepEqual(campaigns.map((c) => c.name).sort(), ["Statement content", "Statement hybrid", 'Statement, "signups"'].sort());

  const sum = { paidIn: 0, deliverables: 0, performance: 0, platformFee: 0, refundsIssued: 0, refundsPending: 0, remaining: 0 };
  for (const line of campaigns) {
    const recon = await reconcileCampaignById(line.campaignId);
    assert.ok(recon.ok, JSON.stringify(recon.problems));
    const toCreators = (pot) => kobo(recon.pots[pot].released) + kobo(recon.pots[pot].inFlight) + kobo(recon.pots[pot].owed);
    assert.equal(kobo(line.paidIn), kobo(recon.paidIn), line.name);
    assert.equal(kobo(line.deliverables), toCreators("fixed"));
    assert.equal(kobo(line.views), toCreators("views"));
    assert.equal(kobo(line.referrals), toCreators("referral"));
    assert.equal(kobo(line.bonus), toCreators("bonus"));
    assert.equal(kobo(line.platformFee), kobo(recon.platformFee));
    assert.equal(kobo(line.refundsIssued), kobo(recon.refunds));
    assert.equal(kobo(line.refundsPending), kobo(recon.pendingRefunds));
    assert.equal(kobo(line.remaining), kobo(recon.left));
    assert.equal(line.balanced, true);
    // The parts add up to what was paid in.
    assert.equal(
      kobo(line.paidIn),
      kobo(line.deliverables) + kobo(line.views) + kobo(line.referrals) + kobo(line.bonus) + kobo(line.platformFee) + kobo(line.refundsIssued) + kobo(line.refundsPending) + kobo(line.remaining)
    );
    for (const key of Object.keys(sum)) sum[key] += kobo(line[key]);
  }
  for (const key of Object.keys(sum)) assert.equal(kobo(totals[key]), sum[key], key);
  assert.equal(totals.campaigns, 3);

  const contentLine = campaigns.find((c) => c.name === "Statement content");
  assert.deepEqual([contentLine.paidIn, contentLine.deliverables, contentLine.owedToCreators, contentLine.refundsPending, contentLine.remaining], [58500, 15000, 15000, 39000, 0]);
  const signupLine = campaigns.find((c) => c.name.startsWith("Statement, "));
  assert.ok(signupLine.refundsIssued > 0 && signupLine.refundsPending > 0, "one refund confirmed, one pending");

  // One campaign.
  const one = await harness.api("GET", `/api/payouts/statement?campaignId=${hybrid}`, { token: brand.token });
  assert.equal(one.status, 200);
  assert.equal(one.body.campaigns.length, 1);
  assert.deepEqual([one.body.totals.paidIn, one.body.totals.remaining], [26000, 26000 - one.body.totals.platformFee]);

  // Only the brand sees its statement.
  const other = await harness.registerBrand();
  assert.equal((await harness.api("GET", `/api/payouts/statement?campaignId=${hybrid}`, { token: other.token })).status, 403);
  assert.equal((await harness.api("GET", "/api/payouts/statement", { token: other.token })).body.campaigns.length, 0);
  assert.equal((await harness.api("GET", "/api/payouts/statement", { token: creator.token })).status, 403);

  // CSV: a row per campaign and the total, amounts to the kobo, text quoted safely.
  const csvRes = await harness.api("GET", "/api/payouts/statement.csv", { token: brand.token });
  assert.equal(csvRes.status, 200);
  const csv = csvRes.body;
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "Campaign,Status,Paid In,Deliverables Paid,Views Paid,Referrals Paid,Bonus Paid,Platform Fee,Refunds Issued,Refunds Pending,Remaining");
  assert.equal(lines.length, 5);
  assert.ok(lines.some((l) => l.startsWith('"Statement, ""signups""",cancelled,')));
  assert.ok(lines[4].startsWith(`Total,,${totals.paidIn.toFixed(2)},`));
});
