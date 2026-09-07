import type { Metadata } from "next";
import { CreatorDashboardLayout } from "../../../../components/creator-dashboard-layout";

export const metadata: Metadata = {
  title: "Creator Dashboard · EasilyPromote",
};

export default function CreatorDashboardRouteLayout({ children }: { children: React.ReactNode }) {
  return <CreatorDashboardLayout>{children}</CreatorDashboardLayout>;
}
