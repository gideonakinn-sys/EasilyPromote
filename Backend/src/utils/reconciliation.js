// Campaign money reconciliation (ticket 09). Pure: given a campaign, its ledger rows, submissions,
// placements and conversions, it accounts for every naira paid in, per pot:
//
//   paid in = creator payouts (released + in flight) + owed to creators + platform fee kept
//             + refunds (succeeded) + refunds pending + what's left in the pools
//
// Nothing on the right is derived from the left: the fee comes from the campaign's fee percent
// (inside the price for views and referral budgets, on top of the creator budget for content, D2),
// payouts are checked per creator against what that creator earned, and content refunds are
// recomputed from the submissions. Every check that doesn't hold is listed. Sums are in kobo.
//
// Refunds: succeeded rows count as refunds. Pending rows are reported separately. Failed content
// refunds moved nothing and hold nothing, so they're excluded. Failed views/referral refunds are
// money set aside for the brand that an admin must refund by hand, so they stay in pending.
// Unmatched payments and Paystack transfer fees (paid from the platform fee) are reported only.

const { toKobo, fromKobo, bucketOf } = require("./money");
const rules = require("./fixedPayRules");
const { viewsEarned } = require("./earnings");

const COMMITTED_RELEASE = ["escrow_deposit", "released"];
const isDeposit = (t) => ["escrow_deposit", "topup"].includes(t.type) && t.status === "escrow_deposit";
const sum = (rows) => rows.reduce((total, row) => total + toKobo(row.amount), 0);
const naira = (kobo) => `₦${fromKobo(kobo)}`;
const feePercentOf = (campaign) => (Number.isFinite(campaign.platformFeePercent) ? campaign.platformFeePercent : 30);
// A fee inside an amount, per payment, as checkout and top-ups book it.
const feeInside = (amountKobo, percent) => Math.round((amountKobo * percent) / 100);

function emptyPot() {
  return { paidIn: 0, released: 0, inFlight: 0, owed: 0, platformFee: 0, refunds: 0, pendingRefunds: 0, left: 0 };
}

function releasesOf(rows) {
  const releases = rows.filter((t) => t.type === "release");
  return {
    releases,
    released: sum(releases.filter((t) => t.status === "released")),
    inFlight: sum(releases.filter((t) => t.status === "escrow_deposit")),
    committed: sum(releases.filter((t) => COMMITTED_RELEASE.includes(t.status))),
  };
}

// Committed payout per creator. Older views releases carry only a submission.
function releasedByCreator(releases, submissionCreator) {
  const byCreator = new Map();
  for (const release of releases.filter((t) => COMMITTED_RELEASE.includes(t.status))) {
    const creator = release.creatorId ? String(release.creatorId) : submissionCreator.get(String(release.submissionId)) || "unknown";
    byCreator.set(creator, (byCreator.get(creator) || 0) + toKobo(release.amount));
  }
  return byCreator;
}

function checkPerCreator(pot, releases, earnedByCreator, submissionCreator, problems, what) {
  for (const [creator, paid] of releasedByCreator(releases, submissionCreator)) {
    const earned = earnedByCreator.get(creator) || 0;
    if (paid > earned) problems.push(`${pot}: creator ${creator} was paid ${naira(paid)}, more than the ${naira(earned)} ${what}`);
  }
}

function reconcileViews({ campaign, rows, submissions, slots }, problems) {
  const pot = emptyPot();
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0) return pot;

  const percent = feePercentOf(campaign);
  const fee = rows.filter(isDeposit).reduce((total, t) => total + feeInside(toKobo(t.amount), percent), 0);
  const pool = pot.paidIn - fee;
  if (Math.abs(toKobo(campaign.platformFee) - fee) > rows.filter(isDeposit).length) {
    problems.push(`views: the campaign records a ${naira(toKobo(campaign.platformFee))} fee but ${percent}% of ${naira(pot.paidIn)} paid in is ${naira(fee)}`);
  }
  if (Math.abs(toKobo(campaign.creatorPool) - pool) > rows.filter(isDeposit).length) {
    problems.push(`views: the campaign records a ${naira(toKobo(campaign.creatorPool))} creator pool but paid in less the fee is ${naira(pool)}`);
  }

  const { releases, released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  const submissionCreator = new Map(submissions.map((s) => [String(s._id), String(s.creatorId)]));
  const earnedByCreator = new Map();
  for (const slot of slots.filter((s) => s.creatorId && s.kind !== "deliverable")) {
    const views = submissions.filter((s) => String(s.creatorId) === String(slot.creatorId)).reduce((total, s) => total + (s.viewsDelivered || 0), 0);
    earnedByCreator.set(String(slot.creatorId), toKobo(viewsEarned(slot, views)));
  }
  checkPerCreator("views", releases, earnedByCreator, submissionCreator, problems, "their views earned");

  const refunds = rows.filter((t) => t.type === "refund");
  pot.refunds = sum(refunds.filter((t) => t.status === "refunded"));
  pot.pendingRefunds = sum(refunds.filter((t) => t.status !== "refunded"));
  pot.platformFee = fee;
  pot.left = pool - committed - pot.refunds - pot.pendingRefunds;
  if (pot.left < 0) {
    problems.push(`views: payouts ${naira(committed)} and refunds ${naira(pot.refunds + pot.pendingRefunds)} exceed the creator pool ${naira(pool)}`);
  }
  return pot;
}

function reconcileReferral({ campaign, rows, conversionEvents }, problems) {
  const pot = emptyPot();
  const referral = campaign.referral || {};
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0 && !(toKobo(referral.budget) > 0)) return pot;

  const percent = feePercentOf(campaign);
  const fee = rows.filter(isDeposit).reduce((total, t) => total + feeInside(toKobo(t.amount), percent), 0);
  const pool = pot.paidIn - fee;
  if (toKobo(referral.budget) !== pot.paidIn) problems.push(`referral: paid in ${naira(pot.paidIn)} but the referral budget is ${naira(toKobo(referral.budget))}`);
  if (toKobo(referral.platformFee) !== fee) problems.push(`referral: the campaign records a ${naira(toKobo(referral.platformFee))} fee but ${percent}% of what was paid in is ${naira(fee)}`);
  if (toKobo(referral.pool) !== pool) problems.push(`referral: the campaign records a ${naira(toKobo(referral.pool))} pool but paid in less the fee is ${naira(pool)}`);

  const events = conversionEvents.filter((e) => e.rewardAmount > 0 && !e.voidedAt);
  const earned = sum(events.map((e) => ({ amount: e.rewardAmount })));
  if (toKobo(referral.earned) !== earned) {
    problems.push(`referral: conversions reserved ${naira(earned)} but the campaign records ${naira(toKobo(referral.earned))} earned`);
  }
  const earnedByCreator = new Map();
  for (const event of events) earnedByCreator.set(String(event.creatorId), (earnedByCreator.get(String(event.creatorId)) || 0) + toKobo(event.rewardAmount));

  const { releases, released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  checkPerCreator("referral", releases, earnedByCreator, new Map(), problems, "their conversions earned");
  pot.owed = Math.max(earned - committed, 0);

  const refunds = rows.filter((t) => t.type === "refund");
  pot.refunds = sum(refunds.filter((t) => t.status === "refunded"));
  pot.pendingRefunds = sum(refunds.filter((t) => t.status !== "refunded"));
  const refunded = pot.refunds + pot.pendingRefunds;
  const remaining = toKobo(referral.poolRemaining);
  pot.left = remaining;

  // A cancellation refunds the unreserved pool grossed up by its fee.
  const refundedPool = pool - earned - remaining;
  if (refundedPool < 0) problems.push(`referral: reserved ${naira(earned)} + left ${naira(remaining)} exceed the pool ${naira(pool)}`);
  const expectedRefund = refundedPool > 0 && percent < 100 ? Math.round((refundedPool * 100) / (100 - percent)) : 0;
  if (Math.abs(refunded - expectedRefund) > 1) {
    problems.push(`referral: refunds ${naira(refunded)} don't match the unused pool ${naira(Math.max(refundedPool, 0))} plus its fee (${naira(expectedRefund)})`);
  }
  pot.platformFee = fee - Math.max(refunded - Math.max(refundedPool, 0), 0);
  return pot;
}

function reconcileFixed({ campaign, rows, submissions, now }, problems) {
  const pot = emptyPot();
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0) return pot;

  const fixedPay = campaign.fixedPay || {};
  const rate = (campaign.contentPay && campaign.contentPay.ratePerDeliverable) || 0;
  const bought = (campaign.contentPay && campaign.contentPay.deliverables) || 0;
  const pool = toKobo(rate) * bought;
  const fee = toKobo(rules.contentPlatformFee(fromKobo(pool), campaign.platformFeePercent));
  if (toKobo(campaign.creatorPool) !== pool) problems.push(`fixed: creator pool ${naira(toKobo(campaign.creatorPool))} isn't ${bought} deliverables × ${naira(toKobo(rate))}`);
  if (toKobo(campaign.platformFee) !== fee) problems.push(`fixed: the campaign records a ${naira(toKobo(campaign.platformFee))} fee but ${feePercentOf(campaign)}% of the creator budget is ${naira(fee)}`);
  if (pot.paidIn !== pool + fee) problems.push(`fixed: paid in ${naira(pot.paidIn)} but the creator budget plus fee is ${naira(pool + fee)}`);

  const credits = rows.filter((t) => t.type === "fixed_credit" && t.status === "credited");
  const credited = sum(credits);
  if (credited !== toKobo(fixedPay.credited)) {
    problems.push(`fixed: credits in the ledger total ${naira(credited)} but the campaign reserved ${naira(toKobo(fixedPay.credited))}`);
  }
  const creditIds = credits.map((t) => String(t.submissionId)).sort();
  if (creditIds.length !== new Set(creditIds).size) problems.push("fixed: a submission is credited more than once");
  const reservedIds = (fixedPay.creditedSubmissions || []).map(String).sort();
  if (creditIds.join() !== reservedIds.join()) {
    problems.push(`fixed: ${creditIds.length} credit rows don't match the ${reservedIds.length} submissions the pool reserved for`);
  }
  for (const voided of rows.filter((t) => t.type === "fixed_credit" && t.status === "voided")) {
    const reversal = rows.find((t) => t.type === "fixed_void" && String(t.submissionId) === String(voided.submissionId));
    if (!reversal || toKobo(reversal.amount) !== toKobo(voided.amount)) problems.push(`fixed: voided credit for submission ${voided.submissionId} has no matching reversal`);
  }

  // Payouts per creator never exceed that creator's credits that are delivered and past their hold.
  const submissionById = new Map(submissions.map((s) => [String(s._id), s]));
  const eligibleByCreator = new Map();
  for (const credit of credits) {
    if (rules.fixedCreditState(submissionById.get(String(credit.submissionId)), now).state !== "available") continue;
    const creator = String(credit.creatorId);
    eligibleByCreator.set(creator, (eligibleByCreator.get(creator) || 0) + toKobo(credit.amount));
  }
  const { releases, released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  checkPerCreator("fixed", releases, eligibleByCreator, new Map(), problems, "credited for delivered work past its hold");
  pot.owed = credited - committed;
  if (pot.owed < 0) problems.push(`fixed: paid out ${naira(committed)}, more than the ${naira(credited)} credited`);

  // Refunds, recomputed from the submissions: each row's amount follows the formula for its
  // deliverables, and together they never exceed the deliverables that are really unused.
  const refunds = rows.filter((t) => t.type === "refund" && t.status !== "refund_failed");
  let refundedDeliverables = 0;
  let refundedCreator = 0;
  let refundedFee = 0;
  for (const refund of refunds) {
    const b = refund.refundBreakdown || {};
    const expected = rules.refundFor({ deliverables: b.deliverables, bought, ratePerDeliverable: rate, platformFee: fromKobo(fee) });
    if (toKobo(expected.amount) !== toKobo(refund.amount) || toKobo(expected.creatorBudget) !== toKobo(b.creatorBudget)) {
      problems.push(`fixed: refund ${refund.reference || refund._id} is ${naira(toKobo(refund.amount))} but ${b.deliverables || 0} unused deliverables refund ${naira(toKobo(expected.amount))}`);
    }
    refundedDeliverables += b.deliverables || 0;
    refundedCreator += toKobo(expected.creatorBudget);
    refundedFee += toKobo(expected.platformFee);
  }
  const creditedIds = new Set(creditIds);
  const stillEarning = submissions.filter((s) => !creditedIds.has(String(s._id)) && s.status !== "completed" && rules.canStillEarn(s, now)).length;
  const unused = Math.max(bought - credits.length - stillEarning, 0);
  if (refundedDeliverables > unused) {
    problems.push(`fixed: ${refundedDeliverables} deliverables refunded but only ${unused} are unused`);
  }
  const reservations = fixedPay.refundReservations || [];
  const reservedRefundIds = reservations.map((r) => String(r.refundId)).sort().join();
  if (reservedRefundIds !== refunds.map((r) => String(r._id)).sort().join()) {
    problems.push("fixed: the refunds holding budget on the campaign don't match the pending and succeeded refund rows (retry the pending refund)");
  }

  pot.refunds = sum(refunds.filter((t) => t.status === "refunded"));
  pot.pendingRefunds = sum(refunds.filter((t) => t.status === "refund_pending"));
  pot.left = pool - credited - refundedCreator;
  if (pot.left < 0) problems.push(`fixed: credited ${naira(credited)} + refunded ${naira(refundedCreator)} exceed the creator pool ${naira(pool)}`);
  pot.platformFee = fee - refundedFee;
  return pot;
}

// Returns totals in naira plus the list of problems.
function reconcileCampaign({ campaign, transactions, submissions = [], slots = [], conversionEvents = [], now = new Date() }) {
  const problems = [];
  const rows = transactions.filter((t) => !["unmatched_payment", "transfer_fee"].includes(t.type));
  const byPot = { views: [], referral: [], fixed: [] };
  for (const row of rows) byPot[bucketOf(row)].push(row);

  if (campaign.campaignModel === "content" && byPot.views.some(isDeposit)) {
    problems.push("fixed: this content campaign's payment was booked to the views pot, so its fixed pay can't be paid from it");
  }

  const pots = {
    views: reconcileViews({ campaign, rows: byPot.views, submissions, slots }, problems),
    referral: reconcileReferral({ campaign, rows: byPot.referral, conversionEvents }, problems),
    fixed: reconcileFixed({ campaign, rows: byPot.fixed, submissions, now }, problems),
  };

  const total = emptyPot();
  for (const pot of Object.values(pots)) for (const key of Object.keys(total)) total[key] += pot[key];
  const accounted = total.released + total.inFlight + total.owed + total.platformFee + total.refunds + total.pendingRefunds + total.left;
  if (accounted !== total.paidIn) {
    problems.push(`paid in ${naira(total.paidIn)} but ${naira(accounted)} is accounted for`);
  }

  const toNaira = (pot) => Object.fromEntries(Object.entries(pot).map(([key, kobo]) => [key, fromKobo(kobo)]));
  return {
    campaignId: campaign._id,
    name: campaign.name,
    status: campaign.status,
    ...toNaira(total),
    failedRefunds: fromKobo(sum(transactions.filter((t) => t.type === "refund" && t.status === "refund_failed"))),
    transferFees: fromKobo(sum(transactions.filter((t) => t.type === "transfer_fee" && t.status !== "failed"))),
    unmatchedPayments: fromKobo(sum(transactions.filter((t) => t.type === "unmatched_payment"))),
    pots: { views: toNaira(pots.views), referral: toNaira(pots.referral), fixed: toNaira(pots.fixed) },
    ok: problems.length === 0,
    problems,
  };
}

module.exports = { reconcileCampaign };
