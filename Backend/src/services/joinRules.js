// Everything that decides whether a creator may join a campaign right now: the campaign's
// Creator Eligibility plus the platform-wide join rules (a connected social account, chosen
// niches, at most 3 active placements, and the rank the remaining places need).
// Pure: callers load the documents; the join route and the marketplace share this.
const { evaluateEligibility } = require("./eligibility");
const { rankAtLeast } = require("./creatorScore");

const MAX_ACTIVE_PLACEMENTS = 3;
const RANKS = ["rank1", "rank2", "rank3", "rank4", "rank5", "elite"];
// Rules about the creator's account as a whole rather than this campaign; the marketplace
// shows these once, not on every card.
const ACCOUNT_CRITERIA = ["socialAccount", "niches", "placementLimit"];

const rankName = (rank) => (rank === "elite" ? "Elite" : `rank ${String(rank).replace("rank", "")}`);

// Connected TikTok / Meta accounts count as social accounts on the platform they belong to.
function withConnectedAccounts(profile, connectedPlatforms) {
  const accounts = [...((profile && profile.socialAccounts) || [])];
  for (const platform of connectedPlatforms || []) {
    if (!accounts.some((a) => a.platform === platform)) accounts.push({ platform, followers: 0 });
  }
  return { ...(profile || {}), socialAccounts: accounts };
}

// `availableSlots` are the campaign's open placements (or just the one asked for).
// Returns { eligible, failures: [{ criterion, message }], matchScore, slots } where `slots`
// are the open placements this creator's rank can take, in order.
function joinEligibility({ profile, connectedPlatforms = [], hasSocial, activeSlots = 0, campaign, availableSlots = [] }) {
  const failures = [];
  const fail = (criterion, message) => failures.push({ criterion, message });

  if (!hasSocial) fail("socialAccount", "Connect a social account to join campaigns");
  if (!profile || !Array.isArray(profile.niches) || profile.niches.length === 0) {
    fail("niches", "Choose your niches to join campaigns");
  }
  if (activeSlots >= MAX_ACTIVE_PLACEMENTS) {
    fail("placementLimit", `You have ${MAX_ACTIVE_PLACEMENTS} active placements. Finish one to join another`);
  }

  const creator = withConnectedAccounts(profile, connectedPlatforms);
  const result = evaluateEligibility(creator, campaign);
  failures.push(...result.failures);

  const rank = (profile && profile.rank) || "rank1";
  const slots = availableSlots.filter((s) => rankAtLeast(rank, s.rankRequired));
  if (availableSlots.length > 0 && slots.length === 0 && !result.failures.some((f) => f.criterion === "minRank")) {
    const lowest = availableSlots.map((s) => s.rankRequired).filter(Boolean).sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b))[0];
    fail("minRank", `The places left need ${rankName(lowest)} or higher`);
  }

  return { eligible: failures.length === 0, failures, matchScore: result.matchScore, slots };
}

function campaignFailures(failures) {
  return failures.filter((f) => !ACCOUNT_CRITERIA.includes(f.criterion));
}

module.exports = { joinEligibility, campaignFailures, MAX_ACTIVE_PLACEMENTS };
