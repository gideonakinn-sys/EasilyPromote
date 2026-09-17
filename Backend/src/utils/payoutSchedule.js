// Creators withdraw once a week per campaign. A payout week runs from Friday 00:00 to
// Thursday 23:59 Lagos time (WAT, UTC+1 all year), and everything requested in it is
// paid on the Friday that ends it, so a request made on Thursday is paid the next day.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAYOUT_WEEKDAY = 5; // Friday
const MIN_CAMPAIGN_WITHDRAWAL = 2000;

// Friday 00:00 Lagos that starts the payout week containing `now`.
function payoutWeekStart(now = new Date()) {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const daysSinceFriday = (lagos.getUTCDay() - PAYOUT_WEEKDAY + 7) % 7;
  const midnight = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - daysSinceFriday);
  return new Date(midnight - LAGOS_OFFSET_MS);
}

// The Friday that pays a request made at `when`.
function nextPayoutDate(when = new Date()) {
  return new Date(payoutWeekStart(when).getTime() + 7 * DAY_MS);
}

function formatPayoutDate(date) {
  return new Date(date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Lagos",
  });
}

module.exports = { MIN_CAMPAIGN_WITHDRAWAL, payoutWeekStart, nextPayoutDate, formatPayoutDate };
