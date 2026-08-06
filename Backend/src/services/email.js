const fs = require("fs");
const path = require("path");

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

let logoDataUri = null;
try {
  const svgPath = path.join(__dirname, "../../../Fontend/packages/ui/src/assets/logo-primary.svg");
  const svgBuf = fs.readFileSync(svgPath);
  logoDataUri = `data:image/svg+xml;base64,${svgBuf.toString("base64")}`;
} catch {
  console.warn("[Email] Could not load logo SVG — emails will have no logo");
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("[Email] BREVO_API_KEY not set — skipping send");
    return { sent: false, reason: "no_api_key" };
  }

  const body = {
    sender: {
      name: process.env.EMAIL_FROM_NAME || "EasilyPromote",
      email: process.env.EMAIL_FROM || "easilypromote@gmail.com",
    },
    to: Array.isArray(to) ? to.map((addr) => ({ email: addr })) : [{ email: to }],
    subject,
    htmlContent: html,
    ...(text && { textContent: text }),
  };

  const res = await fetch(BREVO_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[Email] Brevo error ${res.status}: ${err}`);
    return { sent: false, error: err, status: res.status };
  }

  return { sent: true };
}

function otpEmail(otp, purpose) {
  const isReset = purpose === "forgot_password";
  const title = isReset ? "Reset Your Password" : "Verify Your Email";
  const intro = isReset
    ? "We received a request to reset your password."
    : "Thanks for signing up! Here's your verification code:";

  const logoTag = logoDataUri
    ? `<img src="${logoDataUri}" alt="EasilyPromote" width="48" height="48" style="display:block;width:48px;height:48px;margin-bottom:16px;" />`
    : `<div style="font-size:20px;font-weight:bold;color:#FEB604;margin-bottom:16px;">EasilyPromote</div>`;

  return {
    subject: isReset ? "EasilyPromote — Reset Password Code" : "EasilyPromote — Your Verification Code",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        ${logoTag}
        <h2 style="color:#111;margin-top:0;">${title}</h2>
        <p style="color:#333;font-size:15px;">${intro}</p>
        <div style="background:#f4f4f5;border-radius:8px;padding:20px;text-align:center;margin:24px 0;">
          <span style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#111;">${otp}</span>
        </div>
        <p style="color:#666;font-size:13px;">This code expires in <strong>5 minutes</strong>. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#999;font-size:12px;">EasilyPromote — Connect brands with creators.</p>
      </div>
    `,
    text: `${title}\n\nYour code: ${otp}\n\nExpires in 5 minutes.`,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function waitlistEmail(name) {
  const firstName = escapeHtml((name || "").trim().split(/\s+/)[0] || "there");

  const logoTag = logoDataUri
    ? `<img src="${logoDataUri}" alt="EasilyPromote" width="48" height="48" style="display:block;width:48px;height:48px;margin-bottom:16px;" />`
    : `<div style="font-size:20px;font-weight:bold;color:#FEB604;margin-bottom:16px;">EasilyPromote</div>`;

  return {
    subject: "You're on the EasilyPromote waitlist",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        ${logoTag}
        <h2 style="color:#111;margin-top:0;">You're on the list, ${firstName}</h2>
        <p style="color:#333;font-size:15px;">Thanks for joining the EasilyPromote waitlist.</p>
        <p style="color:#333;font-size:15px;">We'll let you know as soon as we go live so you can be among the first to match with creators.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
        <p style="color:#999;font-size:12px;">EasilyPromote — Connect brands with creators.</p>
      </div>
    `,
    text: `You're on the EasilyPromote waitlist, ${firstName}.\n\nWe'll let you know as soon as we're ready.`,
  };
}

module.exports = { sendEmail, otpEmail, waitlistEmail };
