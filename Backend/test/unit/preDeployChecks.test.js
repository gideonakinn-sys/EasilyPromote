const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkEnvironment, summarizeChecks, ENV_SPEC } = require("../../scripts/preDeployChecks");

const complete = {
  MONGODB_URI: "mongodb+srv://user:secret@cluster.example.net/app",
  JWT_SECRET: "a-long-access-secret",
  JWT_REFRESH_SECRET: "a-different-refresh-secret",
  PAYSTACK_SECRET_KEY: "sk_live_abc123",
  BREVO_API_KEY: "xkeysib-123",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef",
  CLIENT_URL: "https://app.easilypromote.com",
  OPS_ALERT_EMAIL: "ops@easilypromote.com",
  PAYSTACK_CALLBACK_URL: "https://app.easilypromote.com/paid",
};

test("a complete production environment has no problems and never echoes a value", () => {
  const result = checkEnvironment(complete);
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.warnings, []);
  const printed = JSON.stringify(result);
  for (const value of Object.values(complete)) assert.ok(!printed.includes(value), "no value is printed");
  assert.ok(result.present.includes("MONGODB_URI"));
});

test("missing or blank required variables block; missing optional ones warn", () => {
  const env = { ...complete, BREVO_API_KEY: "   ", OPS_ALERT_EMAIL: "" };
  delete env.JWT_REFRESH_SECRET;
  const result = checkEnvironment(env);
  assert.deepEqual(result.blocking.map((p) => p.name).sort(), ["BREVO_API_KEY", "JWT_REFRESH_SECRET"]);
  assert.deepEqual(result.warnings.map((p) => p.name), ["OPS_ALERT_EMAIL"]);
});

test("the older TikTok key still satisfies the token encryption key", () => {
  const env = { ...complete, TIKTOK_TOKEN_KEY: "legacy" };
  delete env.TOKEN_ENCRYPTION_KEY;
  const result = checkEnvironment(env);
  assert.deepEqual(result.blocking, []);
  assert.ok(result.warnings.some((p) => p.name === "TOKEN_ENCRYPTION_KEY"), "asks to move to the new name");
});

test("a test Paystack key or a shared JWT secret block a production deploy", () => {
  const result = checkEnvironment({ ...complete, PAYSTACK_SECRET_KEY: "sk_test_1", JWT_REFRESH_SECRET: complete.JWT_SECRET });
  assert.deepEqual(result.blocking.map((p) => p.name).sort(), ["JWT_REFRESH_SECRET", "PAYSTACK_SECRET_KEY"]);
  assert.ok(!JSON.stringify(result).includes("sk_test_1"));
  // Allowed when checking a staging environment.
  assert.deepEqual(checkEnvironment({ ...complete, PAYSTACK_SECRET_KEY: "sk_test_1" }, { staging: true }).blocking, []);
});

test("every required variable in the spec is documented with a reason", () => {
  for (const entry of ENV_SPEC) {
    assert.ok(entry.name && entry.why, JSON.stringify(entry));
    assert.ok(["required", "optional"].includes(entry.level));
  }
});

test("the summary blocks on env problems, index conflicts and unbalanced campaigns, not on pending migrations", () => {
  const clean = summarizeChecks({
    environment: checkEnvironment(complete),
    migration: { toMigrate: 12, byObjective: { views: 10, signups: 2 } },
    conflicts: [{ label: "transactions {reference, type}", rows: [] }],
    reconciliation: { checked: 40, failing: [] },
  });
  assert.equal(clean.exitCode, 0);
  assert.deepEqual(clean.blocking, []);
  assert.ok(clean.warnings.some((w) => /12 campaigns need the Campaign v2 migration/.test(w)));

  const broken = summarizeChecks({
    environment: checkEnvironment({ ...complete, PAYSTACK_SECRET_KEY: "" }),
    migration: { toMigrate: 0, byObjective: {} },
    conflicts: [{ label: "slots {campaignId, creatorId} with a creator", rows: [{ count: 2 }] }],
    reconciliation: { checked: 40, failing: [{ campaignId: "c1", name: "Launch", status: "live", problems: ["views: fee off"] }] },
  });
  assert.equal(broken.exitCode, 1);
  assert.equal(broken.blocking.length, 3);
  assert.ok(broken.blocking.some((b) => /PAYSTACK_SECRET_KEY/.test(b)));
  assert.ok(broken.blocking.some((b) => /slots \{campaignId, creatorId\}/.test(b)));
  assert.ok(broken.blocking.some((b) => /1 campaign doesn't balance/.test(b)));
});
