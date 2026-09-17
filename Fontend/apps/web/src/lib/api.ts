import type {
  ApplicationDetail,
  ApplicationList,
  ApplicationRow,
  ApprovedApplication,
  CampaignRating,
  CampaignRatingList,
  MyApplication,
  RatingTag,
} from "../components/types";
import { clearAuth, getToken } from "./auth";

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

// Ticket 11: the wizard's live "about N creators match" count. Rounded by the API; never lists creators.
export interface MatchCount {
  count: number;
  fewerThan: boolean;
  label: string;
}

export function countMatchingCreators(targeting: Record<string, unknown>, token?: string) {
  return apiRequest<MatchCount>("/campaigns/match-count", {
    method: "POST",
    token,
    body: JSON.stringify(targeting),
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
const applicationsToken = () => getToken() || undefined;

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

// Campaign engine: content approval (ticket 07)
// Content campaigns only.
function contentAction(submissionId: string, action: string, body?: Record<string, unknown>) {
  return apiRequest<{ id: string; status: string }>(`/submissions/${submissionId}/${action}`, {
    method: "PATCH",
    token: getToken() || undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const contentApprovalApi = {
  list: (campaignId: string) =>
    apiRequest<import("../components/types").ContentReviewData>(`/submissions/campaign/${campaignId}`, {
      token: getToken() || undefined,
    }),
  submit: (campaignId: string, videoUrl: string, caption: string) =>
    apiRequest<{ id: string; status: string }>("/submissions", {
      method: "POST",
      token: getToken() || undefined,
      body: JSON.stringify({ campaignId, videoUrl, caption }),
    }),
  resubmit: (submissionId: string, videoUrl: string, caption: string) =>
    apiRequest<{ id: string; status: string }>(`/submissions/${submissionId}`, {
      method: "PUT",
      token: getToken() || undefined,
      body: JSON.stringify({ videoUrl, caption }),
    }),
  approve: (submissionId: string) => contentAction(submissionId, "approve"),
  requestChanges: (submissionId: string, notes: string) => contentAction(submissionId, "request-changes", { notes }),
  reject: (submissionId: string, reason: string) => contentAction(submissionId, "reject", { reason }),
  appeal: (submissionId: string, reason: string) => contentAction(submissionId, "appeal", { reason }),
  deliver: (submissionId: string, url: string, acceptUsageRights: boolean) =>
    contentAction(submissionId, "deliver", { url, acceptUsageRights }),
  confirmReceipt: (submissionId: string) => contentAction(submissionId, "confirm-receipt"),
  markPosted: (submissionId: string, posts: Array<{ platform: string; postUrl: string }>, caption: string) =>
    contentAction(submissionId, "mark-posted", { posts, caption }),
  confirmPost: (submissionId: string) => contentAction(submissionId, "confirm-post"),
  disputePost: (submissionId: string, notes: string) => contentAction(submissionId, "dispute-post", { notes }),
};

// Brand ratings (M8): rate the creators who completed their work on the brand's campaign.
export const ratingsApi = {
  list(campaignId: string) {
    return apiRequest<CampaignRatingList>(`/campaigns/${campaignId}/ratings`, { token: getToken() || undefined });
  },
  rate(campaignId: string, creatorId: string, rating: { score: number; comment: string; tags: RatingTag[] }) {
    return apiRequest<{ rating: CampaignRating }>(`/campaigns/${campaignId}/ratings/${creatorId}`, {
      method: "PUT",
      token: getToken() || undefined,
      body: JSON.stringify(rating),
    });
  },
};
