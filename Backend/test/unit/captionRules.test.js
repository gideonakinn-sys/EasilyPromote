// What a creator's live caption must carry: the brief's hashtags and, for referral
// campaigns, their referral code (ticket 07).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHashtag, missingHashtags, captionHasCode } = require("../../src/utils/captionRules");

test("hashtags match ignoring case, a leading #, and Unicode composition", () => {
  assert.equal(normalizeHashtag("#SummerDrop"), "summerdrop");
  assert.equal(normalizeHashtag("##ad"), "ad");
  assert.deepEqual(missingHashtags(["#SummerDrop", "ad"], "Looks #summerdrop #AD"), []);
  assert.deepEqual(missingHashtags(["#SummerDrop", "ad"], "Looks #summerdrop"), ["#ad"]);
  // "é" precomposed in the brief, decomposed (e + combining accent) in the caption.
  assert.deepEqual(missingHashtags(["#Café"], "Coffee #Café"), []);
  assert.deepEqual(missingHashtags(["#Café"], "Coffee #Cafe"), ["#Café"]);
});

test("hyphenated hashtags match as one tag, and a prefix doesn't count", () => {
  assert.deepEqual(missingHashtags(["#k-pop"], "Dance #K-Pop!"), []);
  assert.deepEqual(missingHashtags(["#k-pop"], "Dance #k"), ["#k-pop"]);
  assert.deepEqual(missingHashtags(["#ad"], "#adventure"), ["#ad"]);
  assert.deepEqual(missingHashtags([], "anything"), []);
  assert.deepEqual(missingHashtags(["", "#"], "anything"), []);
});

test("a referral code must appear as a whole token, in any case", () => {
  assert.equal(captionHasCode("Use code ADA-2025 at checkout", "ada-2025"), true);
  assert.equal(captionHasCode("code: ada-2025.", "ADA-2025"), true);
  assert.equal(captionHasCode("Use ADA-20256", "ADA-2025"), false);
  assert.equal(captionHasCode("Use XADA-2025", "ADA-2025"), false);
  assert.equal(captionHasCode("Use ADA-2025-X", "ADA-2025"), false);
  assert.equal(captionHasCode("Use A.B+1", "A.B+1"), true);
  assert.equal(captionHasCode("", "ADA"), false);
});
