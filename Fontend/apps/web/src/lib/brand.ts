export interface BrandStatsSummary {
  totalCampaigns: number;
  drafts: number;
  pendingPayment: number;
  activeCampaigns: number;
  completed: number;
  cancelled: number;
  viewsTarget: number;
  viewsDelivered: number;
  progressPercent: number;
}

export interface BrandStatsMoney {
  deposited: number;
  released: number;
  refunded: number;
  escrowBalance: number;
  avgCostPerView: number;
}

export interface DeliveryPoint {
  date: string;
  views: number;
  conversions: number;
}

export interface BrandStatsCampaign {
  id: string;
  name: string;
  category: string | null;
  status: string;
  coverImageUrl: string | null;
  targetViews: number;
  viewsDelivered: number;
  progressPercent: number;
  budget: number;
  views: number;
  startDate: string | null;
  endDate: string | null;
  hasReferral: boolean;
  conversions: number;
  objective?: string;
  campaignModel?: string;
}

export interface BrandStatsPayload {
  summary: BrandStatsSummary;
  money: BrandStatsMoney;
  conversions: number;
  distribution: BrandStatsCampaign[];
  deliverySeries: DeliveryPoint[];
  topCampaigns: BrandStatsCampaign[];
  recent: BrandStatsCampaign[];
  unreadCount: number;
}

export type BrandTransactionType =
  | "escrow_deposit"
  | "release"
  | "refund"
  | "topup"
  | "unmatched_payment"
  | "transfer_fee"
  | "fixed_credit"
  | "fixed_void"
  | "bonus_credit";

export type BrandTransactionStatus =
  | "escrow_deposit"
  | "released"
  | "refunded"
  | "failed"
  | "refund_pending"
  | "refund_failed"
  | "under_review"
  | "credited"
  | "voided"
  | "reinstated";

export interface BrandTransaction {
  id: string;
  date: string;
  type: BrandTransactionType;
  status: BrandTransactionStatus;
  amount: number;
  views: number | null;
  bucket: "views" | "referral" | "fixed" | "bonus";
  reference: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface BrandTransactionsPayload {
  total: number;
  transactions: BrandTransaction[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  campaignId: string | null;
  createdAt: string;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_payment: "Pending payment",
  under_review: "Under review",
  live: "Live",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TRANSACTION_LABELS: Record<string, string> = {
  escrow_deposit: "Campaign payment",
  topup: "Top-up",
  release: "Creator payout",
  refund: "Refund",
  unmatched_payment: "Unmatched payment",
  transfer_fee: "Platform fee",
  fixed_credit: "Fixed pay credit",
  fixed_void: "Fixed pay void",
  bonus_credit: "Bonus credit",
};

export function formatCompactViews(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

export function formatNaira(value: number): string {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-NG");
}

export function objectiveLabel(campaignModel?: string, objective?: string): string {
  if (campaignModel === "content") return "Content";
  if (objective === "actions") return "Referrals";
  return "Views";
}

export interface MonthPoint {
  date: string;
  views: number;
}

export interface BrandMonthlySummary {
  totalCampaigns: number;
  drafts: number;
  activeCampaigns: number;
  campaignsCompleted: number;
  viewsDelivered: number;
  avgCostPerView: number;
}

export interface BrandMonthlyStats {
  summary: BrandMonthlySummary;
  dailySeries: MonthPoint[];
  topCampaigns: BrandStatsCampaign[];
  availableMonths: string[];
  unreadCount: number;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, (index || 1) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
// After Paystack sends the brand back, a campaign stays "pending_payment" until the API confirms the
// payment (the API asks Paystack and books it). Ask for every pending campaign; returns true if any
// went live so the caller can reload. Runs on the overview and campaigns pages, like the old dashboard.
export async function confirmPendingPayments(): Promise<boolean> {
  const { apiRequest, getToken } = await import("./api");
  const token = getToken() || undefined;
  if (!token) return false;
  const data = await apiRequest<{ campaigns?: Array<{ id: string; status: string }> }>("/campaigns", { method: "GET", token });
  const pending = (data.campaigns || []).filter((c) => c.status === "pending_payment");
  if (pending.length === 0) return false;
  const results = await Promise.allSettled(
    pending.map((c) => apiRequest<{ status: string; isPaid: boolean }>(`/campaigns/${c.id}/payment-status`, { token }))
  );
  return results.some((r) => r.status === "fulfilled" && r.value.isPaid);
}
