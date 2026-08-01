"use client";

import * as React from "react";

export interface PlatformOption {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

const FALLBACK_PLATFORMS: PlatformOption[] = [
  { id: "tiktok", name: "TikTok", enabled: true, sortOrder: 0 },
  { id: "instagram", name: "Instagram", enabled: true, sortOrder: 1 },
  { id: "youtube", name: "YouTube", enabled: true, sortOrder: 2 },
  { id: "facebook", name: "Facebook", enabled: true, sortOrder: 3 },
  { id: "x", name: "X (Twitter)", enabled: true, sortOrder: 4 },
];

export function usePlatforms() {
  const [platforms, setPlatforms] = React.useState<PlatformOption[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/platforms`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list = (data?.platforms || []) as PlatformOption[];
        setPlatforms(list.length ? list : FALLBACK_PLATFORMS);
      })
      .catch(() => {
        if (!cancelled) setPlatforms(FALLBACK_PLATFORMS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { platforms, loading };
}
