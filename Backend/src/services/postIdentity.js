// Live post identity (SPEC D34, D35). A post link is normalised to a stable key so one post can't be
// linked to two submissions (paid twice), and a post published before its content was approved
// doesn't earn views.
const Submission = require("../models/Submission");
const Slot = require("../models/Slot");
const { recordEvent } = require("./submissionEvents");

const POST_ALREADY_USED_MESSAGE = "This post is already linked to another campaign. Share a new post made for this campaign.";

function extractInstagramShortcode(url) {
  const m = String(url || "").match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function extractFacebookVideoId(url) {
  const s = String(url || "");
  let m = s.match(/[?&]v=(\d+)/i);
  if (m) return m[1];
  m = s.match(/\/videos\/(?:[^/]+\/)?(\d+)/i);
  if (m) return m[1];
  m = s.match(/\/reel\/(\d+)/i);
  if (m) return m[1];
  return null;
}

function extractTikTokVideoId(url) {
  const m = String(url || "").match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  return m ? m[1] : null;
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// { key, legacy } for a post link, or null for an empty one. `key` is stored on postedPlatforms[].postKey;
// `legacy` matches rows saved before postKey existed (their postUrl, or a TikTok submission's video id).
function postIdentity(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const shortcode = extractInstagramShortcode(raw);
  if (shortcode) {
    return { key: `instagram:${shortcode}`, legacy: { "postedPlatforms.postUrl": new RegExp(`instagram\\.com/(?:[^/]+/)?(?:p|reel|reels|tv)/${escapeRegex(shortcode)}(?![A-Za-z0-9_-])`) } };
  }
  const tiktokId = extractTikTokVideoId(raw);
  if (tiktokId) {
    return {
      key: `tiktok:${tiktokId}`,
      legacy: { $or: [{ tiktokVideoId: tiktokId }, { "postedPlatforms.postUrl": new RegExp(`/video/${tiktokId}(?!\\d)`) }] },
    };
  }
  const facebookId = /facebook\.com|fb\.watch/i.test(raw) ? extractFacebookVideoId(raw) : null;
  if (facebookId) {
    return { key: `facebook:${facebookId}`, legacy: { "postedPlatforms.postUrl": new RegExp(`(?:[?&]v=|/videos/(?:[^/]+/)?|/reel/)${facebookId}(?!\\d)`) } };
  }
  // Anything else: the link without query string or fragment, host lowercased, no trailing slash.
  let normalized;
  try {
    const parsed = new URL(raw);
    normalized = `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    normalized = raw.split(/[?#]/)[0].replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  }
  const [host, ...rest] = normalized.split("/");
  const path = rest.length ? `/${rest.join("/")}` : "";
  return {
    key: `url:${normalized}`,
    legacy: { "postedPlatforms.postUrl": new RegExp(`^https?://(?:www\\.)?${escapeRegex(host)}${escapeRegex(path)}/?(?:[?#].*)?$`, "i") },
  };
}

function postKeyFor(url) {
  const identity = postIdentity(url);
  return identity ? identity.key : undefined;
}

// True when any of the links is already on another submission (any creator, any campaign).
// Re-saving a link on the same submission is fine.
async function postAlreadyUsed(submissionId, urls) {
  for (const url of urls) {
    const identity = postIdentity(url);
    if (!identity) continue;
    const clash = await Submission.exists({
      _id: { $ne: submissionId },
      $or: [{ "postedPlatforms.postKey": identity.key }, identity.legacy],
    });
    if (clash) return true;
  }
  return false;
}

// When the content was cleared to post: approval, else the placement claim, else the submission.
async function campaignStartFor(submission) {
  if (submission.reviewedAt) return new Date(submission.reviewedAt);
  const slot = submission.slotId
    ? await Slot.findById(submission.slotId).select("claimedAt").lean()
    : await Slot.findOne({ campaignId: submission.campaignId, creatorId: submission.creatorId }).select("claimedAt").lean();
  if (slot && slot.claimedAt) return new Date(slot.claimedAt);
  return new Date(submission.submittedAt || submission.createdAt);
}

// Called by the syncs with the platform's publish time. Returns true when the post predates the
// campaign, so its views aren't counted. Flags the submission and records an event once.
async function postPredatesCampaign(submission, entry, publishedAt, actorName) {
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return false;
  const start = await campaignStartFor(submission);
  if (!(publishedAt < start)) return false;
  if (submission.postPredatesCampaign) return true;
  const res = await Submission.updateOne(
    { _id: submission._id, postPredatesCampaign: { $ne: true } },
    { $set: { postPredatesCampaign: true, postPredatesCampaignAt: new Date() } }
  );
  submission.postPredatesCampaign = true;
  if (res.modifiedCount === 1) {
    console.warn(`[Views Sync] Submission ${submission._id}: post published ${publishedAt.toISOString()} before the content was approved (${start.toISOString()}); its views aren't counted`);
    await recordEvent(submission, {
      type: "post_predates_campaign",
      actor: "system",
      actorName,
      metadata: { platform: entry ? entry.platform : null, postUrl: entry ? entry.postUrl : null, publishedAt, approvedAt: start },
    });
  }
  return true;
}

module.exports = { POST_ALREADY_USED_MESSAGE, postIdentity, postKeyFor, postAlreadyUsed, postPredatesCampaign };
