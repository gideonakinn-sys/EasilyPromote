const cloudinary = require("../config/cloudinary");

const uploadToCloudinary = (file, folder = "easily-promote") => {
  return new Promise((resolve, reject) => {
    const isVideo = file.mimetype.startsWith("video/");
    const isDocument =
      file.mimetype === "application/pdf" ||
      file.mimetype === "application/msword" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const resourceType = isVideo ? "video" : isDocument ? "raw" : "image";

    const options = {
      folder,
      resource_type: resourceType,
    };

    if (isVideo) {
      options.allowed_formats = ["mp4", "mov", "avi", "webm"];
      options.transformation = [{ quality: "auto", fetch_format: "auto" }];
      options.eager_async = true;
    } else if (isDocument) {
      options.allowed_formats = ["pdf", "doc", "docx"];
    } else {
      options.allowed_formats = ["jpg", "jpeg", "png", "gif", "webp"];
      options.transformation = [{ quality: "auto", width: 1920, crop: "limit" }];
    }

    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error("[Cloudinary] Upload failed:", {
            http_code: error.http_code,
            code: error.code,
            message: error.message,
          });
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    stream.end(file.buffer);
  });
};

const deleteFromCloudinary = async (publicId, resourceType = "image") => {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
};

module.exports = { uploadToCloudinary, deleteFromCloudinary };
