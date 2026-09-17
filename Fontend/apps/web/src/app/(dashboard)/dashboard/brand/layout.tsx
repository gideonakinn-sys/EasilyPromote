import { BrandShell } from "../../../../components/brand/brand-shell";

export default function BrandDashboardLayout({ children }: { children: React.ReactNode }) {
  return <BrandShell>{children}</BrandShell>;
}