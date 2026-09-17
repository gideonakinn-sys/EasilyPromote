// The load test writes thousands of users, campaigns and placements and hammers the API. It must
// only ever touch this machine: a throwaway mongod and an API process it started itself. These
// checks refuse anything else before a single request or write is made.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

class UnsafeTargetError extends Error {}

// mongodb://127.0.0.1:27099/db only. mongodb+srv:// always resolves through DNS to a remote cluster.
function assertLocalMongoUri(uri) {
  const text = String(uri || "").trim();
  if (!/^mongodb:\/\//i.test(text)) {
    throw new UnsafeTargetError(`Refusing MongoDB URI "${redact(text)}": only mongodb:// on this machine is allowed (no mongodb+srv://)`);
  }
  // Hosts sit between "mongodb://" (and optional credentials) and the first "/" or "?".
  const afterScheme = text.slice("mongodb://".length);
  const authority = afterScheme.split(/[/?]/)[0];
  const hostList = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
  const hosts = hostList.split(",").map((h) => hostOf(h));
  if (hosts.length === 0 || hosts.some((h) => !LOOPBACK_HOSTS.has(h))) {
    throw new UnsafeTargetError(`Refusing MongoDB URI "${redact(text)}": every host must be 127.0.0.1, localhost or ::1`);
  }
  return text;
}

// http://127.0.0.1:port only.
function assertLocalUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    throw new UnsafeTargetError(`Refusing API URL "${url}": not a URL`);
  }
  if (parsed.protocol !== "http:") throw new UnsafeTargetError(`Refusing API URL "${url}": only http:// on this machine is allowed`);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new UnsafeTargetError(`Refusing API URL "${url}": the host must be 127.0.0.1, localhost or ::1`);
  }
  return parsed.origin;
}

function hostOf(hostPort) {
  const value = hostPort.trim();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0].toLowerCase();
}

const redact = (uri) => uri.replace(/\/\/([^@/]+)@/, "//****@");

module.exports = { assertLocalMongoUri, assertLocalUrl, UnsafeTargetError };
