require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const { initSocket } = require("./config/socket");
const seedDefaultAdmin = require("./utils/seedAdmin");
const { startCancelledCleanup } = require("./utils/cleanupCancelled");
const { startTikTokSync } = require("./utils/syncTiktokViews");
const { startMetaSync } = require("./utils/syncMetaViews");
const { startRankRecalc } = require("./utils/rankRecalc");

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await seedDefaultAdmin();
  startCancelledCleanup();
  startTikTokSync();
  startMetaSync();
  startRankRecalc();
  const server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, () => {
    console.log(`EasilyPromote API running on port ${PORT}`);
  });
};

start();
