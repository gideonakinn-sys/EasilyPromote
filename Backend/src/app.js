const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth");
const businessRoutes = require("./routes/businesses");
const creatorRoutes = require("./routes/creators");
const campaignRoutes = require("./routes/campaigns");
const slotRoutes = require("./routes/slots");
const uploadRoutes = require("./routes/upload");
const submissionRoutes = require("./routes/submissions");
const payoutRoutes = require("./routes/payouts");
const notificationRoutes = require("./routes/notifications");
const webhookRoutes = require("./routes/webhooks");
const adminRoutes = require("./routes/admin");
const platformRoutes = require("./routes/platforms");
const nicheRoutes = require("./routes/niches");
const industryRoutes = require("./routes/industries");
const tiktokRoutes = require("./routes/tiktok");
const metaRoutes = require("./routes/meta");
const waitlistRoutes = require("./routes/waitlist");

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003")
  .split(",")
  .map((o) => o.trim());

const isDev = process.env.NODE_ENV === "development";

app.use(helmet());
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isDev || !origin) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  }

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  }

  console.error(`[CORS] Blocked origin: ${origin} (allowed: ${allowedOrigins.join(", ")})`);
  return res.status(403).json({ error: `Origin "${origin}" is not allowed by CORS` });
});
app.use(morgan("dev"));

app.use("/api/webhooks", webhookRoutes);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessRoutes);
app.use("/api/creators", creatorRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/slots", slotRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/platforms", platformRoutes);
app.use("/api/niches", nicheRoutes);
app.use("/api/industries", industryRoutes);
app.use("/api/tiktok", tiktokRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/waitlist", waitlistRoutes);

app.use(errorHandler);

module.exports = app;
