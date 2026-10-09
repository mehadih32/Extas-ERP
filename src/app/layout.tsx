import type { Metadata, Viewport } from "next";

import "@/styles/globals.css";

import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  title: { default: "Extas ERP", template: "%s · Extas ERP" },
  description: "Extas Enterprise ERP: sales, stock, production, accounts and HR in one place.",
  applicationName: "Extas ERP",
  // A private business system: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b3d2e",
  width: "device-width",
  initialScale: 1,
  // Lets the bottom navigation sit above the phone's home bar.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
