const crypto = require("crypto");
const Paystack = require("paystack")(process.env.PAYSTACK_SECRET_KEY);

const PAYSTACK_BASE = "https://api.paystack.co";

async function paystackRequest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { message: "Empty response from Paystack" };
  }
  if (!res.ok || !data.status) {
    const err = new Error(data.message || `Paystack error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.data;
}

async function initializeTransaction({ email, amount, reference, metadata, callback_url }) {
  const result = await Paystack.transaction.initialize({
    email,
    amount: Math.round(amount * 100),
    reference,
    metadata: metadata || {},
    callback_url: callback_url || process.env.PAYSTACK_CALLBACK_URL,
  });
  return result.data;
}

async function verifyTransaction(reference) {
  const result = await Paystack.transaction.verify(reference);
  return result.data;
}

async function createRecipient({ name, type, account_number, bank_code }) {
  return paystackRequest("/transferrecipient", {
    method: "POST",
    body: {
      type: type || "nuban",
      name,
      account_number,
      bank_code,
    },
  });
}

async function listBanks({ perPage = 100 } = {}) {
  const all = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 10) {
    const result = await Paystack.misc.list_banks({ perPage, page });
    const items = result.data || [];
    all.push(...items);
    if (result.meta && page >= result.meta.page_count) hasMore = false;
    else if (items.length < perPage) hasMore = false;
    page += 1;
  }
  return all;
}

async function resolveAccountNumber({ account_number, bank_code }) {
  return paystackRequest("/bank/resolve", {
    method: "POST",
    body: { account_number: String(account_number), bank_code: String(bank_code) },
  });
}

// Transfers are paid out of the Paystack balance, not your settlement bank
// account. If settlements sweep automatically, this can be empty while the
// campaign still shows escrow in our own ledger.
async function fetchBalance(currency = "NGN") {
  const balances = await paystackRequest("/balance");
  const entry = (balances || []).find(
    (b) => String(b.currency).toUpperCase() === String(currency).toUpperCase()
  );
  // Paystack reports balances in the minor unit.
  return entry ? (entry.balance || 0) / 100 : 0;
}

async function initiateTransfer({ source, amount, recipient, reference, reason }) {
  return paystackRequest("/transfer", {
    method: "POST",
    body: {
      source: source || "balance",
      amount: Math.round(amount * 100),
      recipient,
      reference,
      reason: reason || "Creator payout",
    },
  });
}

// Paystack signs the raw request body with your secret key — there is no
// separate webhook secret. Re-serialising the parsed JSON would change the
// bytes and break every signature, so this must receive the raw buffer.
function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return false;

  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const expected = Buffer.from(hash, "utf8");
  const received = Buffer.from(String(signature), "utf8");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = {
  fetchBalance,
  initializeTransaction,
  verifyTransaction,
  createRecipient,
  listBanks,
  resolveAccountNumber,
  initiateTransfer,
  verifyWebhookSignature,
};
