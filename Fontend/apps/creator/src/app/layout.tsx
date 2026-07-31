import type { Metadata } from "next";
import { Rethink_Sans, Inter } from "next/font/google";
import localFont from "next/font/local";
import { LenisProvider } from "../components/lenis-provider";
import { ToastProvider } from "@ep/ui/components/toast";
import "./globals.css";

const rethinkSans = Rethink_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rethink",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-inter",
});

const motterdam = localFont({
  src: "../../public/font/Motterdam-K74zp.ttf",
  variable: "--font-motterdam",
});

export const metadata: Metadata = {
  title: "EasilyPromote — Creator Dashboard",
  description: "Find campaigns, earn rewards, grow your rank",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${rethinkSans.variable} ${inter.variable} ${motterdam.variable} min-h-screen antialiased bg-stone-50 text-stone-900 font-rethink`}>
        <ToastProvider>
          <LenisProvider>{children}</LenisProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
