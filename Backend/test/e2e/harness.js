// End-to-end test harness: a throwaway MongoDB, the real Express app, and a Paystack stub.
// It never reads Backend/.env, so tests can't reach the real database or Paystack.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SRC = path.join(__dirname, "..", "..", "src");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function mongodBinary() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  if (process.platform === "win32") {
    const root = "C:\\Program Files\\MongoDB\\Server";
    if (fs.existsSync(root)) {
      const versions = fs.readdirSync(root).sort().reverse();
      for (const v of versions) {
        const bin = path.join(root, v, "bin", "mongod.exe");
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  return "mongod";
}

async function startMongod() {
  const port = await freePort();
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "ep-e2e-"));
  const proc = spawn(mongodBinary(), ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], {
    stdio: "ignore",
  });
  let exited = null;
  proc.on("exit", (code) => {
    exited = code;
  });
  proc.on("error", (error) => {
    exited = error;
  });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`mongod exited before starting (${exited}). Set MONGOD_PATH if it isn't on PATH.`);
    const up = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    uri: `mongodb://127.0.0.1:${port}/ep_e2e`,
    async stop() {
      if (exited === null) {
        await new Promise((resolve) => {
          proc.once("exit", resolve);
          proc.kill();
        });
      }
      fs.rmSync(dbPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

// Replaces services/paystack in the require cache before the app loads it.
function stubPaystack() {
  const checkouts = new Map();
  const paid = new Map();
  const stub = {
    async initializeTransaction({ amount, reference }) {
      checkouts.set(reference, amount);
      return { authorization_url: `https://checkout.paystack.test/${reference}`, access_code: `ac_${reference}`, reference };
    },
    async verifyTransaction(reference) {
      const payment = paid.get(reference);
      if (!payment) return { status: "abandoned", amount: 0, currency: "NGN", reference };
      return { status: "success", amount: Math.round(payment.amount * 100), currency: payment.currency, reference };
    },
    async createRecipient() {
      return { recipient_code: `RCP_${crypto.randomBytes(4).toString("hex")}` };
    },
    async listBanks() {
      return [];
    },
    async resolveAccountNumber({ account_number }) {
      return { account_number, account_name: "Test Account" };
    },
    async fetchBalance() {
      return [{ currency: "NGN", balance: 1e12 }];
    },
    async fetchTransfer(reference) {
      return { reference, status: "success" };
    },
    async initiateTransfer({ reference, amount }) {
      return { reference, amount, status: "success", transfer_code: `TRF_${reference}` };
    },
    async createRefund({ transaction, amount }) {
      return { transaction, amount, status: "pending" };
    },
    verifyWebhookSignature() {
      return true;
    },
  };

  const modulePath = require.resolve(path.join(SRC, "services", "paystack"));
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: stub };

  return {
    // Naira amount the last checkout for this reference asked Paystack to charge.
    charged: (reference) => checkouts.get(reference),
    // Makes Paystack report the checkout as paid; defaults to the amount it was opened for.
    markPaid(reference, { amount, currency = "NGN" } = {}) {
      paid.set(reference, { amount: amount !== undefined ? amount : checkouts.get(reference), currency });
    },
  };
}

async function startHarness() {
  const mongod = await startMongod();

  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = mongod.uri;
  process.env.JWT_SECRET = "e2e-jwt-secret";
  process.env.JWT_REFRESH_SECRET = "e2e-jwt-refresh-secret";
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  process.env.PAYSTACK_SECRET_KEY = "sk_test_e2e";
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_HOST;

  const paystack = stubPaystack();

  const mongoose = require("mongoose");
  await mongoose.connect(mongod.uri);

  const app = require(path.join(SRC, "app"));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function api(method, urlPath, { token, body } = {}) {
    const res = await fetch(baseUrl + urlPath, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  }

  let counter = 0;
  const unique = (prefix) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

  async function registerBrand({ companyName = "Test Brand" } = {}) {
    const email = `${unique("brand")}@e2e.test`;
    const res = await api("POST", "/api/auth/register", {
      body: { email, password: "password123", role: "business", businessName: companyName },
    });
    if (res.status !== 201) throw new Error(`Brand registration failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.user.id, email, token: res.body.token };
  }

  // A creator who can take placements: a connected TikTok account and chosen niches.
  // The TikTok connection is written directly because the real one needs TikTok's OAuth.
  async function registerCreator({ niches = ["Music"] } = {}) {
    const username = unique("creator");
    const email = `${username}@e2e.test`;
    const res = await api("POST", "/api/auth/register", {
      body: { email, password: "password123", role: "creator", firstName: "Test", lastName: "Creator", username },
    });
    if (res.status !== 201) throw new Error(`Creator registration failed: ${res.status} ${JSON.stringify(res.body)}`);
    const token = res.body.token;

    const TikTokConnection = require(path.join(SRC, "models", "TikTokConnection"));
    await TikTokConnection.create({
      userId: res.body.user.id,
      openId: unique("open"),
      username,
      accessTokenEnc: "e2e",
      refreshTokenEnc: "e2e",
    });

    const nicheRes = await api("POST", "/api/creators/profile/niches", { token, body: { niches } });
    if (nicheRes.status !== 200) throw new Error(`Setting niches failed: ${nicheRes.status} ${JSON.stringify(nicheRes.body)}`);

    return { id: res.body.user.id, email, username, token };
  }

  return {
    api,
    paystack,
    registerBrand,
    registerCreator,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}

module.exports = { startHarness };
