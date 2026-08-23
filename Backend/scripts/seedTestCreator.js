require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const User = require("../src/models/User");
const CreatorProfile = require("../src/models/CreatorProfile");

// Creates (or repairs) the creator account handed to Meta and TikTok app reviewers.
// Idempotent: safe to re-run before each submission.

const EMAIL = process.env.TEST_CREATOR_EMAIL || "reviewer@easilypromote.com";
const NAME = process.env.TEST_CREATOR_NAME || "App Review Tester";
const USERNAME = process.env.TEST_CREATOR_USERNAME || "app_review_tester";
const NICHES = (process.env.TEST_CREATOR_NICHES || "Fashion,Lifestyle,Music")
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);
const AVATAR_URL = process.env.TEST_CREATOR_AVATAR_URL || "";

function generatePassword() {
  // Upper, lower, digit and symbol, so it passes any reasonable policy.
  return `Rev${crypto.randomBytes(9).toString("base64url")}!7`;
}

async function main() {
  await connectDB();

  const password = process.env.TEST_CREATOR_PASSWORD || generatePassword();
  const generated = !process.env.TEST_CREATOR_PASSWORD;

  let user = await User.findOne({ email: EMAIL });
  if (user) {
    user.name = NAME;
    user.role = "creator";
    user.emailVerified = true;
    user.isActive = true;
    user.password = password; // re-hashed by the pre-save hook
    if (AVATAR_URL) user.avatar = AVATAR_URL;
    await user.save();
    console.log(`[SeedTestCreator] Updated existing user ${EMAIL}`);
  } else {
    user = await User.create({
      name: NAME,
      email: EMAIL,
      password,
      role: "creator",
      emailVerified: true,
      isActive: true,
      ...(AVATAR_URL ? { avatar: AVATAR_URL } : {}),
    });
    console.log(`[SeedTestCreator] Created user ${EMAIL}`);
  }

  let profile = await CreatorProfile.findOne({ userId: user._id });
  if (!profile) {
    profile = new CreatorProfile({ userId: user._id, username: USERNAME });
  }
  profile.username = profile.username || USERNAME;
  profile.displayName = NAME;
  profile.country = profile.country || "Nigeria";
  profile.niches = NICHES;
  await profile.save();
  console.log(`[SeedTestCreator] Profile ready | username=${profile.username} niches=${NICHES.join(", ")}`);

  // The reviewer must be able to reach the connect step and claim a slot.
  const warnings = [];
  if (!user.avatar) {
    warnings.push("No avatar set. Set TEST_CREATOR_AVATAR_URL, or upload a photo once signed in — without it the setup state blocks slot claiming.");
  }

  const Slot = require("../src/models/Slot");
  const Campaign = require("../src/models/Campaign");
  const liveCampaigns = await Campaign.countDocuments({ status: "live" });
  const openSlots = await Slot.countDocuments({ status: "available" });
  if (liveCampaigns === 0) warnings.push("No live campaigns. The reviewer will have nothing to claim.");
  if (openSlots === 0) warnings.push("No available slots. Seed a campaign with open slots before submitting.");

  const activeSlots = await Slot.countDocuments({
    creatorId: user._id,
    status: { $in: ["claimed", "submitted", "verifying", "approved", "paid"] },
  });
  if (activeSlots >= 3) {
    warnings.push(`This account holds ${activeSlots} active slots and is at the claim limit. Clear them before review.`);
  }

  console.log("\n─────────── Reviewer credentials ───────────");
  console.log(`URL:      ${process.env.TEST_CREATOR_URL || "https://app.easilypromote.com"}`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${password}${generated ? "  (generated — copy it now, it is not stored anywhere)" : ""}`);
  console.log("────────────────────────────────────────────\n");

  if (warnings.length > 0) {
    console.log("Before submitting:");
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log("");
  }

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("[SeedTestCreator] Failed:", err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
