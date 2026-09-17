// Hybrid pay's bonus (ticket 10). A hybrid campaign is a content campaign whose creators earn the
// base per approved deliverable (fixed pay, utils/fixedPay.js, unchanged) plus a performance bonus
// from a bonus pool the brand funds at checkout. The bonus is the fourth pot beside views, referral
// and fixed: checkout books the pool and its fee (on top, D2) into the "bonus" pot, each bonus is
// credited from it as a bonus_credit ledger row, and credits go out in the weekly per-campaign
// withdrawal like the other pots.
//
// What the bonus pays for (D4, rate authority per ADR 0003):
// - views: verified views on the creator's live posts × the price-table rate per 1,000 views, stored
//   on the campaign at setup. Accrued after each views sync while the campaign is live or paused.
// - sign-ups / downloads: each counted conversion on the creator's referral code × admin's
//   referral.rewardPerConversion. Conversions recorded before admin sets it are paid once it's set.
//
// Invariants, each enforced by one conditional update on the campaign:
// - A creator's bonus never exceeds the cap, and the pool is never overdrawn: every reservation is a
//   compare-and-set on the pool, the total reserved and that creator's earned amount, so two racing
//   reservations can't both spend the same naira. Amounts are rounded to the kobo, never drifting.
// - A reservation is credited at most once: it's pushed to hybridBonus.pending with its ledger
//   reference in the same update, the ledger row is an upsert on that unique reference, and the
//   entry is dropped after. A crash in between leaves an entry the next run settles.
//
// Credits are held 7 days, then withdrawable (live, paused, completed or cancelled campaigns). A
// conversion voided in its hold gives its bonus back to the pool. At campaign end finance or super
// admins refund the unused pool plus the fee on it (D5 amended).
const mongoose = require("mongoose");
const { toObjectId } = require("./objectId");
const Campaign = require("../models/Campaign");
const ConversionEvent = require("../models/ConversionEvent");
const Submission = require("../models/Submission");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const { toKobo, fromKobo, roundMoney } = require("./money");
const { buildRefundParts, sendRefundParts, refundStatusFromParts, describeFailures } = require("./refunds");
const rules = require("./hybridBonusRules");

const { BONUS_HOLD_MS, bonusCreditState, viewsBonusDueKobo, unusedBonusRefund, bonusRefundableFrom } = rules;

// Campaign statuses where views still earn a bonus, and where a creator's bonus can be withdrawn.
const BONUS_ACCRUING_STATUSES = ["live", "paused"];
const BONUS_WITHDRAWABLE_CAMPAIGN_STATUSES = ["live", "paused", "completed", "cancelled"];
const COMMITTED_RELEASE_STATUSES = ["escrow_deposit", "released"];
// A compare-and-set reservation retries this often when other reservations keep landing first.
const MAX_RESERVE_ATTEMPTS = 50;
// Test seam: runs after a conversion's bonus credit is voided, before its bonus goes back to the pool.
const voidHooks = { afterCreditVoided: null };

const conversionReference = (conversionId) => `bonus_conv_${conversionId}`;
const viewsReference = (campaignId, creatorId, totalKobo) => `bonus_views_${campaignId}_${creatorId}_${totalKobo}`;
const refundReference = (campaignId, claimNumber) => `refund_bonus_${campaignId}_${claimNumber}`;

function isHybridCampaign(campaign) {
  return Boolean(campaign && campaign.payShape === "hybrid" && campaign.hybridBonus && campaign.hybridBonus.metric);
}

// Sign-up and download bonuses are verified through referral codes.
function isConversionBonus(campaign) {
  return isHybridCampaign(campaign) && campaign.hybridBonus.metric !== "views";
}

class BonusError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// ── Reserving and crediting ─────────────────────────────────────────────────

// Writes a reservation's ledger row (an upsert on its unique reference), records a conversion's
// bonus on the conversion, and drops the pending entry. Safe to repeat.
async function settleReservation(campaignId, entry) {
  try {
    await Transaction.findOneAndUpdate(
      { reference: entry.ref, type: "bonus_credit" },
      {
        $setOnInsert: {
          campaignId,
          creatorId: entry.creatorId,
          type: "bonus_credit",
          bucket: "bonus",
          amount: entry.amount,
          status: "credited",
          reference: entry.ref,
          adminNotes: entry.conversionId ? `Bonus for conversion ${entry.conversionId}` : "Bonus for verified views",
          date: entry.at,
        },
      },
      { upsert: true, new: false, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Two settles of one entry at once: the other wrote the row.
    if (error.code !== 11000) throw error;
  }
  if (entry.conversionId) {
    await ConversionEvent.updateOne(
      { _id: entry.conversionId, bonusAmount: { $not: { $gt: 0 } } },
      { $set: { bonusAmount: entry.amount, unpaidReason: null, availableAt: new Date(new Date(entry.at).getTime() + BONUS_HOLD_MS) } }
    );
  }
  await Campaign.updateOne({ _id: campaignId }, { $pull: { "hybridBonus.pending": { ref: entry.ref } } });
}

// Settles reservations a crash left without their ledger row. Returns how many it settled.
async function settlePendingBonus(campaignId) {
  const campaign = await Campaign.findById(campaignId).select("hybridBonus.pending").lean();
  const pending = (campaign && campaign.hybridBonus && campaign.hybridBonus.pending) || [];
  for (const entry of pending) await settleReservation(campaign._id, entry);
  return pending.length;
}

// Reserves bonus for one creator, as much as their cap and the pool allow: `wantKobo` more (a
// conversion), or up to `totalDueKobo` in all (views, worked out again against what's already reserved
// on every attempt, so a run that loses a race never credits the same views twice).
// `refFor(newEarnedKobo)` names the ledger row. Returns { amount, ref } or { amount: 0, reason }
// where reason is cap_reached, pool_exhausted or already_credited.
async function reserveBonus({ campaignId, creatorId, wantKobo = null, totalDueKobo = null, refFor, conversionId = null, now = new Date() }) {
  const creator = toObjectId(creatorId);
  // The creator's entry, created once; the cap is checked against it.
  await Campaign.updateOne(
    { _id: campaignId, "hybridBonus.metric": { $exists: true }, "hybridBonus.creators.creatorId": { $ne: creator } },
    { $push: { "hybridBonus.creators": { creatorId: creator, earned: 0 } } }
  );

  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt += 1) {
    const campaign = await Campaign.findById(campaignId).select("hybridBonus").lean();
    const bonus = campaign && campaign.hybridBonus;
    if (!bonus || !bonus.metric) return { amount: 0, reason: "not_hybrid" };
    const entry = (bonus.creators || []).find((c) => String(c.creatorId) === String(creator));
    if (!entry) return { amount: 0, reason: "not_hybrid" };

    const earnedKobo = toKobo(entry.earned);
    const capRoomKobo = toKobo(bonus.capPerCreator) - earnedKobo;
    const poolKobo = toKobo(bonus.poolRemaining);
    const wanted = totalDueKobo !== null ? totalDueKobo - earnedKobo : wantKobo;
    if (!(wanted > 0)) return { amount: 0, reason: "nothing_due" };
    const grantKobo = Math.min(Math.floor(wanted), capRoomKobo, poolKobo);
    if (grantKobo <= 0) return { amount: 0, reason: capRoomKobo <= 0 ? "cap_reached" : "pool_exhausted" };

    const ref = refFor(earnedKobo + grantKobo);
    if ((bonus.pending || []).some((p) => p.ref === ref) || (await Transaction.exists({ reference: ref, type: "bonus_credit" }))) {
      return { amount: 0, reason: "already_credited", ref };
    }

    const amount = fromKobo(grantKobo);
    const reserved = await Campaign.findOneAndUpdate(
      {
        _id: campaignId,
        "hybridBonus.poolRemaining": bonus.poolRemaining,
        "hybridBonus.reserved": bonus.reserved,
        "hybridBonus.pending.ref": { $ne: ref },
        "hybridBonus.creators": { $elemMatch: { creatorId: creator, earned: entry.earned } },
      },
      {
        $set: {
          "hybridBonus.poolRemaining": fromKobo(poolKobo - grantKobo),
          "hybridBonus.reserved": fromKobo(toKobo(bonus.reserved) + grantKobo),
          "hybridBonus.creators.$.earned": fromKobo(earnedKobo + grantKobo),
        },
        $push: { "hybridBonus.pending": { ref, creatorId: creator, amount, conversionId, at: now } },
      },
      { new: true, projection: { _id: 1 } }
    );
    if (!reserved) continue;
    await settleReservation(campaignId, { ref, creatorId: creator, amount, conversionId, at: now });
    return { amount, ref };
  }
  console.error(`[HybridBonus] Gave up reserving bonus for creator ${creator} on campaign ${campaignId} after ${MAX_RESERVE_ATTEMPTS} attempts`);
  return { amount: 0, reason: "busy" };
}

// Gives a voided bonus back to the pool and takes it off the creator's earned amount, once per credit:
// the credit's reference is recorded on the campaign in the same compare-and-set, so a repeat (the
// ops job finishing a void a crash interrupted) never gives the same bonus back twice. Returns true
// once the bonus is back in the pool (now or earlier).
async function giveBackBonus(campaignId, creatorId, amount, ref) {
  const creator = toObjectId(creatorId);
  const amountKobo = toKobo(amount);
  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt += 1) {
    const campaign = await Campaign.findById(campaignId).select("hybridBonus").lean();
    const bonus = campaign && campaign.hybridBonus;
    if (bonus && (bonus.returnedRefs || []).includes(ref)) return true;
    const entry = bonus && (bonus.creators || []).find((c) => String(c.creatorId) === String(creator));
    if (!entry) return false;
    const updated = await Campaign.updateOne(
      {
        _id: campaignId,
        "hybridBonus.poolRemaining": bonus.poolRemaining,
        "hybridBonus.reserved": bonus.reserved,
        "hybridBonus.returnedRefs": { $ne: ref },
        "hybridBonus.creators": { $elemMatch: { creatorId: creator, earned: entry.earned } },
      },
      {
        $set: {
          "hybridBonus.poolRemaining": fromKobo(toKobo(bonus.poolRemaining) + amountKobo),
          "hybridBonus.reserved": fromKobo(Math.max(toKobo(bonus.reserved) - amountKobo, 0)),
          "hybridBonus.creators.$.earned": fromKobo(Math.max(toKobo(entry.earned) - amountKobo, 0)),
        },
        $push: { "hybridBonus.returnedRefs": ref },
      }
    );
    if (updated.modifiedCount === 1) return true;
  }
  console.error(`[HybridBonus] Couldn't give back ₦${amount} voided bonus on campaign ${campaignId}; the ops job retries it`);
  return false;
}

// Finishes one voided credit: its bonus back in the pool, then the credit marked as returned.
async function returnVoidedBonus(credit) {
  const returned = await giveBackBonus(credit.campaignId, credit.creatorId, credit.amount, credit.reference);
  if (returned) await Transaction.updateOne({ _id: credit._id, bonusGiveBack: "pending" }, { $set: { bonusGiveBack: "done" } });
  return returned;
}

// Voided bonus credits whose give-back a crash interrupted (the credit is voided but the pool never got
// the money back): finished here. Run by the ops job. Returns how many it returned.
async function repairVoidedBonuses() {
  const stranded = await Transaction.find({ type: "bonus_credit", status: "voided", bonusGiveBack: "pending" }).lean();
  let returned = 0;
  for (const credit of stranded) {
    try {
      if (await returnVoidedBonus(credit)) returned += 1;
    } catch (error) {
      console.error(`[HybridBonus] Returning voided bonus ${credit.reference} failed:`, error.message);
    }
  }
  return returned;
}

// ── Views bonus ─────────────────────────────────────────────────────────────

// Credits every creator on one live or paused views-bonus campaign what their verified views have
// earned since the last run, up to the cap and while the pool lasts. Returns { credited, amount }.
async function accrueViewsBonus(campaignId, now = new Date()) {
  await settlePendingBonus(campaignId);
  const campaign = await Campaign.findById(campaignId).select("status payShape hybridBonus").lean();
  if (!isHybridCampaign(campaign) || campaign.hybridBonus.metric !== "views" || !BONUS_ACCRUING_STATUSES.includes(campaign.status)) {
    return { credited: 0, amount: 0 };
  }
  const bonus = campaign.hybridBonus;
  // Only live posts the brand verified (or that verified automatically) count.
  const groups = await Submission.aggregate([
    { $match: { campaignId: campaign._id, postVerifiedAt: { $ne: null }, status: { $nin: ["rejected", "not_delivered"] } } },
    { $group: { _id: "$creatorId", views: { $sum: { $ifNull: ["$viewsDelivered", 0] } } } },
  ]);
  const earnedByCreator = new Map((bonus.creators || []).map((c) => [String(c.creatorId), toKobo(c.earned)]));

  let credited = 0;
  let amountKobo = 0;
  for (const group of groups) {
    const dueKobo = viewsBonusDueKobo({ views: group.views, ratePerThousandViews: bonus.ratePerThousandViews, capPerCreator: bonus.capPerCreator });
    if (dueKobo <= (earnedByCreator.get(String(group._id)) || 0)) continue;
    const result = await reserveBonus({
      campaignId: campaign._id,
      creatorId: group._id,
      totalDueKobo: dueKobo,
      refFor: (totalKobo) => viewsReference(campaign._id, group._id, totalKobo),
      now,
    });
    if (result.amount > 0) {
      credited += 1;
      amountKobo += toKobo(result.amount);
    }
  }
  return { credited, amount: fromKobo(amountKobo) };
}

// Views bonuses on every live or paused views-bonus campaign, after settling any hybrid campaign's
// reservations a crash left unwritten. Runs after each views sync and in the ops job. Never throws
// for one campaign.
async function accrueAllViewsBonuses(now = new Date()) {
  const unsettled = await Campaign.find({ "hybridBonus.pending.0": { $exists: true } }).select("_id").lean();
  for (const campaign of unsettled) {
    await settlePendingBonus(campaign._id).catch((error) => console.error(`[HybridBonus] Settling bonus on ${campaign._id} failed:`, error.message));
  }
  const campaigns = await Campaign.find({ payShape: "hybrid", "hybridBonus.metric": "views", status: { $in: BONUS_ACCRUING_STATUSES } })
    .select("_id")
    .lean();
  let amountKobo = 0;
  for (const campaign of campaigns) {
    try {
      amountKobo += toKobo((await accrueViewsBonus(campaign._id, now)).amount);
    } catch (error) {
      console.error(`[HybridBonus] Views bonus for campaign ${campaign._id} failed:`, error.message);
    }
  }
  return { campaigns: campaigns.length, amount: fromKobo(amountKobo) };
}

// The views syncs also refresh verified live posts on views-bonus campaigns, which content
// approval has already moved to completed. Returns a filter for those submissions, or null.
async function viewsBonusSubmissionFilter() {
  const ids = await Campaign.distinct("_id", { payShape: "hybrid", "hybridBonus.metric": "views", status: { $in: BONUS_ACCRUING_STATUSES } });
  return ids.length ? { campaignId: { $in: ids }, status: "completed", postVerifiedAt: { $ne: null } } : null;
}

// ── Conversion bonus ────────────────────────────────────────────────────────

const REASON_FOR = { cap_reached: "bonus_cap_reached", pool_exhausted: "bonus_pool_exhausted", busy: "bonus_pool_exhausted" };

// Reserves one counted conversion's bonus on a sign-up or download bonus campaign: admin's reward,
// or what's left of the creator's cap or the pool when that's less. Returns what processConversion
// records: { bonusAmount, unpaidReason, availableAt }.
async function reserveConversionBonus(campaign, event, counted, now = new Date()) {
  if (!counted) return { bonusAmount: 0, unpaidReason: "not_counted", availableAt: null };
  const rate = roundMoney(campaign.referral && campaign.referral.rewardPerConversion);
  if (!(rate > 0)) return { bonusAmount: 0, unpaidReason: "bonus_rate_not_set", availableAt: null };

  const result = await reserveBonus({
    campaignId: campaign._id,
    creatorId: event.creatorId,
    wantKobo: toKobo(rate),
    refFor: () => conversionReference(event._id),
    conversionId: event._id,
    now,
  });
  if (result.amount > 0) return { bonusAmount: result.amount, unpaidReason: null, availableAt: new Date(now.getTime() + BONUS_HOLD_MS) };
  if (result.reason === "already_credited") {
    const credit = await Transaction.findOne({ reference: conversionReference(event._id), type: "bonus_credit" }).lean();
    if (credit) return { bonusAmount: credit.amount, unpaidReason: null, availableAt: new Date(new Date(credit.date).getTime() + BONUS_HOLD_MS) };
  }
  return { bonusAmount: 0, unpaidReason: REASON_FOR[result.reason] || "bonus_pool_exhausted", availableAt: null };
}

// Once admin sets the reward: conversions recorded before it are paid, oldest first, while the pool
// and each creator's cap last. Returns { paid, unpaid, byCreator: Map(creatorId -> { count, amount }) }.
async function payUnpaidConversionBonuses(campaignId, now = new Date()) {
  const byCreator = new Map();
  const campaign = await Campaign.findById(campaignId).select("payShape hybridBonus referral").lean();
  if (!isConversionBonus(campaign) || !(campaign.referral && campaign.referral.rewardPerConversion > 0)) return { paid: 0, unpaid: 0, byCreator };
  await settlePendingBonus(campaign._id);

  const waiting = await ConversionEvent.find({ campaignId: campaign._id, counted: true, voidedAt: null, unpaidReason: "bonus_rate_not_set", bonusAmount: { $not: { $gt: 0 } } })
    .sort({ occurredAt: 1, createdAt: 1, _id: 1 })
    .select("_id creatorId")
    .lean();
  let paid = 0;
  for (const event of waiting) {
    const reward = await reserveConversionBonus(campaign, event, true, now);
    await ConversionEvent.updateOne(
      { _id: event._id, voidedAt: null, bonusAmount: { $not: { $gt: 0 } } },
      { $set: { bonusAmount: reward.bonusAmount, unpaidReason: reward.unpaidReason, availableAt: reward.availableAt } }
    );
    if (!(reward.bonusAmount > 0)) continue;
    paid += 1;
    const key = String(event.creatorId);
    const entry = byCreator.get(key) || { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = roundMoney(entry.amount + reward.bonusAmount);
    byCreator.set(key, entry);
  }
  return { paid, unpaid: waiting.length - paid, byCreator };
}

// A conversion voided in its hold: its bonus credit is voided and the amount goes back to the pool.
// Crash-safe: the credit is voided together with a pending give-back marker, the bonus is returned to
// the pool keyed on the credit's reference, then the marker is cleared. A crash in between leaves the
// marker for repairVoidedBonuses (the ops job), which can't return it twice. Returns the amount.
async function voidConversionBonus(event) {
  const credit = await Transaction.findOneAndUpdate(
    { reference: conversionReference(event._id), type: "bonus_credit", status: "credited" },
    { $set: { status: "voided", bonusGiveBack: "pending" } },
    { new: true }
  ).lean();
  if (!credit) return 0;
  if (voidHooks.afterCreditVoided) await voidHooks.afterCreditVoided(credit);
  await returnVoidedBonus(credit);
  return credit.amount;
}

// ── Creator earnings ────────────────────────────────────────────────────────

const lagosDay = (date) => new Date(new Date(date).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

// A creator's bonus per campaign from rows already loaded: credited bonus rows (campaignId, amount,
// date) and the bonus part of requested or paid withdrawals ([{ campaignId, withdrawn }]).
function bonusEarningsFrom({ credits, withdrawals, now = new Date() }) {
  const byCampaign = new Map();
  const entryFor = (key, campaignId) => {
    if (!byCampaign.has(key)) byCampaign.set(key, { campaignId, earnedKobo: 0, onHoldKobo: 0, availableKobo: 0, withdrawnKobo: 0, unlocks: new Map() });
    return byCampaign.get(key);
  };
  for (const credit of credits) {
    const entry = entryFor(String(credit.campaignId), credit.campaignId);
    const kobo = toKobo(credit.amount);
    const { state, availableAt } = bonusCreditState(credit, now);
    entry.earnedKobo += kobo;
    if (state === "on_hold") {
      entry.onHoldKobo += kobo;
      const day = lagosDay(availableAt);
      const unlock = entry.unlocks.get(day) || { date: availableAt, kobo: 0 };
      if (availableAt > unlock.date) unlock.date = availableAt;
      unlock.kobo += kobo;
      entry.unlocks.set(day, unlock);
    } else entry.availableKobo += kobo;
  }
  for (const group of withdrawals) entryFor(String(group.campaignId), group.campaignId).withdrawnKobo += toKobo(group.withdrawn);

  const result = new Map();
  for (const [key, e] of byCampaign) {
    const unlocks = [...e.unlocks.values()].sort((a, b) => a.date - b.date).map((u) => ({ date: u.date, amount: fromKobo(u.kobo) }));
    result.set(key, {
      campaignId: e.campaignId,
      earned: fromKobo(e.earnedKobo),
      onHold: fromKobo(e.onHoldKobo),
      holdUntil: unlocks.length ? unlocks[0].date : null,
      unlocks,
      available: fromKobo(e.availableKobo),
      withdrawn: fromKobo(e.withdrawnKobo),
      availableToWithdraw: fromKobo(Math.max(e.availableKobo - e.withdrawnKobo, 0)),
    });
  }
  return result;
}

// The same, loaded for one creator (optionally some campaigns only).
async function creatorBonusEarnings(creatorId, { campaignIds = null, now = new Date() } = {}) {
  const creator = toObjectId(creatorId);
  const creditFilter = { creatorId: creator, type: "bonus_credit", status: "credited" };
  const withdrawalMatch = { creatorId: creator, kind: "campaign", bonusAmount: { $gt: 0 }, status: { $in: ["pending", "processing", "released"] } };
  if (campaignIds) {
    const ids = campaignIds.map(toObjectId);
    creditFilter.campaignId = { $in: ids };
    withdrawalMatch.campaignId = { $in: ids };
  }
  const [credits, withdrawals] = await Promise.all([
    Transaction.find(creditFilter).select("campaignId amount date").lean(),
    Withdrawal.aggregate([{ $match: withdrawalMatch }, { $group: { _id: "$campaignId", withdrawn: { $sum: "$bonusAmount" } } }]),
  ]);
  return bonusEarningsFrom({ credits, withdrawals: withdrawals.map((g) => ({ campaignId: g._id, withdrawn: g.withdrawn })), now });
}

// What a payout may release from the bonus pot for one creator on one campaign right now: credits past
// their hold, less bonus releases already committed. Checked at payout time.
async function bonusPayableNow({ creatorId, campaignId, now = new Date() }) {
  const creator = toObjectId(creatorId);
  const campaign = toObjectId(campaignId);
  const [credits, released] = await Promise.all([
    Transaction.find({ creatorId: creator, campaignId: campaign, type: "bonus_credit", status: "credited" }).select("amount date").lean(),
    Transaction.find({ creatorId: creator, campaignId: campaign, type: "release", bucket: "bonus", status: { $in: COMMITTED_RELEASE_STATUSES } }).select("amount").lean(),
  ]);
  const eligible = credits.filter((c) => bonusCreditState(c, now).state === "available").reduce((sum, c) => sum + toKobo(c.amount), 0);
  const committed = released.reduce((sum, r) => sum + toKobo(r.amount), 0);
  return fromKobo(Math.max(eligible - committed, 0));
}

// ── Unused bonus pool refund ────────────────────────────────────────────────

function refundRowView(row) {
  return {
    id: row._id,
    amount: row.amount,
    status: row.status,
    reference: row.reference,
    error: row.adminNotes || null,
    createdAt: row.date || row.createdAt,
  };
}

// A hybrid campaign's bonus figures for admin and brand: funded, promised, paid, left and refundable.
async function bonusBudgetSummary(campaignId, now = new Date()) {
  if (!mongoose.isValidObjectId(campaignId)) return null;
  const campaign = await Campaign.findById(campaignId);
  if (!isHybridCampaign(campaign)) return null;
  const bonus = campaign.hybridBonus;

  const [credits, releases, refundRows] = await Promise.all([
    Transaction.find({ campaignId: campaign._id, type: "bonus_credit", status: "credited" }).select("creatorId amount").lean(),
    Transaction.find({ campaignId: campaign._id, type: "release", bucket: "bonus", status: { $in: COMMITTED_RELEASE_STATUSES } }).select("amount status").lean(),
    Transaction.find({ campaignId: campaign._id, type: "refund", bucket: "bonus" }).sort({ date: 1, createdAt: 1 }).lean(),
  ]);
  const creditedKobo = credits.reduce((sum, c) => sum + toKobo(c.amount), 0);
  const committedKobo = releases.reduce((sum, r) => sum + toKobo(r.amount), 0);
  const refundableFrom = bonusRefundableFrom(campaign);
  const refundAllowed = Boolean(refundableFrom) && refundableFrom <= now;
  const refund = unusedBonusRefund({ unusedPool: bonus.poolRemaining, pool: bonus.pool, platformFee: bonus.platformFee });

  return {
    campaign,
    summary: {
      campaignId: campaign._id,
      status: campaign.status,
      metric: bonus.metric,
      pool: bonus.pool,
      platformFee: bonus.platformFee || 0,
      capPerCreator: bonus.capPerCreator,
      ratePerThousandViews: bonus.metric === "views" ? bonus.ratePerThousandViews || 0 : null,
      rewardPerConversion: bonus.metric !== "views" ? (campaign.referral && campaign.referral.rewardPerConversion) || 0 : null,
      creators: new Set(credits.map((c) => String(c.creatorId))).size,
      reserved: bonus.reserved || 0,
      creditedAmount: fromKobo(creditedKobo),
      paidOut: fromKobo(releases.filter((r) => r.status === "released").reduce((sum, r) => sum + toKobo(r.amount), 0)),
      owedAmount: fromKobo(Math.max(creditedKobo - committedKobo, 0)),
      poolRemaining: bonus.poolRemaining || 0,
      refundedPool: bonus.refundedPool || 0,
      refundAllowed,
      refundableFrom,
      refundable: refundAllowed ? refund : { pool: 0, platformFee: 0, amount: 0 },
      refunds: refundRows.map(refundRowView),
      pendingReservations: (bonus.pending || []).length,
    },
  };
}

// Writes and sends the refund row for every claim that doesn't have one yet (a crash after the claim).
async function sendClaimedRefunds(campaign, note) {
  const claims = (campaign.hybridBonus && campaign.hybridBonus.refundClaims) || [];
  const rows = [];
  for (let i = 0; i < claims.length; i += 1) {
    const reference = refundReference(campaign._id, i + 1);
    if (await Transaction.exists({ reference, type: "refund" })) continue;
    const parts = await buildRefundParts({ campaignId: campaign._id, bucket: "bonus", amount: claims[i].amount });
    let row;
    try {
      row = await Transaction.create({
        campaignId: campaign._id,
        type: "refund",
        bucket: "bonus",
        amount: claims[i].amount,
        status: refundStatusFromParts(parts),
        reference,
        refundParts: parts,
        adminNotes: describeFailures(parts),
        date: new Date(),
      });
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    rows.push(await sendRefundParts(row, note || `Unused bonus pool from hybrid campaign ${campaign._id}`));
  }
  return rows;
}

// Refunds a finished hybrid campaign's unused bonus pool plus the fee on it to the brand's payment.
// Crash-safe order: (1) the unused pool is claimed on the campaign (poolRemaining to 0, a refund claim
// recorded) in one compare-and-set, so no bonus can be reserved from it after; (2) the refund row is
// written under the claim's reference and sent to Paystack. A crash after (1) is finished by the next
// call. A refund Paystack rejects is recorded as failed for a manual refund, as views and referral
// refunds are. Returns { refund, summary }.
async function refundUnusedBonusPool({ campaignId, expectedAmount = null, note = null, now = new Date() }) {
  const loaded = await bonusBudgetSummary(campaignId, now);
  if (!loaded) throw new BonusError(404, "NOT_HYBRID_CAMPAIGN", "Hybrid campaign not found");
  const { campaign, summary } = loaded;

  // Finish a claim an earlier call made but didn't send.
  const unsent = await sendClaimedRefunds(campaign, note);
  if (unsent.length > 0) return { refund: refundRowView(unsent[unsent.length - 1]), summary: (await bonusBudgetSummary(campaignId, now)).summary };

  if (!summary.refundAllowed) {
    const message = summary.refundableFrom
      ? `Sign-ups and downloads still count for 7 days after the campaign completes, so the bonus pool can be refunded from ${summary.refundableFrom.toISOString().slice(0, 10)}`
      : "The unused bonus pool can only be refunded once the campaign is completed or cancelled";
    throw new BonusError(400, "CAMPAIGN_NOT_FINISHED", message, { refundableFrom: summary.refundableFrom });
  }
  if (summary.pendingReservations > 0) await settlePendingBonus(campaign._id);
  const refund = summary.refundable;
  if (!(refund.amount > 0)) throw new BonusError(400, "NOTHING_TO_REFUND", "This campaign has no unused bonus pool to refund");
  if (expectedAmount !== null && toKobo(expectedAmount) !== toKobo(refund.amount)) {
    throw new BonusError(409, "REFUND_CHANGED", "The refundable amount changed. Check the new amount and confirm again.", { summary });
  }

  const bonus = campaign.hybridBonus;
  const claimed = await Campaign.findOneAndUpdate(
    {
      _id: campaign._id,
      status: { $in: ["completed", "cancelled"] },
      "hybridBonus.poolRemaining": bonus.poolRemaining,
      "hybridBonus.refundedPool": bonus.refundedPool,
    },
    {
      $set: { "hybridBonus.poolRemaining": 0, "hybridBonus.refundedPool": fromKobo(toKobo(bonus.refundedPool) + toKobo(refund.pool)) },
      $push: { "hybridBonus.refundClaims": { pool: refund.pool, platformFee: refund.platformFee, amount: refund.amount, at: now } },
    },
    { new: true }
  );
  if (!claimed) throw new BonusError(409, "REFUND_CHANGED", "This campaign's bonus pool changed while the refund was being issued. Refresh and try again.");

  const rows = await sendClaimedRefunds(claimed, note);
  const row = rows[rows.length - 1] || (await Transaction.findOne({ reference: refundReference(campaign._id, claimed.hybridBonus.refundClaims.length), type: "refund" }));
  return { refund: refundRowView(row), summary: (await bonusBudgetSummary(campaignId, now)).summary };
}

module.exports = {
  BONUS_HOLD_MS,
  BONUS_WITHDRAWABLE_CAMPAIGN_STATUSES,
  BonusError,
  isHybridCampaign,
  isConversionBonus,
  conversionReference,
  settlePendingBonus,
  reserveBonus,
  accrueViewsBonus,
  accrueAllViewsBonuses,
  viewsBonusSubmissionFilter,
  reserveConversionBonus,
  payUnpaidConversionBonuses,
  voidConversionBonus,
  repairVoidedBonuses,
  voidHooks,
  bonusEarningsFrom,
  creatorBonusEarnings,
  bonusPayableNow,
  bonusBudgetSummary,
  refundUnusedBonusPool,
};
