const { recalculateAllCreators } = require("../services/creatorScore");

const RECALC_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runRankRecalc() {
  try {
    return await recalculateAllCreators();
  } catch (error) {
    console.error("[Rank] Recalculation failed:", error.message);
    return null;
  }
}

function startRankRecalc() {
  runRankRecalc();
  setInterval(runRankRecalc, RECALC_INTERVAL_MS);
}

module.exports = { startRankRecalc, runRankRecalc };
