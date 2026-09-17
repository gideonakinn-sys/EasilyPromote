// The on-switch for the automatic refund job (services/autoRefunds). The job refunds real money on its
// first run, including campaigns that ended before it shipped, so it does nothing unless
// AUTO_REFUNDS_ENABLED is exactly "true" (case and surrounding spaces ignored). Admin refunds and
// retries don't depend on it.
function autoRefundsEnabled(env = process.env) {
  return typeof env.AUTO_REFUNDS_ENABLED === "string" && env.AUTO_REFUNDS_ENABLED.trim().toLowerCase() === "true";
}

module.exports = { autoRefundsEnabled };
