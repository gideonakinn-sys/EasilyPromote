const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const secret = process.env.TIKTOK_TOKEN_KEY;
  if (!secret) {
    throw new Error("TIKTOK_TOKEN_KEY is not set");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext) {
  if (plaintext === undefined || plaintext === null || plaintext === "") {
    return null;
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decrypt(payload) {
  if (!payload) {
    return null;
  }
  const parts = payload.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };
