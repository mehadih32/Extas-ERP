import type { Metadata, Viewport } from "next";

import "@/styles/globals.css";

import { Toaster } from "@/components/feedback/toaster";
import { DemoSiteBar } from "@/components/shell/demo-site-bar";
import { env } from "@/lib/env";
import { currentInterfaceStyle } from "@/modules/appearance/appearance.service";

import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  title: { default: "Extas ERP", template: "%s · Extas ERP" },
  description: "Extas Enterprise ERP: sales, stock, production, accounts and HR in one place.",
  applicationName: "Extas ERP",
  // The browser tab's icon: a bold "E" drawn to stay sharp at 16px (public/favicon.svg),
  // with favicon.ico (16, 32 and 48px) for browsers that do not take SVG. Listing icons
  // here replaces app/icon.svg's own link, so both are named. Installing to the home
  // screen uses app/manifest.ts; iPhones use their own icon and title.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Extas ERP", statusBarStyle: "default" },
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The person's chosen look (Settings → Appearance): the modern styles in
  // globals.css apply under data-ui="modern"; the original look needs nothing.
  const style = await currentInterfaceStyle();
  return (
    <html lang="en" className={fontVariables} data-ui={style === "MODERN" ? "modern" : undefined}>
      <body>
        {env.DEMO_SITE === "on" ? <DemoSiteBar /> : null}
        {children}
        <Toaster />
      </body>
    </html>
  );
}
