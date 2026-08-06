const express = require("express");
const cors = require("cors");
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
const waitlistRoutes = require("./routes/waitlist");

const app = express();

const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003")
  .split(",")
  .map((o) => o.trim());

const isDev = process.env.NODE_ENV === "development";

app.use(helmet());
app.use(
  cors({
    origin: isDev ? true : (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
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
app.use("/api/waitlist", waitlistRoutes);

app.use(errorHandler);

module.exports = app;
