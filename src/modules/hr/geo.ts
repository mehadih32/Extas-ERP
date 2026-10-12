/*
 * Positions for GPS attendance, shared by the server and the browser: distances,
 * which work place a check-in belongs to, and which on-duty pings are worth
 * keeping. No database or Node.js imports, so client components can use it.
 */

export type LatLng = { lat: number; lng: number };
export type Fix = LatLng & { accuracy?: number | null };

/** How often the phone takes a position while on duty, and how often it sends them. */
export const PING_EVERY_SECONDS = 30;
export const SEND_EVERY_SECONDS = 60;
/** The server keeps a ping only this long after the last one, or this far from it. */
export const KEEP_AFTER_SECONDS = 30;
export const KEEP_AFTER_METRES = 50;
/** On duty with no ping for this long: "No signal" on the staff map. */
export const SIGNAL_LOST_MINUTES = 10;
/** Pings are deleted after this many days (nightly housekeeping). */
export const PING_DAYS_KEPT = 90;
/** Positions vaguer than this are not used. */
export const WORST_ACCURACY_METRES = 1000;
/** A work place's radius: the default, and the limits HR can set. */
export const DEFAULT_RADIUS_METRES = 150;
export const RADIUS_LIMITS = { min: 25, max: 5000 } as const;

const EARTH_RADIUS_METRES = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Metres between two points along the earth's surface (haversine). */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isLatLng(value: LatLng): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180 &&
    // 0,0 is what broken GPS reports; nobody works in the Gulf of Guinea.
    !(value.lat === 0 && value.lng === 0)
  );
}

export type Place = LatLng & { id: string; name: string; radiusMeters: number };

export type PlaceCheck = {
  placeId: string;
  placeName: string;
  distance: number;
  /** Outside the radius even allowing for how vague the position is. */
  away: boolean;
};

/**
 * The work place a position is compared with: the person's own place when
 * they have one, otherwise the nearest of the company's places. Null without
 * any place. The phone's accuracy is allowed for (up to 200 m), so a vague
 * fix next to the office is not flagged.
 */
export function checkAgainstPlaces(
  fix: Fix,
  places: readonly Place[],
  ownPlaceId?: string | null,
): PlaceCheck | null {
  const own = ownPlaceId ? places.find((p) => p.id === ownPlaceId) : undefined;
  const slack = Math.min(Math.max(fix.accuracy ?? 0, 0), 200);
  let best: { margin: number; check: PlaceCheck } | null = null;
  for (const place of own ? [own] : places) {
    const distance = Math.round(distanceMetres(fix, place));
    // How far outside the radius (negative inside): the nearest place wins.
    const margin = distance - place.radiusMeters;
    if (best && margin >= best.margin) continue;
    best = {
      margin,
      check: { placeId: place.id, placeName: place.name, distance, away: margin > slack },
    };
  }
  return best?.check ?? null;
}

export type Ping = LatLng & { at: Date; accuracy?: number | null };

/**
 * The pings worth keeping, oldest first: each at least KEEP_AFTER_SECONDS
 * after the last kept one, or KEEP_AFTER_METRES away from it. `last` is the
 * latest ping already kept, if any.
 */
export function thinPings<T extends Ping>(pings: readonly T[], last?: Ping | null): T[] {
  const kept: T[] = [];
  let previous: Ping | null | undefined = last;
  for (const ping of [...pings].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (previous) {
      const seconds = (ping.at.getTime() - previous.at.getTime()) / 1000;
      if (seconds <= 0) continue;
      if (seconds < KEEP_AFTER_SECONDS && distanceMetres(previous, ping) < KEEP_AFTER_METRES) {
        continue;
      }
    }
    kept.push(ping);
    previous = ping;
  }
  return kept;
}

/** The length of a trail in metres, ignoring jumps vaguer than the positions themselves. */
export function trailMetres(pings: readonly Fix[]): number {
  let total = 0;
  for (let i = 1; i < pings.length; i++) {
    const a = pings[i - 1]!;
    const b = pings[i]!;
    const step = distanceMetres(a, b);
    const noise = Math.max(a.accuracy ?? 0, b.accuracy ?? 0);
    if (step > noise) total += step;
  }
  return Math.round(total);
}

/** "350 m", "2.4 km". */
export function distanceText(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** A Google Maps link to a point, which opens without any key. */
export function pointLink(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * A Google Maps route through a day's trail (start, end and up to 8 points
 * between), which opens without any key.
 */
export function routeLink(trail: readonly LatLng[]): string | null {
  if (trail.length < 2) return null;
  const first = trail[0]!;
  const last = trail.at(-1)!;
  const between = trail.slice(1, -1);
  const step = Math.max(1, Math.ceil(between.length / 8));
  const waypoints = between.filter((_, i) => i % step === 0).slice(0, 8);
  const text = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const params = new URLSearchParams({
    api: "1",
    origin: text(first),
    destination: text(last),
    travelmode: "walking",
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.map(text).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
