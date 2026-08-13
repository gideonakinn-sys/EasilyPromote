const { S3Client } = require("@aws-sdk/client-s3");

const region = process.env.AWS_REGION || "us-east-1";
const bucket = process.env.AWS_S3_BUCKET_NAME;

const hasCredentials = () =>
  Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const isConfigured = () => hasCredentials() && Boolean(bucket);

if (!process.env.AWS_ACCESS_KEY_ID) {
  console.warn("[S3] AWS_ACCESS_KEY_ID not set — S3 uploads disabled");
}
if (!process.env.AWS_SECRET_ACCESS_KEY) {
  console.warn("[S3] AWS_SECRET_ACCESS_KEY not set — S3 uploads disabled");
}
if (!bucket) {
  console.warn("[S3] AWS_S3_BUCKET_NAME not set — S3 uploads disabled");
}

const s3 = new S3Client({
  region,
  credentials: hasCredentials()
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

module.exports = { s3, bucket, region, isConfigured };