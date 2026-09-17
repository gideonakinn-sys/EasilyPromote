const mongoose = require("mongoose");

// An ObjectId from an ObjectId, a string or anything that prints as one. Throws on an invalid id.
function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));
}

module.exports = { toObjectId };
