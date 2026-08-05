import { clearAuth } from "./auth";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

interface RequestOptions extends RequestInit {
  token?: string;
}

function handleUnauthorized() {
  setTimeout(() => {
    if (typeof window === "undefined") return;
    clearAuth();
    window.location.href = "/";
  }, 0);
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, { ...fetchOptions, headers });

  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized();
    }
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export { getToken, getUser, isAuthenticated, clearAuth, saveAuth } from "./auth";
export type { User } from "./auth";
