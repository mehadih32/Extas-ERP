import type { MetadataRoute } from "next";

/**
 * Lets phones install Extas ERP to the home screen (Add to Home Screen), where
 * it opens full screen like an app. Served at /manifest.webmanifest; the icons
 * are in public/icons, made from app/icon.svg.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Extas ERP",
    short_name: "Extas ERP",
    description: "Sales, stock, production, accounts and HR in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8f8f8",
    theme_color: "#0b3d2e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "My HR", short_name: "My HR", url: "/me" }],
  };
}
