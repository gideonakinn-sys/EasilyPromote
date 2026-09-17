const Withdrawal = require("../models/Withdrawal");
const Transaction = require("../models/Transaction");
const Submission = require("../models/Submission");
const CreatorProfile = require("../models/CreatorProfile");
const Notification = require("../models/Notification");
const paystack = require("./paystack");
const { recordAdminActivity } = require("./adminActivity");
const { campaignEscrowBalance } = require("../utils/escrow");
const { settleRelease, revertRelease } = require("../utils/payouts");
const { fixedPayableNow } = require("../utils/fixedPay");
const { bonusPayableNow } = require("../utils/hybridBonus");
const { roundMoney } = require("../utils/money");

// Paystack transfer states that mean the money is still moving.
const IN_FLIGHT = ["pending", "processing", "otp", "receipt"];

function reply(status, body) {
  return { status, body };
}

// Paystack's NGN transfer fee tiers, used when a transfer response doesn't state its fee.
function estimateTransferFee(amount) {
  if (amount <= 5000) return 10;
  if (amount <= 50000) return 25;
  return 50;
}

// What a withdrawal pays, per pot. Weekly campaign withdrawals carry views, referral, fixed pay and
// hybrid bonus together; older withdrawals are views or referral only.
function withdrawalParts(withdrawal) {
  if (withdrawal.kind === "campaign") {
    return [
      { bucket: "views", amount: roundMoney(withdrawal.viewsAmount) },
      { bucket: "referral", amount: roundMoney(withdrawal.referralAmount) },
      { bucket: "fixed", amount: roundMoney(withdrawal.fixedAmount) },
      { bucket: "bonus", amount: roundMoney(withdrawal.bonusAmount) },
    ].filter((part) => part.amount > 0);
  }
  return [{ bucket: withdrawal.kind === "referral" ? "referral" : "views", amount: roundMoney(withdrawal.amount) }];
}

// Every release row of one Paystack transfer. Older single-pot payouts used the transfer
// reference as the row's own reference.
function releasesForTransfer(reference) {
  if (!reference) return Promise.resolve([]);
  return Transaction.find({ type: "release", $or: [{ reference }, { transferReference: reference }] });
}

async function settleTransfer(reference) {
  let settled = false;
  for (const release of await releasesForTransfer(reference)) {
    if (await settleRelease(release)) settled = true;
  }
  return settled;
}

async function revertTransfer(reference, reason) {
  let reverted = false;
  for (const release of await releasesForTransfer(reference)) {
    // Noted once on the withdrawal, not once per pot.
    if (await revertRelease(release, reverted ? null : reason)) reverted = true;
  }
  if (reference) {
    await Transaction.updateMany({ type: "transfer_fee", transferReference: reference }, { $set: { status: "failed" } });
  }
  return reverted;
}

// Pays one withdrawal: claims it, checks each pot's escrow and the Paystack balance,
// reserves escrow with a release row per pot, then sends one transfer.
async function payWithdrawal({ withdrawalId, note = null, req = null, skipBalanceCheck = false }) {
  // Atomically take the withdrawal out of the queue, so a double click or two admins
  // reviewing at once can't both pay it.
  let withdrawal;
  try {
    withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: withdrawalId, status: "pending" },
      { $set: { status: "processing", reviewedAt: new Date() } },
      { new: true }
    )
      .populate("campaignId")
      .populate("submissionId");
  } catch (err) {
    if (err.code === 11000) {
      return reply(409, { error: "Another payout for this creator on this campaign is already being processed" });
    }
    throw err;
  }
  if (!withdrawal) {
    const exists = await Withdrawal.exists({ _id: withdrawalId });
    return exists
      ? reply(409, { error: "This withdrawal has already been reviewed" })
      : reply(404, { error: "Withdrawal not found" });
  }

  // Puts the withdrawal back in the queue when approval stops before any money moves.
  const backToPending = () =>
    Withdrawal.updateOne({ _id: withdrawal._id, status: "processing" }, { $set: { status: "pending" } });

  const campaign = withdrawal.campaignId;
  if (!campaign) {
    await backToPending();
    return reply(400, { error: "Campaign not found" });
  }

  // An earlier attempt that isn't marked failed may still be moving money. Resolve it
  // against Paystack before anything new is sent.
  if (withdrawal.reference) {
    const unresolved = (await releasesForTransfer(withdrawal.reference)).filter((release) => release.status !== "failed");
    if (unresolved.length > 0) {
      let prior = null;
      try {
        prior = await paystack.fetchTransfer(withdrawal.reference);
      } catch (err) {
        if (err.status !== 404) {
          await backToPending();
          return reply(409, {
            error: `Couldn't confirm the previous payout attempt with Paystack (${err.message}). Try again shortly.`,
          });
        }
      }
      const priorStatus = prior && prior.status;
      if (priorStatus === "success") {
        await settleTransfer(withdrawal.reference);
        return reply(409, { error: "The previous payout attempt already went through, so nothing more was sent" });
      }
      if (IN_FLIGHT.includes(priorStatus)) {
        return reply(409, { error: "The previous payout attempt is still in progress at Paystack" });
      }
      await revertTransfer(withdrawal.reference, `Previous attempt cleared: Paystack reports ${priorStatus || "no transfer"}`);
      return reply(409, { error: "The previous payout attempt didn't go through and has been cleared. Approve again to retry." });
    }
  }

  let parts = withdrawalParts(withdrawal);

  // Fixed pay and hybrid bonus are checked again at payout: only fixed credits whose content is
  // delivered and whose 7-day hold is over, and bonus credits past their hold, can be released,
  // whatever was eligible when the withdrawal was requested.
  let capNote = null;
  const rechecks = [
    { bucket: "fixed", field: "fixedAmount", payableNow: fixedPayableNow, label: "Fixed pay", why: "the rest isn't delivered or past its hold yet", code: "FIXED_PAY_NOT_ELIGIBLE" },
    { bucket: "bonus", field: "bonusAmount", payableNow: bonusPayableNow, label: "Bonus", why: "the rest isn't past its hold yet", code: "BONUS_NOT_ELIGIBLE" },
  ];
  for (const check of rechecks) {
    const part = parts.find((p) => p.bucket === check.bucket);
    if (!part) continue;
    const payable = await check.payableNow({ creatorId: withdrawal.creatorId, campaignId: campaign._id });
    if (part.amount <= payable) continue;
    const amount = roundMoney(withdrawal.amount - part.amount + payable);
    const note = `${check.label} capped at payout from ₦${part.amount.toLocaleString()} to ₦${payable.toLocaleString()}: ${check.why}`;
    capNote = [capNote, note].filter(Boolean).join(" | ");
    if (!(amount > 0)) {
      await backToPending();
      return reply(400, { error: `Nothing in this withdrawal can be paid yet. ${note}.`, code: check.code });
    }
    await Withdrawal.updateOne(
      { _id: withdrawal._id },
      { $set: { [check.field]: payable, amount, adminNotes: [withdrawal.adminNotes, note].filter(Boolean).join(" | ") } }
    );
    withdrawal[check.field] = payable;
    withdrawal.amount = amount;
    withdrawal.adminNotes = [withdrawal.adminNotes, note].filter(Boolean).join(" | ");
    parts = withdrawalParts(withdrawal);
  }

  if (parts.length === 0) {
    await backToPending();
    return reply(400, { error: "This withdrawal has nothing to pay" });
  }

  // Each part is paid from its own pot. Cancelled campaigns stay payable: their refund
  // leaves what creators are owed in escrow.
  for (const part of parts) {
    const available = await campaignEscrowBalance(campaign._id, part.bucket);
    if (part.amount > available) {
      await backToPending();
      return reply(400, {
        error: `Insufficient funds in this campaign's ${part.bucket === "referral" ? "referral budget" : part.bucket === "fixed" ? "fixed pay owed" : part.bucket === "bonus" ? "bonus owed" : "escrow"}. Available: ₦${Math.max(available, 0).toLocaleString()}`,
      });
    }
  }

  // Our ledger says the campaign is covered; the Paystack balance is what actually funds
  // the transfer. A payout run checks the balance once for the whole batch instead.
  let paystackBalance = null;
  if (!skipBalanceCheck) {
    try {
      paystackBalance = await paystack.fetchBalance("NGN");
    } catch (err) {
      console.error("[Payouts] Balance lookup failed:", err.message);
    }
    if (paystackBalance !== null && withdrawal.amount > paystackBalance) {
      await backToPending();
      return reply(400, {
        error:
          `Your Paystack balance is ₦${paystackBalance.toLocaleString()}, which does not cover this ` +
          `₦${withdrawal.amount.toLocaleString()} payout. Fund the Paystack balance, or switch settlement ` +
          `to manual so collections stay there, then approve again.`,
        code: "INSUFFICIENT_PAYSTACK_BALANCE",
        paystackBalance,
      });
    }
  }

  const profile = await CreatorProfile.findOne({ userId: withdrawal.creatorId });
  if (!profile || !(profile.payoutAccount && profile.payoutAccount.paystackRecipientCode)) {
    await backToPending();
    return reply(400, { error: "Creator has no bank account on file" });
  }
  const recipient = profile.payoutAccount.paystackRecipientCode;

  // Each attempt gets its own reference: Paystack rejects a reused one, and a failed
  // attempt keeps its ledger rows as history. It's saved before any transfer is sent.
  const attempt = (withdrawal.payoutAttempts || 0) + 1;
  const reference = `wd_${withdrawal._id}_${attempt}`;
  await Withdrawal.updateOne({ _id: withdrawal._id }, { $set: { reference, payoutAttempts: attempt } });

  // Reserve escrow before calling Paystack, so a crash after the transfer is sent still
  // leaves rows the reconcile job can settle.
  const submission = withdrawal.submissionId;
  const created = [];
  try {
    for (const part of parts) {
      created.push(
        await Transaction.create({
          campaignId: campaign._id,
          bucket: part.bucket,
          creatorId: withdrawal.creatorId,
          submissionId: part.bucket === "views" && submission ? submission._id : null,
          creatorHandle: submission ? submission.creatorHandle : undefined,
          type: "release",
          amount: part.amount,
          reference: parts.length === 1 ? reference : `${reference}_${part.bucket}`,
          transferReference: reference,
          status: "escrow_deposit",
          date: new Date(),
        })
      );
    }
  } catch (err) {
    await Transaction.updateMany({ _id: { $in: created.map((row) => row._id) } }, { $set: { status: "failed" } });
    await backToPending();
    throw err;
  }

  if (submission && parts.some((part) => part.bucket === "views")) {
    await Submission.updateOne({ _id: submission._id }, { payoutStatus: "escrow_deposit" });
  }

  let transfer = null;
  try {
    transfer = await paystack.initiateTransfer({
      amount: withdrawal.amount,
      recipient,
      reference,
      reason: `Creator payout for ${campaign.name || "campaign"}`,
    });
  } catch (err) {
    console.error("[Payouts] Transfer failed:", err.message);
    // A 4xx is Paystack refusing the transfer: nothing moved, so free the escrow and
    // requeue. A timeout or 5xx may still have gone through, so it stays processing
    // until the reconcile job confirms it with Paystack.
    if (err.status >= 400 && err.status < 500) {
      await revertTransfer(reference, `Paystack rejected the transfer: ${err.message}`);
      return reply(502, { error: `Paystack rejected this payout: ${err.message}`, paystackBalance });
    }
    return reply(502, {
      error: `Paystack didn't confirm this payout (${err.message}). It stays in processing and will be checked against Paystack automatically, so don't send it again.`,
      paystackBalance,
    });
  }

  const transferStatus = transfer && transfer.status;
  if (transferStatus === "otp") {
    console.error("[Payouts] Transfer requires OTP; aborting", reference);
    await revertTransfer(reference, "Paystack required OTP, so the transfer was not sent");
    return reply(502, {
      error:
        "Paystack is requiring OTP confirmation for transfers, so this payout did not go through. Disable OTP for transfers in your Paystack dashboard (Settings → Preferences), then approve again.",
    });
  }
  if (!["success", "pending"].includes(transferStatus)) {
    console.error("[Payouts] Unexpected transfer status:", transferStatus, reference);
    await revertTransfer(reference, `Paystack returned transfer status ${transferStatus || "unknown"}`);
    return reply(502, {
      error: `Paystack did not accept this payout (status: ${transferStatus || "unknown"}). No funds were moved.`,
    });
  }

  // Paystack's fee is covered by the platform fee and kept against the campaign for its books.
  const statedFee = Number(transfer.fee_charged !== undefined ? transfer.fee_charged : transfer.fee);
  const feeStated = Number.isFinite(statedFee) && statedFee > 0;
  try {
    await Transaction.create({
      campaignId: campaign._id,
      creatorId: withdrawal.creatorId,
      type: "transfer_fee",
      amount: feeStated ? roundMoney(statedFee / 100) : estimateTransferFee(withdrawal.amount),
      status: "released",
      reference: `${reference}_fee`,
      transferReference: reference,
      adminNotes: feeStated ? null : "Estimated from Paystack's NGN transfer fee tiers",
      date: new Date(),
    });
  } catch (err) {
    if (err.code !== 11000) console.error("[Payouts] Could not record transfer fee:", err.message);
  }

  await Withdrawal.updateOne(
    { _id: withdrawal._id },
    { $set: { adminNotes: [note, capNote].filter(Boolean).join(" | ") || withdrawal.adminNotes || null } }
  );

  // Test mode settles instantly; live transfers come back "pending" and are finalised by
  // the transfer.success webhook. Settling is idempotent.
  if (transferStatus === "success") {
    await settleTransfer(reference);
  }

  const settled = await Withdrawal.findById(withdrawal._id);
  const paid = settled.status === "released";

  await Notification.create({
    creatorId: withdrawal.creatorId,
    campaignId: campaign._id,
    type: "payout",
    title: paid ? "Payout sent" : "Payout on the way",
    body: paid
      ? `₦${withdrawal.amount.toLocaleString()} has been sent to your bank account for "${campaign.name || "campaign"}".`
      : `A payout of ₦${withdrawal.amount.toLocaleString()} is being sent to your bank account for "${campaign.name || "campaign"}".`,
  });
  await Notification.create({
    businessId: withdrawal.businessId,
    campaignId: campaign._id,
    type: "payout",
    title: paid ? "Payout released" : "Payout on the way",
    body: paid
      ? `Creators have been paid ₦${withdrawal.amount.toLocaleString()} for this campaign.`
      : `A payout of ₦${withdrawal.amount.toLocaleString()} is being sent to the creator.`,
  });

  if (req) {
    await recordAdminActivity(req, {
      action: "withdrawal.approved",
      targetType: "withdrawal",
      targetId: withdrawal._id,
      targetLabel: `₦${withdrawal.amount.toLocaleString()} · ${campaign.name || "campaign"}`,
      businessId: withdrawal.businessId,
      note,
      metadata: { amount: withdrawal.amount, parts, reference, status: settled.status, creatorId: withdrawal.creatorId },
    });
  }

  return reply(200, { success: true, withdrawal: settled, transfer });
}

async function rejectWithdrawal({ withdrawalId, note = null, req = null }) {
  const withdrawal = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: "pending" },
    { $set: { status: "rejected", adminNotes: note || null, reviewedAt: new Date() } },
    { new: true }
  ).populate("campaignId");
  if (!withdrawal) {
    const exists = await Withdrawal.exists({ _id: withdrawalId });
    return exists
      ? reply(409, { error: "This withdrawal has already been reviewed" })
      : reply(404, { error: "Withdrawal not found" });
  }

  const campaignName = withdrawal.campaignId && withdrawal.campaignId.name;
  await Notification.create({
    creatorId: withdrawal.creatorId,
    campaignId: withdrawal.campaignId ? withdrawal.campaignId._id : null,
    type: "payout_rejected",
    title: "Withdrawal rejected",
    body: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} on "${campaignName || "Campaign"}" was rejected.${note ? ` Reason: ${note}` : ""}`,
  });

  if (req) {
    await recordAdminActivity(req, {
      action: "withdrawal.rejected",
      targetType: "withdrawal",
      targetId: withdrawal._id,
      targetLabel: `₦${withdrawal.amount.toLocaleString()} · ${campaignName || "campaign"}`,
      businessId: withdrawal.businessId,
      note,
      metadata: { amount: withdrawal.amount, creatorId: withdrawal.creatorId },
    });
  }
  return reply(200, { success: true, withdrawal });
}

module.exports = {
  estimateTransferFee,
  withdrawalParts,
  releasesForTransfer,
  settleTransfer,
  revertTransfer,
  payWithdrawal,
  rejectWithdrawal,
};
