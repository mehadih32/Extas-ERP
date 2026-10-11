import { pointLink } from "@/modules/hr/geo";

import { type PlugStatus, serverSettings, setting, type Settings } from "./config";

/*
 * Google Maps, for road distances on travel claims. The staff map does not
 * need it: it draws on OpenStreetMap, and every position opens in Google Maps
 * with a link that needs no key. A browser key should be limited to the ERP's
 * web address in Google Cloud console.
 */

const SETTINGS = ["GOOGLE_MAPS_API_KEY"] as const;

export function mapsStatus(settings: Settings = serverSettings()): PlugStatus {
  const key = setting(settings, "GOOGLE_MAPS_API_KEY");
  return {
    key: "maps",
    state: key ? "ON" : "OFF",
    provider: key ? "google" : null,
    settings: SETTINGS,
    problem: null,
  };
}

/** The browser key for drawing maps, or null without one. */
export function mapsBrowserKey(settings: Settings = serverSettings()): string | null {
  return setting(settings, "GOOGLE_MAPS_API_KEY");
}

/** A Google Maps link to a point, which opens without any key. */
export function mapLink(lat: number, lng: number): string {
  return pointLink({ lat, lng });
}
