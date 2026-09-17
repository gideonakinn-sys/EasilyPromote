// A brand's payment statement (ticket 11): per campaign and overall, what the brand paid in and where
// every naira went. Built straight from campaign reconciliation (utils/reconciliation.js), so the figures
// are the reconciliation's, to the kobo:
//
//   paid in = deliverables paid + performance paid (views, referrals, bonus) + platform fee
//             + refunds issued + refunds pending + remaining
//
// "Paid" to creators is what's been paid out, is on its way, or is owed to them (credited and waiting for
// delivery, a hold or a withdrawal). Refunds issued are the ones Paystack confirmed; pending ones are sent
// and waiting (or being retried). Remaining is budget still in the campaign: pools creators can still
// earn from, or unused budget not refunded yet. Read-only.
const Campaign = require("../models/Campaign");
const Transaction = require("../models/Transaction");
const { reconcileCampaigns } = require("./campaignReconciliation");
const { toKobo, fromKobo } = require("../utils/money");

const toCreators = (pot) => toKobo(pot.released) + toKobo(pot.inFlight) + toKobo(pot.owed);
const paidOut = (pot) => toKobo(pot.released) + toKobo(pot.inFlight);

// One campaign's statement line, in kobo, from its reconciliation result.
function lineKobo(result, campaign) {
  const { views, referral, fixed, bonus } = result.pots;
  return {
    campaignId: result.campaignId,
    name: result.name,
    status: result.status,
    campaignModel: campaign ? campaign.campaignModel || "performance" : "performance",
    payShape: campaign ? campaign.payShape || null : null,
    createdAt: campaign ? campaign.createdAt : null,
    paidIn: toKobo(result.paidIn),
    deliverables: toCreators(fixed),
    deliverablesPaidOut: paidOut(fixed),
    views: toCreators(views),
    referrals: toCreators(referral),
    bonus: toCreators(bonus),
    performancePaidOut: paidOut(views) + paidOut(referral) + paidOut(bonus),
    platformFee: toKobo(result.platformFee),
    refundsIssued: toKobo(result.refunds),
    refundsPending: toKobo(result.pendingRefunds),
    remaining: toKobo(result.left),
    balanced: result.ok,
  };
}

const MONEY_FIELDS = ["paidIn", "deliverables", "deliverablesPaidOut", "views", "referrals", "bonus", "performancePaidOut", "platformFee", "refundsIssued", "refundsPending", "remaining"];

function toNaira(line) {
  const out = { ...line };
  for (const field of MONEY_FIELDS) out[field] = fromKobo(line[field]);
  out.performance = fromKobo(line.views + line.referrals + line.bonus);
  out.owedToCreators = fromKobo(line.deliverables + line.views + line.referrals + line.bonus - line.deliverablesPaidOut - line.performancePaidOut);
  return out;
}

// { campaigns: [line], totals } for a brand's campaigns with money on record, newest first. `campaignId`
// narrows it to one of the brand's campaigns.
async function brandStatement(businessId, { campaignId = null } = {}) {
  const filter = { businessId };
  if (campaignId) filter._id = campaignId;
  const campaigns = await Campaign.find(filter).select("name status campaignModel payShape createdAt").sort({ createdAt: -1 }).lean();
  const withMoney = new Set((await Transaction.distinct("campaignId", { campaignId: { $in: campaigns.map((c) => c._id) } })).map(String));
  const ids = campaigns.filter((c) => withMoney.has(String(c._id))).map((c) => c._id);
  const byId = new Map(campaigns.map((c) => [String(c._id), c]));
  const results = ids.length ? await reconcileCampaigns(ids) : [];
  const lines = results.map((r) => lineKobo(r, byId.get(String(r.campaignId)))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totals = Object.fromEntries(MONEY_FIELDS.map((field) => [field, lines.reduce((sum, line) => sum + line[field], 0)]));
  return {
    campaigns: lines.map(toNaira),
    totals: { ...toNaira(totals), campaigns: lines.length, balanced: lines.every((l) => l.balanced) },
  };
}

const CSV_COLUMNS = [
  ["Campaign", (l) => l.name],
  ["Status", (l) => l.status],
  ["Paid In", (l) => l.paidIn],
  ["Deliverables Paid", (l) => l.deliverables],
  ["Views Paid", (l) => l.views],
  ["Referrals Paid", (l) => l.referrals],
  ["Bonus Paid", (l) => l.bonus],
  ["Platform Fee", (l) => l.platformFee],
  ["Refunds Issued", (l) => l.refundsIssued],
  ["Refunds Pending", (l) => l.refundsPending],
  ["Remaining", (l) => l.remaining],
];

// Numbers as plain amounts; text quoted when needed, and never read as a spreadsheet formula.
const csvCell = (value) => {
  if (typeof value === "number") return value.toFixed(2);
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function statementCsv(statement) {
  const rows = [CSV_COLUMNS.map(([header]) => header)];
  for (const line of statement.campaigns) rows.push(CSV_COLUMNS.map(([, get]) => get(line)));
  rows.push(CSV_COLUMNS.map(([header, get], i) => (i === 0 ? "Total" : i === 1 ? "" : get(statement.totals))));
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

module.exports = { brandStatement, statementCsv };
