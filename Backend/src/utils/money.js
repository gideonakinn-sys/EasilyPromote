// Money helpers shared by escrow, refunds, fixed pay and reconciliation: kobo arithmetic and the
// one map of which pot a ledger row belongs to.

const toKobo = (value) => Math.round((Number(value) || 0) * 100);
const fromKobo = (kobo) => kobo / 100;
const roundMoney = (value) => fromKobo(toKobo(value));

// A campaign's money is split into pots that are funded, paid out and refunded separately.
// Rows written before referral budgets existed have no bucket and belong to views.
const POTS = ["views", "referral", "fixed", "bonus"];
const NON_VIEWS_POTS = POTS.filter((pot) => pot !== "views");

function bucketOf(row) {
  return row && NON_VIEWS_POTS.includes(row.bucket) ? row.bucket : "views";
}

// Query filter matching one pot's rows.
function bucketFilter(pot) {
  if (NON_VIEWS_POTS.includes(pot)) return pot;
  return { $nin: NON_VIEWS_POTS };
}

module.exports = { toKobo, fromKobo, roundMoney, POTS, bucketOf, bucketFilter };
