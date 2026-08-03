const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const videoTypes = [
    "video/mp4",
    "video/mov",
    "video/avi",
    "video/webm",
  ];
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  const allTypes = [...imageTypes, ...videoTypes, ...docTypes];

  if (allTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("File type not supported"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

module.exports = upload;
