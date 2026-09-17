// Application Required campaigns (ticket 06), mounted under /api/campaigns.
const express = require("express");
const { z } = require("zod");
const { protect, authorizeRoles } = require("../middleware/auth");
const { MAX_PITCH_LENGTH } = require("../models/CampaignApplication");
const applications = require("../services/applications");

const router = express.Router();

const send = (res, result) => res.status(result.status).json(result.body);
const invalid = (res, parsed) =>
  res.status(400).json({ error: parsed.error.errors[0].message, code: "INVALID_INPUT" });

const applySchema = z.object({
  pitch: z.string().trim().max(MAX_PITCH_LENGTH, `Keep your pitch under ${MAX_PITCH_LENGTH} characters`).optional(),
  // M8 batch 7: usage rights acceptance (SPEC D30).
  usageRightsAccepted: z.object({ version: z.number() }).optional(),
});
const rejectSchema = z.object({
  reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
});

router.post("/:id/apply", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    const parsed = applySchema.safeParse(req.body || {});
    if (!parsed.success) return invalid(res, parsed);
    send(res, await applications.applyToCampaign({ user: req.user, campaignId: req.params.id, pitch: parsed.data.pitch, usageRightsAccepted: parsed.data.usageRightsAccepted }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/apply/withdraw", protect, authorizeRoles("creator"), async (req, res, next) => {
  try {
    send(res, await applications.withdrawApplication({ user: req.user, campaignId: req.params.id }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/applications", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const { status, sort } = req.query;
    send(res, await applications.listApplications({ user: req.user, campaignId: req.params.id, status, sort }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/applications/:applicationId", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    send(res, await applications.getApplication({ user: req.user, campaignId: req.params.id, applicationId: req.params.applicationId }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/applications/:applicationId/approve", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    send(res, await applications.approveApplication({ user: req.user, campaignId: req.params.id, applicationId: req.params.applicationId }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/applications/:applicationId/reject", protect, authorizeRoles("business"), async (req, res, next) => {
  try {
    const parsed = rejectSchema.safeParse(req.body || {});
    if (!parsed.success) return invalid(res, parsed);
    send(
      res,
      await applications.rejectApplication({
        user: req.user,
        campaignId: req.params.id,
        applicationId: req.params.applicationId,
        reason: parsed.data.reason,
      })
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
