// What must still be true after the concurrent joins, applies and approvals: no double-booked
// places, no overfilled or over-promised campaigns, no creator over the active placement limit,
// and approvals and places that agree. Each check returns the offending rows (empty is good).
const path = require("node:path");
const mongoose = require("mongoose");

const SRC = path.join(__dirname, "..", "..", "src");
const model = (name) => require(path.join(SRC, "models", name));
const { HELD_PLACEMENT_STATUSES, ACTIVE_PLACEMENT_STATUSES, MAX_ACTIVE_PLACEMENTS } = require(path.join(SRC, "utils", "placementStatuses"));

const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function checkInvariants({ raceJoin, raceApprove }) {
  const Slot = model("Slot");
  const Campaign = model("Campaign");
  const CampaignApplication = model("CampaignApplication");

  const [doubleBooked, inconsistentSlots, overLimit, overPromised, duplicateApplications] = await Promise.all([
    // One creator holding two places in one campaign.
    Slot.aggregate([
      { $match: { creatorId: { $type: "objectId" }, status: { $in: HELD_PLACEMENT_STATUSES } } },
      { $group: { _id: { campaignId: "$campaignId", creatorId: "$creatorId" }, places: { $sum: 1 } } },
      { $match: { places: { $gt: 1 } } },
    ]),
    // An open place with a creator, or a held place without one.
    Slot.find({
      $or: [
        { status: "available", creatorId: { $type: "objectId" } },
        { status: { $in: HELD_PLACEMENT_STATUSES }, creatorId: null },
      ],
    })
      .select("campaignId creatorId status")
      .lean(),
    // More active placements than the account-wide limit.
    Slot.aggregate([
      { $match: { status: { $in: ACTIVE_PLACEMENT_STATUSES }, creatorId: { $type: "objectId" } } },
      { $group: { _id: "$creatorId", active: { $sum: 1 } } },
      { $match: { active: { $gt: MAX_ACTIVE_PLACEMENTS } } },
    ]),
    // Held places promising more than the campaign's creator pool.
    Slot.aggregate([
      { $match: { status: { $in: HELD_PLACEMENT_STATUSES } } },
      { $group: { _id: "$campaignId", promised: { $sum: "$reward" }, held: { $sum: 1 } } },
      { $lookup: { from: "campaigns", localField: "_id", foreignField: "_id", as: "campaign" } },
      { $unwind: "$campaign" },
      { $match: { $expr: { $gt: ["$promised", { $ifNull: ["$campaign.creatorPool", 0] }] } } },
      { $project: { promised: 1, held: 1, creatorPool: "$campaign.creatorPool" } },
    ]),
    CampaignApplication.aggregate([
      { $group: { _id: { campaign: "$campaign", creator: "$creator" }, rows: { $sum: 1 } } },
      { $match: { rows: { $gt: 1 } } },
    ]),
  ]);

  // Race campaigns have exactly 5 places each and more demand than places: they must end full,
  // never over.
  const raceIds = [...raceJoin, ...raceApprove].map((c) => oid(c.id));
  const raceCounts = await Slot.aggregate([
    { $match: { campaignId: { $in: raceIds } } },
    {
      $group: {
        _id: "$campaignId",
        places: { $sum: 1 },
        held: { $sum: { $cond: [{ $in: ["$status", HELD_PLACEMENT_STATUSES] }, 1, 0] } },
      },
    },
  ]);
  const overfilled = raceCounts.filter((c) => c.held > c.places || c.places !== 5);
  const notFilled = raceCounts.filter((c) => c.held < c.places);

  // Approvals and places agree on Application Required race campaigns: every approved applicant
  // holds a place, and every place is held by an approved applicant.
  const approveIds = raceApprove.map((c) => oid(c.id));
  const [approvedApps, heldApproveSlots] = await Promise.all([
    CampaignApplication.find({ campaign: { $in: approveIds }, status: "approved" }).select("campaign creator").lean(),
    Slot.find({ campaignId: { $in: approveIds }, status: { $in: HELD_PLACEMENT_STATUSES } }).select("campaignId creatorId").lean(),
  ]);
  const heldKeys = new Set(heldApproveSlots.map((s) => `${s.campaignId}:${s.creatorId}`));
  const approvedKeys = new Set(approvedApps.map((a) => `${a.campaign}:${a.creator}`));
  const approvedWithoutPlace = approvedApps.filter((a) => !heldKeys.has(`${a.campaign}:${a.creator}`));
  const placeWithoutApproval = heldApproveSlots.filter((s) => !approvedKeys.has(`${s.campaignId}:${s.creatorId}`));

  const liveCampaigns = await Campaign.countDocuments({ status: "live" });

  const checks = [
    { name: "No creator holds two places in one campaign", violations: doubleBooked },
    { name: "Open places have no creator; held places have one", violations: inconsistentSlots },
    { name: `No creator has more than ${MAX_ACTIVE_PLACEMENTS} active placements`, violations: overLimit },
    { name: "Held places never promise more than the creator pool", violations: overPromised },
    { name: "One application per creator per campaign", violations: duplicateApplications },
    { name: "Race campaigns never overfill (5 places each)", violations: overfilled },
    { name: "Every approved applicant holds a place", violations: approvedWithoutPlace },
    { name: "Every place on an Application Required race campaign belongs to an approved applicant", violations: placeWithoutApproval },
  ];
  return {
    ok: checks.every((c) => c.violations.length === 0),
    checks,
    info: { liveCampaigns, raceCampaignsFilled: raceCounts.length - notFilled.length, raceCampaigns: raceCounts.length },
  };
}

module.exports = { checkInvariants };
