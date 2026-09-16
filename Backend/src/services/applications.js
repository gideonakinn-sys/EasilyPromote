// Application Required campaigns (ticket 06): apply, withdraw, brand review, approve / reject,
// and the D9 deadlines (brand reminded on day 3, pending applications expire after 7 days).
// Creator Approval lives on CampaignApplication only; nothing here reads or writes a
// Submission (ADR 0002). Handlers return { status, body } so routes stay thin.
const Campaign = require("../models/Campaign");
const CampaignApplication = require("../models/CampaignApplication");
const Notification = require("../models/Notification");
const Slot = require("../models/Slot");
const User = require("../models/User");
const { emitToUser } = require("../config/socket");
const { sendEmail } = require("./email");
const { joinEligibility } = require("./joinRules");
const { loadJoiner, reservePlacementFor, JOIN_ORDER } = require("./placements");
const { buildApplicantSnapshot, orderSnapshot } = require("./applicantSnapshot");
const { campaignTerms, payPerUnit } = require("../utils/campaignPay");
const { ACTIVE_PLACEMENT_STATUSES, HELD_PLACEMENT_STATUSES } = require("../utils/placementStatuses");

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRE_AFTER_DAYS = 7;
const REMIND_AFTER_DAYS = 3;
const STATUSES = CampaignApplication.APPLICATION_STATUSES;
// A creator may apply again after withdrawing or when an application expired unreviewed.
const REOPENABLE = ["withdrawn", "expired"];

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const expiresAt = (application) => new Date(new Date(application.appliedAt).getTime() + EXPIRE_AFTER_DAYS * DAY_MS);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// In-app notification, a live socket update and (optionally) an email. Delivery problems are
// logged, never allowed to undo the decision that caused them.
async function notify({ to, role, campaign, type, title, body, email }) {
  try {
    await Notification.create({
      ...(role === "business" ? { businessId: to } : { creatorId: to }),
      campaignId: campaign._id,
      type,
      title,
      body,
    });
    emitToUser(to, "application-update", { campaignId: campaign._id, type });
    if (email) {
      const user = await User.findById(to).select("email").lean();
      if (user && user.email) {
        await sendEmail({
          to: user.email,
          subject: title,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#111;margin-top:0;">${escapeHtml(title)}</h2><p style="color:#333;font-size:15px;">${escapeHtml(body)}</p><p style="color:#999;font-size:12px;">EasilyPromote — Connect brands with creators.</p></div>`,
          text: `${title}\n\n${body}`,
        });
      }
    }
  } catch (error) {
    console.error(`[Applications] Notifying ${to} (${type}) failed:`, error.message);
  }
}

// ── Creator ──────────────────────────────────────────────────────────────────────────────

async function applyToCampaign({ user, campaignId, pitch = "" }) {
  const creatorId = user._id;
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== "live") return refuse(404, "CAMPAIGN_NOT_LIVE", "Campaign not found or not live");
  if (campaignTerms(campaign).creatorAccess !== "application_required") {
    return refuse(409, "OPEN_CALL", "This campaign is an Open Call. Join it instead of applying");
  }

  const [existing, ctx, activeSlots, alreadyHeld, openSlots, account] = await Promise.all([
    CampaignApplication.findOne({ campaign: campaign._id, creator: creatorId }).lean(),
    loadJoiner(creatorId),
    Slot.countDocuments({ creatorId, status: { $in: ACTIVE_PLACEMENT_STATUSES } }),
    Slot.exists({ campaignId: campaign._id, creatorId, status: { $in: HELD_PLACEMENT_STATUSES } }),
    Slot.find({ campaignId: campaign._id, status: "available" }).sort(JOIN_ORDER).lean(),
    User.findById(creatorId).select("name avatar").lean(),
  ]);
  if (alreadyHeld) return refuse(409, "ALREADY_JOINED", "You already have a place in this campaign");
  if (existing && !REOPENABLE.includes(existing.status)) {
    const message = {
      pending: "You've already applied. The brand is reviewing applications",
      approved: "You've already been selected for this campaign",
      rejected: "The brand has already reviewed your application for this campaign",
    }[existing.status];
    return refuse(409, "ALREADY_APPLIED", message, { status: existing.status });
  }
  if (openSlots.length === 0) return refuse(409, "CAMPAIGN_FULL", "This campaign has no places left");

  // The same check as joining, so a creator who couldn't join can't apply either.
  const check = joinEligibility({
    profile: ctx.profile,
    connectedPlatforms: ctx.connectedPlatforms,
    hasSocial: ctx.hasSocial,
    activeSlots,
    campaign,
    availableSlots: openSlots,
  });
  if (!check.eligible) {
    return refuse(403, "NOT_ELIGIBLE", check.failures[0].message, { failures: check.failures });
  }

  const now = new Date();
  const fields = {
    status: "pending",
    pitch: pitch || "",
    applicantSnapshot: buildApplicantSnapshot(ctx.profile, account),
    matchScore: check.matchScore,
    appliedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: "",
    remindedAt: null,
    closedAt: null,
  };

  let application;
  try {
    application = existing
      ? await CampaignApplication.findOneAndUpdate(
          { _id: existing._id, status: { $in: REOPENABLE } },
          { $set: fields },
          { new: true }
        ).lean()
      : (await CampaignApplication.create({ campaign: campaign._id, creator: creatorId, ...fields })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    application = null;
  }
  if (!application) return refuse(409, "ALREADY_APPLIED", "You've already applied. The brand is reviewing applications");

  emitToUser(campaign.businessId, "application-update", { campaignId: campaign._id, type: "application_received" });
  return { status: 201, body: creatorView(application, campaign) };
}

async function withdrawApplication({ user, campaignId }) {
  const application = await CampaignApplication.findOneAndUpdate(
    { campaign: campaignId, creator: user._id, status: "pending" },
    { $set: { status: "withdrawn", closedAt: new Date() } },
    { new: true }
  ).lean();
  if (!application) {
    const existing = await CampaignApplication.exists({ campaign: campaignId, creator: user._id });
    return existing
      ? refuse(409, "NOT_PENDING", "Only a pending application can be withdrawn")
      : refuse(404, "APPLICATION_NOT_FOUND", "You haven't applied to this campaign");
  }
  const campaign = await Campaign.findById(campaignId).select("businessId name contentPay campaignModel campaignObjective objective referral creatorAccess").lean();
  if (campaign) emitToUser(campaign.businessId, "application-update", { campaignId, type: "application_withdrawn" });
  return { status: 200, body: creatorView(application, campaign) };
}

function creatorView(application, campaign) {
  return {
    id: application._id,
    campaignId: application.campaign,
    campaignName: campaign ? campaign.name : "",
    status: application.status,
    pitch: application.pitch || "",
    pay: campaign ? payPerUnit(campaign, null) : null,
    appliedAt: application.appliedAt,
    expiresAt: application.status === "pending" ? expiresAt(application) : null,
    reviewedAt: application.reviewedAt || null,
    rejectionReason: application.status === "rejected" ? application.rejectionReason || "" : "",
  };
}

// "My applications" for the creator dashboard, newest first.
async function buildMyApplications(userId) {
  const applications = await CampaignApplication.find({ creator: userId })
    .populate({
      path: "campaign",
      select: "name coverImageUrl status businessId contentPay campaignModel campaignObjective objective referral creatorAccess",
      populate: { path: "businessId", select: "name avatar" },
    })
    .sort({ appliedAt: -1 })
    .lean();
  return applications
    .filter((a) => a.campaign)
    .map((a) => ({
      ...creatorView({ ...a, campaign: a.campaign._id }, a.campaign),
      campaignStatus: a.campaign.status,
      coverImageUrl: a.campaign.coverImageUrl || null,
      brandName: a.campaign.businessId ? a.campaign.businessId.name || "Brand" : "Brand",
      brandAvatar: a.campaign.businessId ? a.campaign.businessId.avatar || null : null,
    }));
}

// ── Brand ────────────────────────────────────────────────────────────────────────────────

async function ownCampaign(user, campaignId) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) return { refusal: refuse(404, "CAMPAIGN_NOT_FOUND", "Campaign not found") };
  if (String(campaign.businessId) !== String(user._id)) return { refusal: refuse(403, "NOT_AUTHORIZED", "Not authorized") };
  return { campaign };
}

function brandRow(application) {
  const s = application.applicantSnapshot || {};
  return {
    id: application._id,
    status: application.status,
    pitch: application.pitch || "",
    matchScore: application.matchScore || 0,
    appliedAt: application.appliedAt,
    expiresAt: application.status === "pending" ? expiresAt(application) : null,
    reviewedAt: application.reviewedAt || null,
    rejectionReason: application.rejectionReason || "",
    creator: {
      id: application.creator,
      name: s.name || "",
      username: s.username || "",
      photo: s.photo || null,
      verified: Boolean(s.verified),
      location: s.location || null,
      topPlatform: (s.platforms && s.platforms[0]) || null,
      categories: s.categories || [],
    },
  };
}

async function listApplications({ user, campaignId, status, sort = "match" }) {
  const { campaign, refusal } = await ownCampaign(user, campaignId);
  if (refusal) return refusal;
  if (status && !STATUSES.includes(status)) return refuse(400, "INVALID_STATUS", `Status must be one of ${STATUSES.join(", ")}`);

  const [grouped, applications] = await Promise.all([
    CampaignApplication.aggregate([{ $match: { campaign: campaign._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    CampaignApplication.find({ campaign: campaign._id, ...(status && { status }) })
      .sort(sort === "newest" ? { appliedAt: -1, _id: -1 } : { matchScore: -1, appliedAt: 1, _id: 1 })
      .lean(),
  ]);
  const counts = { all: 0, ...Object.fromEntries(STATUSES.map((s) => [s, 0])) };
  for (const g of grouped) {
    counts[g._id] = g.n;
    counts.all += g.n;
  }
  return { status: 200, body: { counts, applications: applications.map(brandRow) } };
}

async function getApplication({ user, campaignId, applicationId }) {
  const { campaign, refusal } = await ownCampaign(user, campaignId);
  if (refusal) return refusal;
  const application = await CampaignApplication.findOne({ _id: applicationId, campaign: campaign._id }).lean();
  if (!application) return refuse(404, "APPLICATION_NOT_FOUND", "Application not found");
  return {
    status: 200,
    body: {
      ...brandRow(application),
      applicant: application.applicantSnapshot,
      sections: orderSnapshot(campaign, application.applicantSnapshot).sections,
    },
  };
}

// Loads the brand's pending application; `refusal` explains why it can't be decided.
async function pendingApplication(user, campaignId, applicationId) {
  const { campaign, refusal } = await ownCampaign(user, campaignId);
  if (refusal) return { refusal };
  const application = await CampaignApplication.findOne({ _id: applicationId, campaign: campaign._id }).lean();
  if (!application) return { refusal: refuse(404, "APPLICATION_NOT_FOUND", "Application not found") };
  if (application.status !== "pending") {
    return { refusal: refuse(409, "NOT_PENDING", `This application is already ${application.status}`, { status: application.status }) };
  }
  return { campaign, application };
}

async function brandName(campaign) {
  const brand = await User.findById(campaign.businessId).select("name").lean();
  return (brand && brand.name) || "The brand";
}

async function approveApplication({ user, campaignId, applicationId }) {
  const { campaign, application, refusal } = await pendingApplication(user, campaignId, applicationId);
  if (refusal) return refusal;

  // Take the decision first so a withdraw, reject or second approve at the same moment
  // can't also win; give it back if no place can be reserved.
  const reviewedAt = new Date();
  const decided = await CampaignApplication.findOneAndUpdate(
    { _id: application._id, status: "pending" },
    { $set: { status: "approved", reviewedAt, reviewedBy: user._id, closedAt: reviewedAt } },
    { new: true }
  ).lean();
  if (!decided) return refuse(409, "NOT_PENDING", "This application was just decided or withdrawn");

  let reserved;
  try {
    reserved = await reservePlacementFor({ creatorId: application.creator, campaignId: campaign._id });
  } catch (error) {
    reserved = { status: 500, error };
  }
  if (reserved.status !== 200) {
    await CampaignApplication.updateOne(
      { _id: application._id, status: "approved", reviewedAt },
      { $set: { status: "pending", reviewedAt: null, reviewedBy: null, closedAt: null } }
    );
    if (reserved.error) throw reserved.error;
    const { code, failures } = reserved.body;
    if (code === "CAMPAIGN_FULL") {
      return refuse(409, "CAMPAIGN_FULL", "No places are left in this campaign. Add places or reject this applicant");
    }
    if (code === "NOT_ELIGIBLE") {
      return refuse(409, "CREATOR_CANNOT_JOIN", `This creator can't take a place right now: ${failures[0].message}`, { failures });
    }
    return refuse(reserved.status, code, reserved.body.error);
  }

  const name = await brandName(campaign);
  await notify({
    to: application.creator,
    role: "creator",
    campaign,
    type: "application_approved",
    title: "You've been selected",
    body: `${name} picked you for "${campaign.name}". Your place is reserved and the full brief is unlocked.`,
    email: true,
  });

  const placement = reserved.body;
  return {
    status: 200,
    body: {
      ...brandRow(decided),
      placement: {
        id: placement.id,
        kind: placement.kind,
        reward: placement.reward,
        viewTarget: placement.viewTarget,
        referralCode: placement.referralCode,
      },
      placesLeft: placement.placesLeft,
    },
  };
}

async function rejectApplication({ user, campaignId, applicationId, reason = "" }) {
  const { campaign, application, refusal } = await pendingApplication(user, campaignId, applicationId);
  if (refusal) return refusal;

  const reviewedAt = new Date();
  const decided = await CampaignApplication.findOneAndUpdate(
    { _id: application._id, status: "pending" },
    { $set: { status: "rejected", reviewedAt, reviewedBy: user._id, closedAt: reviewedAt, rejectionReason: reason || "" } },
    { new: true }
  ).lean();
  if (!decided) return refuse(409, "NOT_PENDING", "This application was just decided or withdrawn");

  await notify({
    to: application.creator,
    role: "creator",
    campaign,
    type: "application_rejected",
    title: "Application not selected",
    body: reason
      ? `Your application for "${campaign.name}" wasn't selected. The brand said: ${reason}`
      : `Your application for "${campaign.name}" wasn't selected this time.`,
    email: true,
  });

  return { status: 200, body: brandRow(decided) };
}

// ── Deadlines (D9) ───────────────────────────────────────────────────────────────────────

// Expires pending applications older than 7 days (telling the creator) and reminds each
// brand once about applications waiting 3 days or more. `now` is injectable for tests.
async function processApplicationDeadlines({ now = new Date() } = {}) {
  const expireBefore = new Date(now.getTime() - EXPIRE_AFTER_DAYS * DAY_MS);
  const remindBefore = new Date(now.getTime() - REMIND_AFTER_DAYS * DAY_MS);
  let expired = 0;
  let reminded = 0;

  const stale = await CampaignApplication.find({ status: "pending", appliedAt: { $lte: expireBefore } }).lean();
  for (const application of stale) {
    const closed = await CampaignApplication.findOneAndUpdate(
      { _id: application._id, status: "pending", appliedAt: application.appliedAt },
      { $set: { status: "expired", closedAt: now } },
      { new: true }
    ).lean();
    if (!closed) continue;
    expired += 1;
    const campaign = await Campaign.findById(application.campaign).select("name businessId").lean();
    if (!campaign) continue;
    await notify({
      to: application.creator,
      role: "creator",
      campaign,
      type: "application_expired",
      title: "Application expired",
      body: `Your application for "${campaign.name}" expired because the brand didn't review it within ${EXPIRE_AFTER_DAYS} days.`,
    });
  }

  const due = await CampaignApplication.find({
    status: "pending",
    remindedAt: null,
    appliedAt: { $lte: remindBefore, $gt: expireBefore },
  })
    .select("_id campaign")
    .lean();
  const byCampaign = new Map();
  for (const application of due) {
    const key = String(application.campaign);
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push(application._id);
  }
  for (const [campaignId, ids] of byCampaign) {
    // Claim each reminder so two runs at once never remind twice.
    let claimed = 0;
    for (const id of ids) {
      const res = await CampaignApplication.updateOne({ _id: id, status: "pending", remindedAt: null }, { $set: { remindedAt: now } });
      claimed += res.modifiedCount;
    }
    if (claimed === 0) continue;
    reminded += claimed;
    const campaign = await Campaign.findById(campaignId).select("name businessId").lean();
    if (!campaign) continue;
    const waiting = claimed === 1 ? "1 applicant is" : `${claimed} applicants are`;
    await notify({
      to: campaign.businessId,
      role: "business",
      campaign,
      type: "applications_reminder",
      title: "Applicants are waiting",
      body: `${waiting} waiting for your review on "${campaign.name}". Applications expire after ${EXPIRE_AFTER_DAYS} days without a decision.`,
      email: true,
    });
  }

  return { expired, reminded };
}

module.exports = {
  applyToCampaign,
  withdrawApplication,
  buildMyApplications,
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  processApplicationDeadlines,
  EXPIRE_AFTER_DAYS,
  REMIND_AFTER_DAYS,
};
