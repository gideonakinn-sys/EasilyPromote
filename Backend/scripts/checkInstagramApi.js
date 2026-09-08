require("dotenv").config();

// Runs exactly the Instagram calls the app makes, against a token generated on
// the Instagram API setup page ("Generate access tokens"). Every call is logged
// by Meta against the app, which is what App Review's "required API test calls"
// step is looking for.
//
//   node scripts/checkInstagramApi.js <access_token>

const VERSION = process.env.META_GRAPH_VERSION || "v26.0";
const GRAPH = "https://graph.instagram.com";
const token = process.argv[2] || process.env.IG_TEST_TOKEN;

if (!token) {
  console.error("Usage: node scripts/checkInstagramApi.js <access_token>");
  process.exit(1);
}

async function call(label, path, params) {
  const query = new URLSearchParams({ ...params, access_token: token });
  const url = `${GRAPH}/${VERSION}${path}?${query.toString()}`;
  process.stdout.write(`\n${label}\n  GET ${path}?${new URLSearchParams(params)}\n`);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    console.log(`  FAILED ${res.status}: ${json.error?.message || "unknown error"}`);
    if (json.error?.code) console.log(`  code=${json.error.code} subcode=${json.error.error_subcode || "-"}`);
    return null;
  }
  console.log(`  OK ${res.status}`);
  return json;
}

(async () => {
  console.log(`Instagram Graph ${VERSION} — running the app's real calls`);

  const profile = await call("1. Profile  (instagram_business_basic)", "/me", {
    fields: "user_id,username,account_type,profile_picture_url",
  });
  if (profile) {
    console.log(`  @${profile.username} · ${profile.account_type} · picture: ${profile.profile_picture_url ? "yes" : "no"}`);
  }

  const media = await call("2. Media list  (instagram_business_basic)", "/me/media", {
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
    limit: "5",
  });
  const items = media && media.data ? media.data : [];
  if (media) {
    console.log(`  ${items.length} item(s)`);
    for (const m of items.slice(0, 3)) console.log(`    ${m.id}  ${m.media_type}  ${m.permalink}`);
  }

  if (items.length === 0) {
    console.log("\n3. Insights — skipped, no media on this account to read insights for.");
  } else {
    const insights = await call(
      `3. Insights  (instagram_business_manage_insights)`,
      `/${items[0].id}/insights`,
      { metric: "reach,likes,comments,saved,shares,views" }
    );
    if (insights && insights.data) {
      for (const metric of insights.data) {
        console.log(`  ${metric.name.padEnd(10)} ${metric.values?.[0]?.value ?? "-"}`);
      }
    }
  }

  console.log("\nAny call that returned OK is now recorded against the app.");
})();
