// A small closed-loop load generator: `concurrency` virtual users send requests back to back over
// keep-alive connections until `total` requests are done, recording latency and outcomes.
const http = require("node:http");
const zlib = require("node:zlib");

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(name, samples, wallMs) {
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byOutcome = {};
  let errors = 0;
  let unexpected = 0;
  for (const s of samples) {
    const label = s.error ? `network: ${s.error}` : `${s.status}${s.code ? ` ${s.code}` : ""}`;
    byOutcome[label] = (byOutcome[label] || 0) + 1;
    if (s.error || s.status >= 500) errors += 1;
    else if (!s.expected) unexpected += 1;
  }
  return {
    name,
    requests: samples.length,
    wallSeconds: wallMs / 1000,
    rps: samples.length / (wallMs / 1000),
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times[times.length - 1] || 0,
    errors,
    errorRate: samples.length ? errors / samples.length : 0,
    unexpected,
    outcomes: byOutcome,
  };
}

function createClient(baseUrl, { maxSockets = 256 } = {}) {
  const origin = new URL(baseUrl);
  const agent = new http.Agent({ keepAlive: true, maxSockets });

  function send({ method = "GET", path, token, body }) {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve) => {
      const started = process.hrtime.bigint();
      const req = http.request(
        {
          host: origin.hostname,
          port: origin.port,
          method,
          path,
          agent,
          headers: {
            ...(payload && { "Content-Type": "application/json", "Content-Length": payload.length }),
            ...(token && { Authorization: `Bearer ${token}` }),
            // As browsers do: the API gzips large responses, and that costs it CPU.
            "Accept-Encoding": "gzip",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            let parsed = null;
            try {
              const raw = Buffer.concat(chunks);
              const text = res.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(raw) : raw;
              parsed = JSON.parse(text.toString("utf8"));
            } catch {
              // not JSON
            }
            resolve({ status: res.statusCode, body: parsed, ms });
          });
        }
      );
      req.setTimeout(60000, () => req.destroy(new Error("timeout")));
      req.on("error", (error) => resolve({ status: 0, error: error.message, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
      if (payload) req.write(payload);
      req.end();
    });
  }

  // requests: array of request specs, each { method, path, token, body, expect: (res) => boolean }.
  // Runs them with `concurrency` in flight; resolves to { summary, results } in input order.
  async function run(name, requests, { concurrency }) {
    const results = new Array(requests.length);
    let next = 0;
    const started = Date.now();
    async function worker() {
      while (next < requests.length) {
        const index = next;
        next += 1;
        const spec = requests[index];
        const res = await send(spec);
        results[index] = {
          ...res,
          code: res.body && typeof res.body.code === "string" ? res.body.code : null,
          expected: !res.error && (spec.expect ? spec.expect(res) : res.status < 400),
          spec,
        };
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
    return { summary: summarize(name, results, Date.now() - started), results };
  }

  // Fires every request at once (a burst), for races.
  async function burst(name, requests) {
    return run(name, requests, { concurrency: requests.length });
  }

  return { send, run, burst, close: () => agent.destroy() };
}

module.exports = { createClient, percentile, summarize };
