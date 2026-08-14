const cloudinary = require("cloudinary").v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName) {
  console.warn("[Cloudinary] CLOUDINARY_CLOUD_NAME not set — Cloudinary uploads will fail");
}
if (!apiKey) {
  console.warn("[Cloudinary] CLOUDINARY_API_KEY not set — Cloudinary uploads will fail");
}
if (!apiSecret) {
  console.warn("[Cloudinary] CLOUDINARY_API_SECRET not set — Cloudinary uploads will fail");
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  timeout: 300000,
});

module.exports = cloudinary;
