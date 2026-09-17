// Campaign engine: applications (ticket 06)
// How applications read on screen: status labels for creators and brands, the line that
// explains a creator's application, and short dates.
import type { ApplicationStatus, MyApplication } from "../components/types";

export const APPLICATION_STATUS_LABELS: Record<"creator" | "brand", Record<ApplicationStatus, string>> = {
  creator: {
    pending: "Pending",
    approved: "Selected",
    rejected: "Not Selected",
    withdrawn: "Withdrawn",
    expired: "Expired",
  },
  brand: {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    expired: "Expired",
  },
};

// "16 Sep"
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

// What a creator's application status means for them right now.
export function applicationStatusLine(application: Pick<MyApplication, "status" | "expiresAt">): string {
  switch (application.status) {
    case "pending":
      return application.expiresAt
        ? `Waiting for the brand · open until ${formatShortDate(application.expiresAt)}`
        : "Waiting for the brand";
    case "approved":
      return "You've been selected. Find the brief in your campaigns below";
    case "rejected":
      return "The brand picked other creators this time";
    case "withdrawn":
      return "You withdrew this application";
    case "expired":
      return "Closed without a decision from the brand";
  }
}
