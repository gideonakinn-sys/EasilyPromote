// Campaign engine: content approval (ticket 07)
// What a live caption must carry: the brief's hashtags, and the creator's referral code when
// the campaign tracks referrals. The server is the only judge; the web app shows its answer.

// A tag character: letters (with combining marks), digits, underscore and hyphen.
const TAG_CHAR = "[\\p{L}\\p{M}\\p{N}_-]";
const CAPTION_TAG = new RegExp(`#(${TAG_CHAR}+)`, "gu");

function normalizeHashtag(tag) {
  return String(tag || "").normalize("NFC").trim().replace(/^#+/, "").toLowerCase();
}

// Brief hashtags the caption doesn't carry, as "#Tag" in the brief's spelling.
function missingHashtags(required, caption) {
  const text = String(caption || "").normalize("NFC");
  const present = new Set([...text.matchAll(CAPTION_TAG)].map((match) => normalizeHashtag(match[1])));
  return (required || [])
    .filter((tag) => normalizeHashtag(tag))
    .filter((tag) => !present.has(normalizeHashtag(tag)))
    .map((tag) => `#${String(tag).normalize("NFC").trim().replace(/^#+/, "")}`);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The code as a whole token: not glued to letters, digits, underscores or hyphens.
function captionHasCode(caption, code) {
  const wanted = String(code || "").normalize("NFC").trim();
  if (!wanted) return false;
  const pattern = new RegExp(`(?<!${TAG_CHAR})${escapeRegExp(wanted)}(?!${TAG_CHAR})`, "iu");
  return pattern.test(String(caption || "").normalize("NFC"));
}

module.exports = { normalizeHashtag, missingHashtags, captionHasCode };
