const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, bucket, region, isConfigured } = require("../config/s3");
const crypto = require("crypto");

const FOLDER_FOR_TYPE = {
  image: "images",
  video: "videos",
  document: "documents",
};

const ALLOWED_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  video: ["video/mp4", "video/mov", "video/avi", "video/webm"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

const EXTENSION_FOR_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/mov": "mov",
  "video/avi": "avi",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const detectCategory = (contentType) => {
  if (ALLOWED_TYPES.video.includes(contentType)) return "video";
  if (ALLOWED_TYPES.document.includes(contentType)) return "document";
  if (ALLOWED_TYPES.image.includes(contentType)) return "image";
  return null;
};

const isAllowedMime = (contentType, category) => {
  if (!category || !ALLOWED_TYPES[category]) return false;
  return ALLOWED_TYPES[category].includes(contentType);
};

const extensionFor = (contentType) => EXTENSION_FOR_MIME[contentType] || "bin";

const buildKey = ({ type, userId, contentType, path = "" }) => {
  const folder = FOLDER_FOR_TYPE[type] || "files";
  const scopeId = (userId || "anonymous").toString();
  const uuid = crypto.randomUUID();
  const ext = extensionFor(contentType);
  const prefix = path ? `${path}/` : "";
  return `easily-promote/${folder}/${prefix}${scopeId}/${uuid}.${ext}`;
};

const getPresignedUploadUrl = async ({ key, contentType }) => {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: 900 });
};

const getPresignedDownloadUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
};

const getPresignedDownloadUrls = async (keys, expiresIn = 3600) => {
  const entries = await Promise.all(
    keys.map(async (key) => ({ key, url: await getPresignedDownloadUrl(key, expiresIn) }))
  );
  return Object.fromEntries(entries.map((e) => [e.key, e.url]));
};

const deleteObject = async (key) => {
  return s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

// Stable, publicly-readable object URL (bucket must be public-read via policy / CloudFront).
const getPublicUrl = (key) => `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

module.exports = {
  bucket,
  region,
  isConfigured,
  detectCategory,
  isAllowedMime,
  buildKey,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  getPresignedDownloadUrls,
  deleteObject,
  getPublicUrl,
  FOLDER_FOR_TYPE,
  ALLOWED_TYPES,
};