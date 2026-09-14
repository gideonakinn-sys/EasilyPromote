#!/usr/bin/env node
// Sign and send a conversion webhook, exactly as a brand's server would.
//
//   node scripts/sendTestConversion.js --url http://localhost:5000 --key-id key_… --secret whsec_… \
//     --code ACME-TUNDE [--event signup] [--event-id abc] [--test] [--stale] [--bad-signature]

const crypto = require("crypto");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing = ["url", "key-id", "secret"].filter((name) => !args[name]);
  if (missing.length || (!args.code && !args.test)) {
    console.error(
      "Usage: node scripts/sendTestConversion.js --url <api base> --key-id <key_…> --secret <whsec_…> " +
        "--code <CODE> [--event signup] [--event-id id] [--test] [--stale] [--bad-signature]"
    );
    process.exit(1);
  }

  const body = JSON.stringify({
    event_id: args["event-id"] || `test-${crypto.randomUUID()}`,
    code: args.code || "TEST",
    event: args.event || "signup",
    timestamp: new Date().toISOString(),
    ...(args.test ? { test: true } : {}),
  });

  // --stale signs with a timestamp 10 minutes old to exercise replay protection.
  const t = Math.floor(Date.now() / 1000) - (args.stale ? 600 : 0);
  const secret = args["bad-signature"] ? `${args.secret}x` : args.secret;
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

  const url = `${String(args.url).replace(/\/$/, "")}/api/webhooks/conversions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-EP-Key-Id": args["key-id"],
      "X-EP-Signature": `t=${t},v1=${v1}`,
    },
    body,
  });

  console.log(`> POST ${url}`);
  console.log(`> ${body}`);
  console.log(`< ${response.status} ${await response.text()}`);
  process.exit(response.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
