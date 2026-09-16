// End-to-end test harness: a throwaway MongoDB, the real Express app, and a Paystack stub.
// It never reads Backend/.env and clears outside-service keys, so tests can't reach the real
// database, Paystack, email, file storage or social APIs.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SRC = path.join(__dirname, "..", "..", "src");

// Credentials for real outside services, cleared so a developer's shell can't make a test
// send email, upload files or call social APIs.
const OUTSIDE_SERVICE_ENV = [
  "BREVO_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "PAYSTACK_CALLBACK_URL",
];

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

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function startMongod() {
  const port = await freePort();
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), "ep-e2e-"));
  const proc = spawn(mongodBinary(), ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], {
    stdio: "ignore",
  });

  let exited = false;
  let exitReason = null;
  const exitedPromise = new Promise((resolve) => {
    proc.on("exit", (code, signal) => {
      exited = true;
      exitReason = signal || code;
      resolve();
    });
    proc.on("error", (error) => {
      exited = true;
      exitReason = error.message;
      resolve();
    });
  });

  async function stop() {
    if (!exited) proc.kill();
    await exitedPromise;
    fs.rmSync(dbPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const deadline = Date.now() + 20000;
  while (!(await canConnect(port))) {
    if (exited) {
      await stop();
      throw new Error(`mongod exited before starting (${exitReason}). Set MONGOD_PATH if it isn't on PATH.`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error("mongod didn't accept connections within 20 seconds");
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return { uri: `mongodb://127.0.0.1:${port}/ep_e2e`, stop };
}

// Replaces services/paystack in the require cache before the app loads it.
function stubPaystack() {
  const checkouts = new Map();
  const checkoutMetadata = new Map();
  const paid = new Map();
  const stub = {
    async initializeTransaction({ amount, reference, metadata }) {
      checkouts.set(reference, amount);
      checkoutMetadata.set(reference, metadata);
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
    // Naira amount the checkout for this reference asked Paystack to charge.
    charged: (reference) => checkouts.get(reference),
    // Metadata the checkout for this reference sent to Paystack.
    metadata: (reference) => checkoutMetadata.get(reference),
    // Makes Paystack report the checkout as paid; defaults to the amount it was opened for.
    markPaid(reference, { amount, currency = "NGN" } = {}) {
      paid.set(reference, { amount: amount !== undefined ? amount : checkouts.get(reference), currency });
    },
  };
}

async function startHarness() {
  const mongod = await startMongod();
  const mongoose = require("mongoose");
  let server;
  let paystack;

  try {
    for (const name of OUTSIDE_SERVICE_ENV) delete process.env[name];
    process.env.NODE_ENV = "test";
    process.env.MONGODB_URI = mongod.uri;
    process.env.JWT_SECRET = "e2e-jwt-secret";
    process.env.JWT_REFRESH_SECRET = "e2e-jwt-refresh-secret";
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    process.env.PAYSTACK_SECRET_KEY = "sk_test_e2e";

    paystack = stubPaystack();
    await mongoose.connect(mongod.uri);

    const app = require(path.join(SRC, "app"));
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
  } catch (error) {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await mongod.stop();
    throw error;
  }

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

  async function register(fields) {
    const res = await api("POST", "/api/auth/register", { body: { password: "password123", ...fields } });
    if (res.status !== 201) throw new Error(`Registering a ${fields.role} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.user.id, token: res.body.token };
  }

  async function registerBrand() {
    const email = `${unique("brand")}@e2e.test`;
    const { id, token } = await register({ email, role: "business", businessName: "Test Brand" });
    return { id, email, token };
  }

  // Admins can't sign up through the API, so the account is written directly, then logs in.
  async function registerAdmin({ role = "admin" } = {}) {
    const User = require(path.join(SRC, "models", "User"));
    const email = `${unique("admin")}@e2e.test`;
    const user = await User.create({ name: "Test Admin", email, password: "password123", role, emailVerified: true });
    const res = await api("POST", "/api/auth/login", { body: { email, password: "password123" } });
    if (res.status !== 200) throw new Error(`Admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: String(user._id), email, token: res.body.token };
  }

  // A creator who can take placements: a connected TikTok account and chosen niches.
  // The TikTok connection is written directly because the real one needs TikTok's OAuth.
  async function registerCreator({ niches = ["Music"], connected = true } = {}) {
    const username = unique("creator");
    const email = `${username}@e2e.test`;
    const { id, token } = await register({ email, role: "creator", firstName: "Test", lastName: "Creator", username });

    if (connected) {
      const TikTokConnection = require(path.join(SRC, "models", "TikTokConnection"));
      await TikTokConnection.create({
        userId: id,
        openId: unique("open"),
        username,
        accessTokenEnc: "e2e",
        refreshTokenEnc: "e2e",
      });
    }

    const nicheRes = await api("POST", "/api/creators/profile/niches", { token, body: { niches } });
    if (nicheRes.status !== 200) throw new Error(`Setting niches failed: ${nicheRes.status} ${JSON.stringify(nicheRes.body)}`);

    return { id, email, username, token };
  }

  return {
    api,
    paystack,
    registerAdmin,
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
