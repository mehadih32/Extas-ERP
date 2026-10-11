import { type PlugStatus, serverSettings, setting, type Settings } from "./config";

/*
 * Google Maps for the live staff map. Without GOOGLE_MAPS_API_KEY the map
 * screen lists each place with an "Open in Google Maps" link (which needs no
 * key); with it, the same screen draws the pins. The key goes to the browser,
 * so it should be limited to the ERP's web address in Google Cloud console.
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
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
