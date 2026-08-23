const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const paystack = require("../services/paystack");
const { settleRelease, revertRelease } = require("./payouts");

const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

// Give the webhook a fair chance before going and asking Paystack ourselves.
const STALE_AFTER_MS = 20 * 60 * 1000;

// Paystack transfer states that mean the money is still moving.
const IN_FLIGHT = ["pending", "processing", "otp", "receipt"];

// A payout is only finished when transfer.success arrives. If that webhook is
// missed — the endpoint was unreachable, the instance was asleep, Paystack gave
// up retrying — the withdrawal sits in "processing" forever: the creator is
// never credited and the reserved escrow never frees up, which blocks every
// later payout on that campaign. This asks Paystack directly.
async function reconcilePayouts() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stuck = await Withdrawal.find({
    status: "processing",
    updatedAt: { $lt: cutoff },
  });

  const summary = { checked: stuck.length, settled: 0, failed: 0, stillPending: 0, unknown: 0 };
  if (stuck.length === 0) return summary;

  for (const withdrawal of stuck) {
    if (!withdrawal.reference) {
      summary.unknown += 1;
      console.warn("[Reconcile] Withdrawal", String(withdrawal._id), "is processing with no reference");
      continue;
    }

    let transfer;
    try {
      transfer = await paystack.fetchTransfer(withdrawal.reference);
    } catch (err) {
      // An unrecognised reference means no transfer was ever created, so the
      // money never left. Anything else is a lookup problem — leave it alone.
      console.error("[Reconcile] Lookup failed for", withdrawal.reference, err.message);
      summary.unknown += 1;
      continue;
    }

    const status = transfer && transfer.status;
    const transaction = await Transaction.findOne({
      type: "release",
      reference: withdrawal.reference,
    });

    if (status === "success") {
      if (await settleRelease(transaction)) summary.settled += 1;
      console.log("[Reconcile] Settled", withdrawal.reference, "— webhook never arrived");
    } else if (["failed", "reversed", "abandoned"].includes(status)) {
      if (await revertRelease(transaction, `Reconciled: Paystack reports transfer ${status}`)) {
        summary.failed += 1;
      }
      console.log("[Reconcile] Reverted", withdrawal.reference, "— Paystack reports", status);
    } else if (IN_FLIGHT.includes(status)) {
      summary.stillPending += 1;
    } else {
      summary.unknown += 1;
      console.warn("[Reconcile] Unrecognised transfer status", status, "for", withdrawal.reference);
    }
  }

  console.log(
    `[Reconcile] checked=${summary.checked} settled=${summary.settled} reverted=${summary.failed} ` +
      `stillPending=${summary.stillPending} unknown=${summary.unknown}`
  );
  return summary;
}

async function runReconcile() {
  try {
    return await reconcilePayouts();
  } catch (err) {
    console.error("[Reconcile] Run failed:", err.message);
    return null;
  }
}

function startPayoutReconciliation() {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.log("[Reconcile] Skipped — PAYSTACK_SECRET_KEY not set");
    return;
  }
  runReconcile();
  setInterval(runReconcile, RECONCILE_INTERVAL_MS);
}

module.exports = { startPayoutReconciliation, reconcilePayouts, runReconcile };
