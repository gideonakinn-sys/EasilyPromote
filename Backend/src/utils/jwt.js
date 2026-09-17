const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// jsonwebtoken turns a string secret into a key on every call, first trying to read it as a PEM key
// and throwing, which the load test (ticket 11) measured at about a tenth of the API's CPU. The same
// HMAC key, made once per secret, signs and verifies exactly the same tokens.
const secretKeys = new Map();
function secretKey(secret) {
  if (typeof secret !== "string" || secret.length === 0) return secret;
  let key = secretKeys.get(secret);
  if (!key) {
    key = crypto.createSecretKey(Buffer.from(secret));
    secretKeys.set(secret, key);
  }
  return key;
}

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    secretKey(process.env.JWT_SECRET),
    { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    secretKey(process.env.JWT_REFRESH_SECRET),
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
};

const verifyToken = (token, secret) => {
  return jwt.verify(token, secretKey(secret));
};

module.exports = { generateToken, generateRefreshToken, verifyToken };
