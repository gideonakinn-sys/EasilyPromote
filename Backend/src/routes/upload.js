const express = require("express");
const { protect } = require("../middleware/auth");
const {
  bucket,
  isConfigured,
  detectCategory,
  isAllowedMime,
  buildKey,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  getPresignedDownloadUrls,
  deleteObject,
  getPublicUrl,
} = require("../utils/s3");

const router = express.Router();

const requireS3 = (req, res, next) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: "File storage is not configured" });
  }
  next();
};

// POST /api/upload/presign
// body: { type: "image"|"video"|"document", contentType, filename?, path?, userId? }
router.post("/presign", protect, requireS3, async (req, res, next) => {
  try {
    const { type, contentType, filename, path } = req.body;
    if (!type || !contentType) {
      return res.status(400).json({ error: "type and contentType are required" });
    }

    const category = type; // explicit "image"|"video"|"document"
    if (!isAllowedMime(contentType, category)) {
      return res.status(400).json({ error: "File type not supported" });
    }

    const key = buildKey({
      type: category,
      userId: req.user._id,
      contentType,
      path: path || undefined,
    });

    const uploadUrl = await getPresignedUploadUrl({ key, contentType });

    res.json({
      uploadUrl,
      key,
      bucket,
      contentType,
      filename: filename || key.split("/").pop(),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/upload/confirm
// body: { key } -> returns stable public url (called after client PUTs to S3)
router.post("/confirm", protect, requireS3, async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "key is required" });
    res.json({ key, url: getPublicUrl(key) });
  } catch (error) {
    next(error);
  }
});

// POST /api/upload/presigned-url
// body: { key } -> returns a signed GET url
router.post("/presigned-url", protect, requireS3, async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "key is required" });
    const url = await getPresignedDownloadUrl(key);
    res.json({ key, url });
  } catch (error) {
    next(error);
  }
});

// POST /api/upload/urls
// body: { keys: string[] } -> returns { key: url }
router.post("/urls", protect, requireS3, async (req, res, next) => {
  try {
    const { keys } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "keys array is required" });
    }
    const urls = await getPresignedDownloadUrls(keys);
    res.json({ urls });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/upload
// body: { key }
router.delete("/", protect, requireS3, async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: "key is required" });
    await deleteObject(key);
    res.json({ message: "File deleted", key });
  } catch (error) {
    next(error);
  }
});

module.exports = router;