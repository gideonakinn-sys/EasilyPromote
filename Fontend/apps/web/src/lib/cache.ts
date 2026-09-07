import { getUser } from "./auth";

// Last-known API responses, kept per user so a dashboard can paint instantly
// from what it showed last time while a fresh copy loads behind it. Every
// reader still revalidates; nothing here is trusted past the next fetch.

const PREFIX = "ep-cache:";
const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  v: number;
  savedAt: number;
  value: T;
}

function storageKey(name: string): string | null {
  const user = getUser();
  if (!user?.id) return null;
  return `${PREFIX}${user.id}:${name}`;
}

export function readCache<T>(name: string): T | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(name);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.v !== VERSION || Date.now() - entry.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(name: string, value: T): void {
  if (typeof window === "undefined") return;
  const key = storageKey(name);
  if (!key) return;
  try {
    const entry: CacheEntry<T> = { v: VERSION, savedAt: Date.now(), value };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Quota or private mode: the app just loads from the network as before.
  }
}

// Merge a partial update into an existing snapshot, so a refetch of one section
// (say, campaigns after a claim) doesn't leave the rest of the snapshot stale.
export function updateCache<T extends object>(name: string, patch: Partial<T>): void {
  const current = readCache<T>(name);
  if (!current) return;
  writeCache(name, { ...current, ...patch });
}

export function clearCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
