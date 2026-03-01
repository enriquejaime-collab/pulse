import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopNav } from "@/app/components/top-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger | Trade Tracker",
  description: "Local-first trade normalization and analytics dashboard"
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <div className="px-4 pt-4 sm:px-6">
          <TopNav />
        </div>
        <div className="px-4 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
