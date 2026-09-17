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
const { startPayoutReconciliation } = require("./utils/reconcilePayouts");
// Campaign engine: applications (ticket 06)
const { startApplicationDeadlines } = require("./utils/applicationDeadlines");

// Campaign engine: content approval (ticket 07)
const { startContentAutoApprove } = require("./services/contentApproval");
const { startOpsAlerts } = require("./services/opsAlerts");
const { startAutoRefunds } = require("./services/autoRefunds");

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  await seedDefaultAdmin();
  startCancelledCleanup();
  startTikTokSync();
  startMetaSync();
  startRankRecalc();
  startPayoutReconciliation();
  startApplicationDeadlines(); // Campaign engine: applications (ticket 06)

  // Campaign engine: content approval (ticket 07)
  startContentAutoApprove();
  // M7: ops alerts every 15 minutes
  startOpsAlerts();
  startAutoRefunds(); // Automatic unused-budget refunds (ticket 11)
  const server = http.createServer(app);
  initSocket(server);
  server.listen(PORT, () => {
    console.log(`EasilyPromote API running on port ${PORT}`);
  });
};

start();
