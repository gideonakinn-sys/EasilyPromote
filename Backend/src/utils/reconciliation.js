// Campaign money reconciliation (ticket 09). Pure: given a campaign, its ledger rows and the
// referral rewards its conversions reserved, it accounts for every naira paid in, per pot:
//
//   paid in = creator payouts (released + in flight) + owed to creators + platform fee kept
//             + refunds + what's left in the pools
//
// and lists every check that doesn't hold, to the kobo. All sums are done in integer kobo.
//
// Pots:
// - views: the deposit holds the fee and the creator pool. Views earnings aren't ledgered until a
//   withdrawal, so what creators have earned but not withdrawn is part of "left".
// - referral: fee and pool are fixed at each top-up; rewards are reserved from the pool per
//   conversion; a refund returns the unreserved pool plus the fee charged on it.
// - fixed (content campaigns): the pool is promised per deliverable by fixed credits; a refund
//   returns unused deliverables plus the fee charged on them, with its breakdown on the row.
// Unmatched payments are never campaign money, and Paystack transfer fees are paid by the
// platform out of its fee; both are reported but not part of the equation.

const toKobo = (value) => Math.round((Number(value) || 0) * 100);
const naira = (kobo) => kobo / 100;
const sum = (rows) => rows.reduce((total, row) => total + toKobo(row.amount), 0);

const COMMITTED_RELEASE = ["escrow_deposit", "released"];
const isDeposit = (t) => ["escrow_deposit", "topup"].includes(t.type) && t.status === "escrow_deposit";

function potOf(t) {
  if (t.bucket === "referral") return "referral";
  if (t.bucket === "fixed") return "fixed";
  return "views";
}

function emptyPot() {
  return { paidIn: 0, released: 0, inFlight: 0, owed: 0, platformFee: 0, refunds: 0, left: 0 };
}

function releasesOf(rows) {
  const releases = rows.filter((t) => t.type === "release");
  return {
    released: sum(releases.filter((t) => t.status === "released")),
    inFlight: sum(releases.filter((t) => t.status === "escrow_deposit")),
    committed: sum(releases.filter((t) => COMMITTED_RELEASE.includes(t.status))),
  };
}

function reconcileViews(campaign, rows, problems) {
  const pot = emptyPot();
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0) return pot;
  const { released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  pot.refunds = sum(rows.filter((t) => t.type === "refund"));
  pot.platformFee = toKobo(campaign.platformFee);
  const pool = toKobo(campaign.creatorPool);
  if (pot.paidIn !== pot.platformFee + pool) {
    problems.push(`views: paid in ₦${naira(pot.paidIn)} but the campaign's fee ₦${naira(pot.platformFee)} + creator pool ₦${naira(pool)} is ₦${naira(pot.platformFee + pool)}`);
  }
  pot.left = pool - committed - pot.refunds;
  if (pot.left < 0) {
    problems.push(`views: payouts ₦${naira(committed)} and refunds ₦${naira(pot.refunds)} exceed the creator pool ₦${naira(pool)}`);
  }
  // The fee is whatever the pool doesn't account for, so the equation closes on what was paid in.
  pot.platformFee = pot.paidIn - pool;
  return pot;
}

function reconcileReferral(campaign, rows, referralEarned, problems) {
  const pot = emptyPot();
  const referral = campaign.referral || {};
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0 && !(toKobo(referral.budget) > 0)) return pot;

  const budget = toKobo(referral.budget);
  const fee = toKobo(referral.platformFee);
  const pool = toKobo(referral.pool);
  const earned = toKobo(referralEarned);
  const remaining = toKobo(referral.poolRemaining);
  if (pot.paidIn !== budget) problems.push(`referral: paid in ₦${naira(pot.paidIn)} but the referral budget is ₦${naira(budget)}`);
  if (budget !== fee + pool) problems.push(`referral: budget ₦${naira(budget)} isn't fee ₦${naira(fee)} + pool ₦${naira(pool)}`);
  if (toKobo(referral.earned) !== earned) {
    problems.push(`referral: conversions reserved ₦${naira(earned)} but the campaign records ₦${naira(toKobo(referral.earned))} earned`);
  }

  const { released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  if (committed > earned) problems.push(`referral: paid out ₦${naira(committed)}, more than the ₦${naira(earned)} creators earned`);
  pot.owed = Math.max(earned - committed, 0);
  pot.refunds = sum(rows.filter((t) => t.type === "refund"));
  pot.left = remaining;

  // What the refund returned from the pool, and so how much of it was fee.
  const refundedPool = pool - earned - remaining;
  if (refundedPool < 0) problems.push(`referral: reserved ₦${naira(earned)} + left ₦${naira(remaining)} exceed the pool ₦${naira(pool)}`);
  if (pot.refunds === 0 && refundedPool !== 0) {
    problems.push(`referral: ₦${naira(refundedPool)} of the pool is unaccounted for (no refund recorded)`);
  }
  const feeRefunded = pot.refunds - Math.max(refundedPool, 0);
  if (pot.refunds > 0 && (feeRefunded < 0 || feeRefunded > fee)) {
    problems.push(`referral: refund ₦${naira(pot.refunds)} doesn't match the unused pool ₦${naira(Math.max(refundedPool, 0))} plus its fee`);
  }
  pot.platformFee = pot.paidIn - (pot.released + pot.inFlight + pot.owed + pot.refunds + pot.left);
  if (pot.platformFee < 0 || pot.platformFee > fee) {
    problems.push(`referral: fee kept ₦${naira(pot.platformFee)} is outside ₦0–₦${naira(fee)}`);
  }
  return pot;
}

function reconcileFixed(campaign, rows, problems) {
  const pot = emptyPot();
  pot.paidIn = sum(rows.filter(isDeposit));
  if (pot.paidIn === 0 && rows.length === 0) return pot;

  const fixedPay = campaign.fixedPay || {};
  const pool = toKobo(campaign.creatorPool);
  const fee = toKobo(campaign.platformFee);
  if (pot.paidIn !== toKobo(campaign.budget) || pot.paidIn !== pool + fee) {
    problems.push(`fixed: paid in ₦${naira(pot.paidIn)} but the campaign's budget is ₦${naira(toKobo(campaign.budget))} (pool ₦${naira(pool)} + fee ₦${naira(fee)})`);
  }

  const credits = rows.filter((t) => t.type === "fixed_credit" && t.status === "credited");
  const credited = sum(credits);
  const creditedSubmissions = (fixedPay.creditedSubmissions || []).map(String);
  if (credited !== toKobo(fixedPay.credited)) {
    problems.push(`fixed: credits in the ledger total ₦${naira(credited)} but the campaign reserved ₦${naira(toKobo(fixedPay.credited))}`);
  }
  const creditIds = credits.map((t) => String(t.submissionId)).sort();
  if (creditIds.length !== new Set(creditIds).size) problems.push("fixed: a submission is credited more than once");
  if (creditIds.join() !== [...creditedSubmissions].sort().join()) {
    problems.push(`fixed: ${creditIds.length} credit rows don't match the ${creditedSubmissions.length} submissions the pool reserved for`);
  }
  const deliverables = Number(campaign.contentPay && campaign.contentPay.deliverables) || 0;
  const refundedDeliverables = Number(fixedPay.refundedDeliverables) || 0;
  if (creditedSubmissions.length + refundedDeliverables > deliverables) {
    problems.push(`fixed: ${creditedSubmissions.length} credited + ${refundedDeliverables} refunded deliverables exceed the ${deliverables} bought`);
  }

  const { released, inFlight, committed } = releasesOf(rows);
  pot.released = released;
  pot.inFlight = inFlight;
  if (committed > credited) problems.push(`fixed: paid out ₦${naira(committed)}, more than the ₦${naira(credited)} credited`);
  pot.owed = Math.max(credited - committed, 0);

  const refunds = rows.filter((t) => t.type === "refund");
  pot.refunds = sum(refunds);
  const refundedCreator = toKobo(fixedPay.refundedCreatorBudget);
  const refundedFee = toKobo(fixedPay.refundedFee);
  if (pot.refunds !== refundedCreator + refundedFee) {
    problems.push(`fixed: refunds ₦${naira(pot.refunds)} don't match the ₦${naira(refundedCreator + refundedFee)} the campaign records as refunded`);
  }
  for (const refund of refunds) {
    const b = refund.refundBreakdown;
    if (!b || toKobo(b.creatorBudget) + toKobo(b.platformFee) !== toKobo(refund.amount)) {
      problems.push(`fixed: refund ${refund.reference || refund._id} has no breakdown matching its amount`);
    }
  }

  pot.left = pool - credited - refundedCreator;
  if (pot.left < 0) problems.push(`fixed: credited ₦${naira(credited)} + refunded ₦${naira(refundedCreator)} exceed the creator pool ₦${naira(pool)}`);
  pot.platformFee = fee - refundedFee;
  if (pot.platformFee < 0) problems.push(`fixed: refunded fee ₦${naira(refundedFee)} exceeds the fee ₦${naira(fee)}`);
  return pot;
}

// transactions: every ledger row of the campaign. referralEarned: the sum of non-voided
// conversion rewards (naira). Returns totals in naira plus the list of problems.
function reconcileCampaign({ campaign, transactions, referralEarned = 0 }) {
  const problems = [];
  const rows = transactions.filter((t) => !["unmatched_payment", "transfer_fee"].includes(t.type));
  const byPot = { views: [], referral: [], fixed: [] };
  for (const row of rows) byPot[potOf(row)].push(row);

  if (campaign.campaignModel === "content" && byPot.views.some(isDeposit)) {
    problems.push("fixed: this content campaign's payment was booked to the views pot, so its fixed pay can't be paid from it");
  }

  const pots = {
    views: reconcileViews(campaign, byPot.views, problems),
    referral: reconcileReferral(campaign, byPot.referral, referralEarned, problems),
    fixed: reconcileFixed(campaign, byPot.fixed, problems),
  };

  const total = emptyPot();
  for (const pot of Object.values(pots)) for (const key of Object.keys(total)) total[key] += pot[key];
  const accounted = total.released + total.inFlight + total.owed + total.platformFee + total.refunds + total.left;
  if (accounted !== total.paidIn) {
    problems.push(`paid in ₦${naira(total.paidIn)} but ₦${naira(accounted)} is accounted for`);
  }

  const toNaira = (pot) => Object.fromEntries(Object.entries(pot).map(([key, kobo]) => [key, naira(kobo)]));
  return {
    campaignId: campaign._id,
    name: campaign.name,
    status: campaign.status,
    ...toNaira(total),
    transferFees: naira(sum(transactions.filter((t) => t.type === "transfer_fee" && t.status !== "failed"))),
    unmatchedPayments: naira(sum(transactions.filter((t) => t.type === "unmatched_payment"))),
    pots: { views: toNaira(pots.views), referral: toNaira(pots.referral), fixed: toNaira(pots.fixed) },
    ok: problems.length === 0,
    problems,
  };
}

module.exports = { reconcileCampaign };
