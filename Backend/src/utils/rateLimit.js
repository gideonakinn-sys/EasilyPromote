// Fixed-window, in-memory rate limiter. Per-instance only — good enough to stop a
// misbehaving integration from hammering one server, not a distributed quota.
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs * 10);
  sweep.unref();

  return function allow(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

module.exports = { createRateLimiter };
