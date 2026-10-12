import { type LatLng, pointLink } from "@/modules/hr/geo";

import { type PlugStatus, serverSettings, setting, type Settings } from "./config";

/*
 * Google Maps, for road distances on travel claims: a staff claim's route is
 * looked up on the server (Directions API) to check the fare and that the
 * trip is on the person's GPS trail. The staff map does not need it: it draws
 * on OpenStreetMap, and every position opens in Google Maps with a link that
 * needs no key. Limit the key to the Directions API in Google Cloud console.
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

/** Google's country code to look places up in, from the company's time zone. */
export function regionOf(timeZone: string): string | null {
  return timeZone === "Asia/Dhaka" ? "bd" : null;
}

export type RoadRoute =
  | { found: true; metres: number; from: LatLng; to: LatLng }
  /** Google answered but found no route ("NOT_FOUND"), or refused the key ("DENIED"). */
  | { found: false; why: "NOT_FOUND" | "DENIED" };

/**
 * The road route between two places typed on a travel claim ("Head office",
 * "Mirpur 10"), from Google's Directions service on the server: the road
 * distance and where Google put the two ends. Null while the plug is off.
 * Throws when Google cannot be reached or is busy, so the job tries again.
 */
export async function roadRoute(
  from: string,
  to: string,
  options: { region?: string | null; settings?: Settings; fetchImpl?: typeof fetch } = {},
): Promise<RoadRoute | null> {
  const key = setting(options.settings ?? serverSettings(), "GOOGLE_MAPS_API_KEY");
  if (!key) return null;
  const params = new URLSearchParams({ origin: from, destination: to, key });
  if (options.region) params.set("region", options.region);
  const response = await (options.fetchImpl ?? fetch)(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`Google Maps answered ${response.status}.`);
  const body = (await response.json()) as {
    status?: string;
    routes?: Array<{
      legs?: Array<{
        distance?: { value?: number };
        start_location?: LatLng;
        end_location?: LatLng;
      }>;
    }>;
  };
  switch (body.status) {
    case "OK": {
      const leg = body.routes?.[0]?.legs?.[0];
      const metres = leg?.distance?.value;
      if (!leg?.start_location || !leg.end_location || typeof metres !== "number") {
        return { found: false, why: "NOT_FOUND" };
      }
      return { found: true, metres, from: leg.start_location, to: leg.end_location };
    }
    case "NOT_FOUND":
    case "ZERO_RESULTS":
    case "MAX_WAYPOINTS_EXCEEDED":
    case "MAX_ROUTE_LENGTH_EXCEEDED":
    case "INVALID_REQUEST":
      return { found: false, why: "NOT_FOUND" };
    case "REQUEST_DENIED":
      return { found: false, why: "DENIED" };
    default:
      // OVER_QUERY_LIMIT, UNKNOWN_ERROR: try again later.
      throw new Error(`Google Maps answered ${body.status ?? "nothing"}.`);
  }
}
