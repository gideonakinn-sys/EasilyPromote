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
    const error = (await res.json().catch(() => ({ error: "Request failed" }))) as Record<string, unknown>;
    throw new ApiRequestError(res.status, error);
  }

  return res.json();
}

export { getToken, getUser, isAuthenticated, clearAuth, saveAuth } from "./auth";
export type { User } from "./auth";

// Campaign engine: brand wizard (ticket 03)
// Prices a campaign setup without saving it; the numbers match what checkout charges.
export function quoteCampaign(setup: Record<string, unknown>, token?: string) {
  return apiRequest<{ quote: import("../components/types").CampaignQuote }>("/campaigns/quote", {
    method: "POST",
    token,
    body: JSON.stringify(setup),
  });
}

// Campaign engine: creator marketplace (tickets 01/04/05)
// Thrown by apiRequest. Keeps the response body (e.g. the eligibility failures a join
// returns), so screens can show every reason, not just the first.
export class ApiRequestError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Campaign engine: applications (ticket 06)
import { getToken as readApplicationsToken } from "./auth";
import type {
  ApplicationDetail,
  ApplicationList,
  ApplicationRow,
  ApprovedApplication,
  MyApplication,
} from "../components/types";

const applicationsToken = () => readApplicationsToken() || undefined;

export const applicationsApi = {
  apply(campaignId: string, pitch: string) {
    return apiRequest<MyApplication>(`/campaigns/${campaignId}/apply`, {
      method: "POST",
      token: applicationsToken(),
      body: JSON.stringify(pitch.trim() ? { pitch: pitch.trim() } : {}),
    });
  },
  withdraw(campaignId: string) {
    return apiRequest<MyApplication>(`/campaigns/${campaignId}/apply/withdraw`, {
      method: "POST",
      token: applicationsToken(),
    });
  },
  list(campaignId: string, { status, sort }: { status?: string; sort?: "match" | "newest" } = {}) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (sort) params.set("sort", sort);
    const query = params.toString();
    return apiRequest<ApplicationList>(`/campaigns/${campaignId}/applications${query ? `?${query}` : ""}`, {
      token: applicationsToken(),
    });
  },
  get(campaignId: string, applicationId: string) {
    return apiRequest<ApplicationDetail>(`/campaigns/${campaignId}/applications/${applicationId}`, {
      token: applicationsToken(),
    });
  },
  approve(campaignId: string, applicationId: string) {
    return apiRequest<ApprovedApplication>(`/campaigns/${campaignId}/applications/${applicationId}/approve`, {
      method: "POST",
      token: applicationsToken(),
    });
  },
  reject(campaignId: string, applicationId: string, reason: string) {
    return apiRequest<ApplicationRow>(`/campaigns/${campaignId}/applications/${applicationId}/reject`, {
      method: "POST",
      token: applicationsToken(),
      body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
    });
  },
};
