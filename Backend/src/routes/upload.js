const express = require("express");
const upload = require("../middleware/upload");
const { uploadToCloudinary, deleteFromCloudinary } = require("../utils/cloudinary");
const { protect } = require("../middleware/auth");

const router = express.Router();

router.post("/image", protect, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file, "easily-promote/images");
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/video", protect, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file, "easily-promote/videos");
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/document", protect, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await uploadToCloudinary(req.file, "easily-promote/documents");
    res.json({
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:publicId", protect, async (req, res, next) => {
  try {
    const { publicId } = req.params;
    const { resourceType = "image" } = req.query;
    await deleteFromCloudinary(publicId, resourceType);
    res.json({ message: "File deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;