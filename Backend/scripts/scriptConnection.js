// Database connections for scripts run against production. Mongoose normally builds a model's
// indexes and creates its collection as soon as the model is loaded on an open connection; from a
// script that would start index builds (and fail on duplicates) before anyone has read the checks.
// Both are off here, globally and on the connection. Index builds are left to the API, which runs
// them when it starts.
//
// connectReadOnly:     the check scripts and the migration dry run. They only read.
// connectForMigration: scripts/migrateCampaignV2.js --apply, which writes the Campaign v2 fields
//                      on existing campaigns and nothing else. Same options; the name says it writes.
const mongoose = require("mongoose");

const NO_AUTO_BUILD = { autoIndex: false, autoCreate: false };

function disableAutoBuild() {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
}

function connect(uri, options) {
  disableAutoBuild();
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, ...options, ...NO_AUTO_BUILD });
}

const connectReadOnly = (uri, options = {}) => connect(uri, options);
const connectForMigration = (uri, options = {}) => connect(uri, options);

module.exports = { connectReadOnly, connectForMigration, disableAutoBuild, NO_AUTO_BUILD };
