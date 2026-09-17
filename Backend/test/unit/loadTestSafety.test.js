// The load test (scripts/loadTest) must only ever touch this machine, and its numbers must be right.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertLocalMongoUri, assertLocalUrl, UnsafeTargetError } = require("../../scripts/loadTest/safety");
const { percentile, summarize } = require("../../scripts/loadTest/load");

test("only MongoDB on this machine is accepted", () => {
  for (const uri of [
    "mongodb://127.0.0.1:27099/ep_load",
    "mongodb://localhost:27017/ep_load?directConnection=true",
    "mongodb://[::1]:27017/x",
    "mongodb://user:pass@127.0.0.1:27017/x",
    "mongodb://127.0.0.1:27017,localhost:27018/x?replicaSet=rs",
  ]) {
    assert.equal(assertLocalMongoUri(uri), uri);
  }
  for (const uri of [
    "mongodb+srv://cluster0.abcde.mongodb.net/easilypromote",
    "mongodb://ac-0bcbwvr-shard-00-00.abcde.mongodb.net:27017/easilypromote",
    "mongodb://127.0.0.1:27017,db.example.com:27017/x",
    "mongodb://user:p@ss@evil.example.com/x",
    "mongodb://127.0.0.1.example.com/x",
    "mongodb://10.0.0.5:27017/x",
    "",
    undefined,
  ]) {
    assert.throws(() => assertLocalMongoUri(uri), UnsafeTargetError, String(uri));
  }
});

test("only an API on this machine over http is accepted", () => {
  assert.equal(assertLocalUrl("http://127.0.0.1:5000/api"), "http://127.0.0.1:5000");
  assert.equal(assertLocalUrl("http://localhost:61234"), "http://localhost:61234");
  for (const url of ["https://api.easilypromote.com", "http://api.easilypromote.com", "https://127.0.0.1:5000", "http://127.0.0.1.nip.io", "not a url"]) {
    assert.throws(() => assertLocalUrl(url), UnsafeTargetError, url);
  }
});

test("percentiles use the nearest rank and the summary separates errors from expected refusals", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 95);
  assert.equal(percentile(sorted, 99), 99);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 50), 0);

  const summary = summarize(
    "join",
    [
      { status: 200, ms: 10, expected: true },
      { status: 409, code: "CAMPAIGN_FULL", ms: 20, expected: true },
      { status: 500, ms: 30, expected: false },
      { status: 0, error: "ECONNRESET", ms: 40, expected: false },
      { status: 400, code: "INVALID", ms: 50, expected: false },
    ],
    1000
  );
  assert.equal(summary.requests, 5);
  assert.equal(summary.rps, 5);
  assert.equal(summary.errors, 2);
  assert.equal(summary.errorRate, 0.4);
  assert.equal(summary.unexpected, 1);
  assert.equal(summary.p50, 30);
  assert.deepEqual(summary.outcomes, { 200: 1, "409 CAMPAIGN_FULL": 1, 500: 1, "network: ECONNRESET": 1, "400 INVALID": 1 });
});
