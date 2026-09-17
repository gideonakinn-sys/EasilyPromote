// Campaign engine: applications (ticket 06). Runs the D9 application deadlines every hour:
// brands reminded on day 3, pending applications expired after 7 days.
const { processApplicationDeadlines } = require("../services/applications");

const INTERVAL_MS = 60 * 60 * 1000;

async function runApplicationDeadlines() {
  try {
    const { expired, reminded } = await processApplicationDeadlines();
    if (expired || reminded) console.log(`[Applications] Expired ${expired}, reminded brands about ${reminded}`);
  } catch (error) {
    console.error("[Applications] Deadline run failed:", error.message);
  }
}

function startApplicationDeadlines() {
  runApplicationDeadlines();
  setInterval(runApplicationDeadlines, INTERVAL_MS);
}

module.exports = { startApplicationDeadlines };
