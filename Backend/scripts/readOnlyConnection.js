// The database connection every check script uses. Mongoose normally builds a model's indexes and
// creates its collection as soon as the model is loaded on an open connection; against production
// that would start index builds (and fail on duplicates) before anyone has read the checks. Both
// are off here, globally and on the connection, so a script only ever reads what's there.
const mongoose = require("mongoose");

const READ_ONLY_OPTIONS = { autoIndex: false, autoCreate: false };

function disableAutoBuild() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
}

async function connectReadOnly(uri, options = {}) {
  disableAutoBuild();
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, ...options, ...READ_ONLY_OPTIONS });
}

module.exports = { connectReadOnly, disableAutoBuild, READ_ONLY_OPTIONS };
