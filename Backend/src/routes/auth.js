const express = require("express");
const { z } = require("zod");
const User = require("../models/User");
const BusinessProfile = require("../models/BusinessProfile");
const CreatorProfile = require("../models/CreatorProfile");
const { generateToken, generateRefreshToken, verifyToken } = require("../utils/jwt");
const { protect } = require("../middleware/auth");
const { storeOTP, verifyOTP } = require("../config/otp");
const { sendEmail, otpEmail } = require("../services/email");

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  businessName: z.string().min(1).max(100).optional(),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  industry: z.string().optional(),
  role: z.enum(["business", "creator"]).default("business"),
  companyName: z.string().optional(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  nickname: z.string().optional(),
  displayName: z.string().optional(),
}).refine((data) => data.name || data.businessName || data.firstName || data.lastName || data.nickname, {
  message: "Either name or businessName is required",
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const sendOtpSchema = z.object({
  email: z.string().email(),
  purpose: z.enum(["registration", "forgot_password"]),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  purpose: z.enum(["registration", "forgot_password"]),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post("/register", async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);

    const existing = await User.findOne({ email: data.email });
    if (existing) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const displayName = data.name || data.businessName || data.displayName || `${data.firstName || ""} ${data.lastName || ""}`.trim() || data.nickname;

    const user = await User.create({
      name: displayName,
      email: data.email,
      password: data.password,
      role: data.role,
    });

    if (data.role === "business") {
      await BusinessProfile.create({
        userId: user._id,
        companyName: data.companyName || data.businessName || displayName,
        industry: data.industry || undefined,
        phone: data.phone || undefined,
      });
    } else if (data.role === "creator") {
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim();
      const creatorUsername =
        data.username ||
        (data.nickname || data.name || fullName || data.email.split("@")[0])
          .toLowerCase()
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "");
      await CreatorProfile.create({
        userId: user._id,
        username: creatorUsername,
        displayName: data.nickname || fullName || data.name || displayName,
      });
    }

    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        emailVerified: false,
        ...(data.role === "business" && { industry: data.industry, companyName: data.companyName || data.businessName || displayName, phone: data.phone }),
        ...(data.role === "creator" && { username: data.username || displayName.toLowerCase().replace(/\s+/g, "_"), displayName: data.nickname || `${data.firstName || ""} ${data.lastName || ""}`.trim() || displayName }),
      },
      token,
      refreshToken,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    let profile = null;
    if (user.role === "business") {
      profile = await BusinessProfile.findOne({ userId: user._id });
    } else if (user.role === "creator") {
      profile = await CreatorProfile.findOne({ userId: user._id });
    }

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        emailVerified: user.emailVerified,
        ...(profile && user.role === "business" && {
          industry: profile.industry,
          phone: profile.phone,
          companyName: profile.companyName,
          logo: profile.logo,
        }),
        ...(profile && user.role === "creator" && {
          username: profile.username,
        }),
      },
      token,
      refreshToken,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/send-otp", async (req, res, next) => {
  try {
    const { email, purpose } = sendOtpSchema.parse(req.body);

    const otp = storeOTP(email, purpose);

    console.log(`[OTP] ${purpose} code for ${email}: ${otp}`);

    const emailContent = otpEmail(otp, purpose);
    const result = await sendEmail({ to: email, ...emailContent });
    if (!result.sent) {
      console.error(`[OTP] Email send failed for ${email}:`, result);
    }

    res.json({ message: `OTP sent to ${email}` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/verify-otp", async (req, res, next) => {
  try {
    const { email, otp, purpose } = verifyOtpSchema.parse(req.body);

    const result = verifyOTP(email, purpose, otp);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    if (purpose === "registration") {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ error: "No account found. Please register first." });
      }

      user.emailVerified = true;
      await user.save();

      const token = generateToken(user);
      const refreshToken = generateRefreshToken(user);

      res.json({
        message: "Email verified",
        token,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          emailVerified: true,
        },
      });
    } else if (purpose === "forgot_password") {
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ error: "No account found with this email" });
      }

      const resetToken = generateToken({ _id: user._id, role: user.role });

      res.json({
        message: "OTP verified",
        resetToken,
        email,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ message: "If an account exists, a reset code has been sent" });
    }

    const otp = storeOTP(email, "forgot_password");

    console.log(`[OTP] forgot_password code for ${email}: ${otp}`);

    const emailContent = otpEmail(otp, "forgot_password");
    const result = await sendEmail({ to: email, ...emailContent });
    if (!result.sent) {
      console.error(`[ForgotPassword] Email send failed for ${email}:`, result);
    }

    res.json({ message: `If an account exists, a reset code has been sent to ${email}` });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { email, token, newPassword } = resetPasswordSchema.parse(req.body);

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    try {
      const decoded = verifyToken(token, process.env.JWT_SECRET);
      if (decoded.id !== user._id.toString()) {
        return res.status(400).json({ error: "Invalid reset token" });
      }
    } catch {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    const decoded = verifyToken(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const token = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({ token, refreshToken: newRefreshToken });
  } catch (error) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }
});

router.get("/me", protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let profile = null;
    if (user.role === "business") {
      profile = await BusinessProfile.findOne({ userId: user._id });
    } else if (user.role === "creator") {
      profile = await CreatorProfile.findOne({ userId: user._id });
    }

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      walletBalance: user.walletBalance,
      avatar: user.avatar,
      ...(profile && user.role === "business" && {
        industry: profile.industry,
        phone: profile.phone,
        companyName: profile.companyName,
        logo: profile.logo,
        website: profile.website,
        description: profile.description,
        verificationStatus: profile.verificationStatus,
      }),
      ...(profile && user.role === "creator" && {
        username: profile.username,
        displayName: profile.displayName,
        bio: profile.bio,
        country: profile.country,
        rank: profile.rank,
        creatorScore: profile.creatorScore,
        lifetimeEarnings: profile.lifetimeEarnings,
        completionRate: profile.completionRate,
        socialAccounts: profile.socialAccounts,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/me", protect, async (req, res, next) => {
  try {
    const { avatar, name } = req.body;
    const updates = {};
    if (avatar !== undefined) updates.avatar = avatar;
    if (name !== undefined && typeof name === "string" && name.trim()) updates.name = name.trim();

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
