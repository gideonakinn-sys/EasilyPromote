const express = require("express");
const { z } = require("zod");
const Waitlist = require("../models/Waitlist");
const { protect, authorizeRoles } = require("../middleware/auth");
const { sendEmail, waitlistEmail } = require("../services/email");

const router = express.Router();

const adminGuard = [protect, authorizeRoles("admin", "super_admin", "finance_admin", "support")];

const joinSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
});

// ─── POST /api/waitlist (public) ──────────────────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    const data = joinSchema.parse(req.body);

    const existing = await Waitlist.findOne({ email: data.email });
    if (existing) {
      return res.status(409).json({ error: "You're already on the waitlist" });
    }

    const entry = await Waitlist.create({ name: data.name, email: data.email });

    // Fire-and-forget email notification; never fail signup because of it.
    sendEmail({ to: entry.email, ...waitlistEmail(entry.name) })
      .then((result) => {
        if (result.sent) {
          Waitlist.updateOne({ _id: entry._id }, { $set: { emailSent: true } }).catch(() => {});
        }
      })
      .catch((err) => {
        console.error("[Waitlist] Email send failed:", err.message);
      });

    res.status(201).json({
      id: entry._id,
      name: entry.name,
      email: entry.email,
      status: entry.status,
      createdAt: entry.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/waitlist (admin) ────────────────────────────────────────────────
router.get("/", adminGuard, async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = search
      ? {
          $or: [
            { name: { $regex: String(search), $options: "i" } },
            { email: { $regex: String(search), $options: "i" } },
          ],
        }
      : {};

    const entries = await Waitlist.find(filter).sort({ createdAt: -1 });

    res.json({
      entries: entries.map((e) => ({
        id: e._id,
        name: e.name,
        email: e.email,
        status: e.status,
        emailSent: e.emailSent,
        createdAt: e.createdAt,
      })),
      total: entries.length,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
