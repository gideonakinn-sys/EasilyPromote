// Application Required campaigns (ticket 06): apply, withdraw, brand review, approve / reject,
// and the D9 deadlines (brand reminded on day 3, pending applications expire after 7 days).
// Creator Approval lives on CampaignApplication only; nothing here reads or writes a
// Submission (ADR 0002). Handlers return { status, body } so routes stay thin.
const Campaign = require("../models/Campaign");
const CampaignApplication = require("../models/CampaignApplication");
const Notification = require("../models/Notification");
const Slot = require("../models/Slot");
const User = require("../models/User");
const CreatorProfile = require("../models/CreatorProfile");
const { emitToUser } = require("../config/socket");
const { sendEmail } = require("./email");
const { refuse, loadJoinContext, checkJoiner, reservePlacementFor } = require("./placements");
const { buildApplicantSnapshot, orderSnapshot } = require("./applicantSnapshot");
const { campaignTerms, payPerUnit } = require("../utils/campaignPay");
const { HELD_PLACEMENT_STATUSES } = require("../utils/placementStatuses");
const { publicRating } = require("../utils/creatorProfile");

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRE_AFTER_DAYS = 7;
const REMIND_AFTER_DAYS = 3;
// An approval takes the decision before the place; give it this long before calling it stranded.
const REPAIR_GRACE_MS = 10 * 60 * 1000;
const REPAIR_WINDOW_MS = 2 * DAY_MS;
const CLOSED_CAMPAIGN_STATUSES = ["completed", "cancelled"];
const STATUSES = CampaignApplication.APPLICATION_STATUSES;
// A creator may apply again after withdrawing or when an application expired unreviewed.
const REOPENABLE = ["withdrawn", "expired"];
const CAMPAIGN_FIELDS_FOR_PAY = "name status businessId coverImageUrl contentPay hybridBonus payShape campaignModel campaignObjective objective referral creatorAccess";

const expiresAt = (application) => new Date(new Date(application.appliedAt).getTime() + EXPIRE_AFTER_DAYS * DAY_MS);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// In-app notification, live socket update and optional email, each on its own so one
// failing channel never blocks another or the decision that caused it. The email is sent
// in the background. Returns whether the in-app notification was saved.
async function notify({ to, role, campaign, type, title, body, email, socketPayload = {} }) {
  let saved = false;
  try {
    await Notification.create({
      ...(role === "business" ? { businessId: to } : { creatorId: to }),
      campaignId: campaign._id,
      type,
      title,
      body,
    });
    saved = true;
  } catch (error) {
    console.error(`[Applications] In-app notification ${type} for ${to} failed:`, error.message);
  }

  try {
    emitToUser(to, "application-update", { campaignId: String(campaign._id), type, ...socketPayload });
  } catch (error) {
    console.error(`[Applications] Socket update ${type} for ${to} failed:`, error.message);
  }

  if (email) {
    User.findById(to)
      .select("email")
      .lean()
      .then((user) =>
        user && user.email
          ? sendEmail({
              to: user.email,
              subject: title,
              html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;"><h2 style="color:#111;margin-top:0;">${escapeHtml(title)}</h2><p style="color:#333;font-size:15px;">${escapeHtml(body)}</p><p style="color:#999;font-size:12px;">EasilyPromote — Connect brands with creators.</p></div>`,
              text: `${title}\n\n${body}`,
            })
          : null
      )
      .catch((error) => console.error(`[Applications] Email ${type} for ${to} failed:`, error.message));
  }

  return saved;
}

function emitSafely(userId, payload) {
  try {
    emitToUser(userId, "application-update", payload);
  } catch (error) {
    console.error("[Applications] Socket update failed:", error.message);
  }
}

// ── Creator ──────────────────────────────────────────────────────────────────────────────

const ALREADY_APPLIED_MESSAGES = {
  pending: "You've already applied. The brand is reviewing applications",
  approved: "You've already been selected for this campaign",
  rejected: "The brand has already reviewed your application for this campaign",
};

async function applyToCampaign({ user, campaignId, pitch = "", usageRightsAccepted }) {
  const creatorId = user._id;
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || campaign.status !== "live") return refuse(404, "CAMPAIGN_NOT_LIVE", "Campaign not found or not live");
  if (campaignTerms(campaign).creatorAccess !== "application_required") {
    return refuse(409, "OPEN_CALL", "This campaign is an Open Call. Join it instead of applying");
  }

  const [existing, context, account] = await Promise.all([
    CampaignApplication.findOne({ campaign: campaign._id, creator: creatorId }).lean(),
    loadJoinContext({ creatorId, campaign }),
    User.findById(creatorId).select("name avatar").lean(),
  ]);
  if (context.heldSlot) return refuse(409, "ALREADY_JOINED", "You already have a place in this campaign");
  if (existing && !REOPENABLE.includes(existing.status)) {
    return refuse(409, "ALREADY_APPLIED", ALREADY_APPLIED_MESSAGES[existing.status], { status: existing.status });
  }
  if (context.available.length === 0) return refuse(409, "CAMPAIGN_FULL", "This campaign has no places left");

  // The same check as joining and as approval (so the brand can pick anyone who applied).
  const check = checkJoiner({ context, campaign, pickedByBrand: true });
  if (!check.eligible) {
    return refuse(403, "NOT_ELIGIBLE", check.failures[0].message, { failures: check.failures });
  }

  // M8 batch 7: validate usage rights acceptance (SPEC D30).
  const rightsSet = campaign.usageRights && campaign.usageRights.type === "custom";
  if (rightsSet) {
    if (!usageRightsAccepted || usageRightsAccepted.version !== campaign.usageRights.version) {
      return refuse(400, "USAGE_TERMS_NOT_ACCEPTED", "Accept the campaign's usage rights terms before applying");
    }
  }

  const fields = {
    status: "pending",
    pitch: pitch || "",
    applicantSnapshot: buildApplicantSnapshot(context.joiner.profile, account),
    matchScore: check.matchScore,
    appliedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: "",
    remindedAt: null,
    closedAt: null,
    ...(rightsSet ? { usageRightsAccepted: { version: usageRightsAccepted.version, acceptedAt: new Date() } } : {}),
  };

  let application;
  try {
    application = existing
      ? await CampaignApplication.findOneAndUpdate({ _id: existing._id, status: { $in: REOPENABLE } }, { $set: fields }, { new: true }).lean()
      : (await CampaignApplication.create({ campaign: campaign._id, creator: creatorId, ...fields })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    application = null;
  }
  if (!application) return refuse(409, "ALREADY_APPLIED", ALREADY_APPLIED_MESSAGES.pending);

  emitSafely(campaign.businessId, { campaignId: String(campaign._id), type: "application_received" });
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
  const campaign = await Campaign.findById(campaignId).select(CAMPAIGN_FIELDS_FOR_PAY).lean();
  if (campaign) emitSafely(campaign.businessId, { campaignId: String(campaign._id), type: "application_withdrawn" });
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
    .populate({ path: "campaign", select: CAMPAIGN_FIELDS_FOR_PAY, populate: { path: "businessId", select: "name avatar" } })
    .sort({ appliedAt: -1 })
    .lean();
  return myApplicationsFrom(applications);
}

// "My applications" from applications (newest first) whose campaign and its brand are loaded
// with CAMPAIGN_FIELDS_FOR_PAY and "name avatar".
function myApplicationsFrom(applications) {
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

// The brand's own campaign, and one of its applications when `applicationId` is given
// (only a pending one with `pendingOnly`). Returns { campaign, application } or { refusal }.
async function loadForBrand({ user, campaignId, applicationId, pendingOnly = false }) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) return { refusal: refuse(404, "CAMPAIGN_NOT_FOUND", "Campaign not found") };
  if (String(campaign.businessId) !== String(user._id)) return { refusal: refuse(403, "NOT_AUTHORIZED", "Not authorized") };
  if (!applicationId) return { campaign };

  const application = await CampaignApplication.findOne({ _id: applicationId, campaign: campaign._id }).lean();
  if (!application) return { refusal: refuse(404, "APPLICATION_NOT_FOUND", "Application not found") };
  if (pendingOnly && application.status !== "pending") {
    return { refusal: refuse(409, "NOT_PENDING", `This application is already ${application.status}`, { status: application.status }) };
  }
  return { campaign, application };
}

// Badges and brand rating are the creator's current ones, not frozen in the snapshot: they're
// earned and lost over time and the brand is deciding now (M8, D24/D25). Map of creatorId → standing.
async function currentStanding(creatorIds) {
  const profiles = await CreatorProfile.find({ userId: { $in: creatorIds } }).select("userId badges brandRating").lean();
  return new Map(profiles.map((p) => [String(p.userId), { badges: p.badges || [], rating: publicRating(p.brandRating) }]));
}

function brandRow(application, standing = new Map()) {
  const s = application.applicantSnapshot || {};
  const live = standing.get(String(application.creator)) || { badges: s.badges || [], rating: s.rating || { average: null, count: 0 } };
  return {
    id: application._id,
    status: application.status,
    pitch: application.pitch || "",
    matchScore: application.matchScore || 0,
    appliedAt: application.appliedAt,
    expiresAt: application.status === "pending" ? expiresAt(application) : null,
    reviewedAt: application.reviewedAt || null,
    rejectionReason: application.rejectionReason || "",
    // M8 batch 7: the usage-rights version accepted when applying (SPEC D30).
    usageRightsAccepted:
      application.usageRightsAccepted && application.usageRightsAccepted.acceptedAt
        ? { version: application.usageRightsAccepted.version, acceptedAt: application.usageRightsAccepted.acceptedAt }
        : null,
    creator: {
      id: application.creator,
      name: s.name || "",
      username: s.username || "",
      photo: s.photo || null,
      verified: Boolean(s.verified),
      location: s.location || null,
      topPlatform: (s.platforms && s.platforms[0]) || null,
      categories: s.categories || [],
      badges: live.badges,
      rating: live.rating,
    },
  };
}

async function listApplications({ user, campaignId, status, sort = "match" }) {
  const { campaign, refusal } = await loadForBrand({ user, campaignId });
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
  const standing = await currentStanding(applications.map((a) => a.creator));
  return { status: 200, body: { counts, applications: applications.map((a) => brandRow(a, standing)) } };
}

async function getApplication({ user, campaignId, applicationId }) {
  const { campaign, application, refusal } = await loadForBrand({ user, campaignId, applicationId });
  if (refusal) return refusal;
  const standing = await currentStanding([application.creator]);
  const row = brandRow(application, standing);
  const sections = orderSnapshot(campaign, application.applicantSnapshot).sections.map((section) =>
    section.key === "badges" ? { ...section, data: { ...section.data, badges: row.creator.badges, rating: row.creator.rating } } : section
  );
  return {
    status: 200,
    body: {
      ...row,
      applicant: application.applicantSnapshot,
      sections,
    },
  };
}

// `user` is the brand acting on its own campaign when it's already loaded (the request's user).
async function brandName(campaign, user = null) {
  if (user && String(user._id) === String(campaign.businessId) && user.name) return user.name;
  const brand = await User.findById(campaign.businessId).select("name").lean();
  return (brand && brand.name) || "The brand";
}

async function approveApplication({ user, campaignId, applicationId }) {
  const { campaign, application, refusal } = await loadForBrand({ user, campaignId, applicationId, pendingOnly: true });
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

  const undo = () =>
    CampaignApplication.updateOne(
      { _id: application._id, status: "approved", reviewedAt },
      { $set: { status: "pending", reviewedAt: null, reviewedBy: null, closedAt: null } }
    );

  let reserved;
  try {
    reserved = await reservePlacementFor({ creatorId: application.creator, campaignId: campaign._id });
  } catch (error) {
    await undo();
    throw error;
  }
  if (reserved.status !== 200) {
    await undo();
    const { code, failures } = reserved.body;
    if (code === "CAMPAIGN_NOT_LIVE") {
      return refuse(409, "CAMPAIGN_NOT_LIVE", "This campaign isn't live any more, so no place can be reserved. The application is still pending");
    }
    if (code === "CAMPAIGN_FULL") {
      return refuse(409, "CAMPAIGN_FULL", "No places are left in this campaign. Add places or reject this applicant");
    }
    if (code === "NOT_ELIGIBLE") {
      return refuse(409, "CREATOR_CANNOT_JOIN", `This creator can't take a place right now: ${failures[0].message}`, { failures });
    }
    return refuse(reserved.status, code, reserved.body.error);
  }

  const placement = reserved.body;
  const name = await brandName(campaign, user).catch(() => "The brand");
  await notify({
    to: application.creator,
    role: "creator",
    campaign,
    type: "application_approved",
    title: "You've been selected",
    body: `${name} picked you for "${campaign.name}". Your place is reserved and the full brief is unlocked.`,
    email: true,
    // Enough for the creator's screen to unlock the brief without a reload.
    socketPayload: {
      applicationId: String(decided._id),
      status: "approved",
      placement: { id: String(placement.id), kind: placement.kind, reward: placement.reward, referralCode: placement.referralCode },
      brief: placement.brief,
    },
  });
  emitSafely(campaign.businessId, { campaignId: String(campaign._id), type: "application_approved" });

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
      brief: placement.brief,
    },
  };
}

async function rejectApplication({ user, campaignId, applicationId, reason = "" }) {
  const { campaign, application, refusal } = await loadForBrand({ user, campaignId, applicationId, pendingOnly: true });
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
    socketPayload: { applicationId: String(decided._id), status: "rejected" },
  });
  emitSafely(campaign.businessId, { campaignId: String(campaign._id), type: "application_rejected" });

  return { status: 200, body: brandRow(decided) };
}

// ── Deadlines (D9) ───────────────────────────────────────────────────────────────────────

// An approval whose place never got reserved (the process died between the two steps)
// goes back to pending so the brand can approve it again.
async function repairStrandedApprovals(now) {
  const approved = await CampaignApplication.find({
    status: "approved",
    reviewedAt: { $lte: new Date(now.getTime() - REPAIR_GRACE_MS), $gte: new Date(now.getTime() - REPAIR_WINDOW_MS) },
  })
    .select("_id campaign creator reviewedAt")
    .lean();
  if (approved.length === 0) return 0;

  const held = await Slot.find({
    status: { $in: HELD_PLACEMENT_STATUSES },
    $or: approved.map((a) => ({ campaignId: a.campaign, creatorId: a.creator })),
  })
    .select("campaignId creatorId")
    .lean();
  const holding = new Set(held.map((s) => `${s.campaignId}:${s.creatorId}`));

  let repaired = 0;
  for (const application of approved) {
    if (holding.has(`${application.campaign}:${application.creator}`)) continue;
    const res = await CampaignApplication.updateOne(
      { _id: application._id, status: "approved", reviewedAt: application.reviewedAt },
      { $set: { status: "pending", reviewedAt: null, reviewedBy: null, closedAt: null } }
    );
    if (res.modifiedCount) {
      repaired += 1;
      console.warn(`[Applications] Application ${application._id} was approved without a place; back to pending`);
    }
  }
  return repaired;
}

// Repairs stranded approvals; expires pending applications older than 7 days or on a
// completed / cancelled campaign (telling the creator); reminds each live campaign's brand
// once about applications waiting 3 days or more. `now` is injectable for tests.
async function processApplicationDeadlines({ now = new Date() } = {}) {
  const repaired = await repairStrandedApprovals(now);
  const expireBefore = now.getTime() - EXPIRE_AFTER_DAYS * DAY_MS;
  const remindBefore = now.getTime() - REMIND_AFTER_DAYS * DAY_MS;

  const pending = await CampaignApplication.find({ status: "pending" }).select("_id campaign creator appliedAt remindedAt").lean();
  const campaignIds = [...new Set(pending.map((a) => String(a.campaign)))];
  const campaigns = new Map(
    (campaignIds.length ? await Campaign.find({ _id: { $in: campaignIds } }).select("name status businessId").lean() : []).map((c) => [String(c._id), c])
  );

  let expired = 0;
  const reminders = new Map();
  for (const application of pending) {
    const campaign = campaigns.get(String(application.campaign));
    const closed = !campaign || CLOSED_CAMPAIGN_STATUSES.includes(campaign.status);
    const applied = new Date(application.appliedAt).getTime();

    if (closed || applied <= expireBefore) {
      const done = await CampaignApplication.findOneAndUpdate(
        { _id: application._id, status: "pending", appliedAt: application.appliedAt },
        { $set: { status: "expired", closedAt: now } }
      ).lean();
      if (!done) continue;
      expired += 1;
      if (!campaign) continue;
      await notify({
        to: application.creator,
        role: "creator",
        campaign,
        type: "application_expired",
        title: "Application expired",
        body: closed
          ? `Your application for "${campaign.name}" closed because the campaign has ended.`
          : `Your application for "${campaign.name}" expired because the brand didn't review it within ${EXPIRE_AFTER_DAYS} days.`,
      });
      continue;
    }

    if (campaign.status === "live" && !application.remindedAt && applied <= remindBefore) {
      const key = String(campaign._id);
      if (!reminders.has(key)) reminders.set(key, { campaign, ids: [] });
      reminders.get(key).ids.push(application._id);
    }
  }

  let reminded = 0;
  for (const { campaign, ids } of reminders.values()) {
    const waiting = ids.length === 1 ? "1 applicant is" : `${ids.length} applicants are`;
    const saved = await notify({
      to: campaign.businessId,
      role: "business",
      campaign,
      type: "applications_reminder",
      title: "Applicants are waiting",
      body: `${waiting} waiting for your review on "${campaign.name}". Applications expire after ${EXPIRE_AFTER_DAYS} days without a decision.`,
      email: true,
    });
    // Only a reminder the brand can actually see counts as sent; otherwise try next run.
    if (!saved) continue;
    const res = await CampaignApplication.updateMany({ _id: { $in: ids }, status: "pending", remindedAt: null }, { $set: { remindedAt: now } });
    reminded += res.modifiedCount;
  }

  return { expired, reminded, repaired };
}

module.exports = {
  applyToCampaign,
  withdrawApplication,
  buildMyApplications,
  myApplicationsFrom,
  CAMPAIGN_FIELDS_FOR_PAY,
  listApplications,
  getApplication,
  approveApplication,
  rejectApplication,
  processApplicationDeadlines,
  EXPIRE_AFTER_DAYS,
  REMIND_AFTER_DAYS,
};
