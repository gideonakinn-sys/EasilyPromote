// Tokens are signed and verified with an HMAC key made once per secret (load test, ticket 11). They
// must be exactly the tokens a plain string secret gives, so sessions survive the deploy.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const jsonwebtoken = require("jsonwebtoken");

process.env.JWT_SECRET = "unit-jwt-secret";
process.env.JWT_REFRESH_SECRET = "unit-jwt-refresh-secret";
const { generateToken, generateRefreshToken, verifyToken } = require("../../src/utils/jwt");

test("tokens match what the string secret signs, both ways", () => {
  const user = { _id: "6aab9439cd04d8e821b1f596", role: "creator" };
  const token = generateToken(user);
  assert.deepEqual(
    { id: jsonwebtoken.verify(token, "unit-jwt-secret").id, role: jsonwebtoken.verify(token, "unit-jwt-secret").role },
    { id: user._id, role: "creator" }
  );
  const legacy = jsonwebtoken.sign({ id: user._id, role: "creator" }, "unit-jwt-secret", { expiresIn: "15m" });
  assert.equal(verifyToken(legacy, process.env.JWT_SECRET).id, user._id);

  const refresh = generateRefreshToken(user);
  assert.equal(verifyToken(refresh, process.env.JWT_REFRESH_SECRET).id, user._id);
});

test("a token signed with another secret, a tampered token or an unsigned one is refused", () => {
  const other = jsonwebtoken.sign({ id: "x", role: "admin" }, "someone-else", { expiresIn: "15m" });
  assert.throws(() => verifyToken(other, process.env.JWT_SECRET), { name: "JsonWebTokenError" });
  const token = generateToken({ _id: "abc", role: "creator" });
  const [header, , signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ id: "abc", role: "super_admin" })).toString("base64url");
  assert.throws(() => verifyToken(`${header}.${forged}.${signature}`, process.env.JWT_SECRET), { name: "JsonWebTokenError" });
  const none = jsonwebtoken.sign({ id: "abc", role: "super_admin" }, null, { algorithm: "none" });
  assert.throws(() => verifyToken(none, process.env.JWT_SECRET), { name: "JsonWebTokenError" });
  // The refresh secret doesn't verify access tokens.
  assert.throws(() => verifyToken(token, process.env.JWT_REFRESH_SECRET), { name: "JsonWebTokenError" });
});

test("expired tokens are still refused", () => {
  const expired = jsonwebtoken.sign({ id: "abc", exp: Math.floor(Date.now() / 1000) - 10 }, "unit-jwt-secret");
  assert.throws(() => verifyToken(expired, process.env.JWT_SECRET), { name: "TokenExpiredError" });
});
