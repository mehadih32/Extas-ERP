import { describe, expect, it } from "vitest";

import {
  checkAgainstPlaces,
  distanceMetres,
  distanceText,
  isLatLng,
  pointLink,
  routeLink,
  thinPings,
  trailMetres,
} from "@/modules/hr/geo";

const HEAD_OFFICE = { id: "ho", name: "Head office", lat: 23.7806, lng: 90.407, radiusMeters: 150 };
const FACTORY = { id: "fa", name: "Factory", lat: 23.8759, lng: 90.3795, radiusMeters: 300 };
/** A point this many metres north of another (a degree of latitude is about 111.2 km). */
const north = (p: { lat: number; lng: number }, metres: number) => ({
  lat: p.lat + metres / 111_195,
  lng: p.lng,
});
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 27, 3, 0, seconds));

describe("GPS attendance: positions", () => {
  it("measures distances along the earth", () => {
    expect(distanceMetres(HEAD_OFFICE, HEAD_OFFICE)).toBe(0);
    expect(distanceMetres(HEAD_OFFICE, north(HEAD_OFFICE, 500))).toBeCloseTo(500, -1);
    // Karwan Bazar to Mirpur, about 11 km.
    const km = distanceMetres(HEAD_OFFICE, FACTORY) / 1000;
    expect(km).toBeGreaterThan(10.5);
    expect(km).toBeLessThan(11.5);
  });

  it("refuses positions that cannot be real", () => {
    expect(isLatLng({ lat: 23.78, lng: 90.4 })).toBe(true);
    expect(isLatLng({ lat: 0, lng: 0 })).toBe(false);
    expect(isLatLng({ lat: 91, lng: 90 })).toBe(false);
    expect(isLatLng({ lat: 23, lng: -181 })).toBe(false);
    expect(isLatLng({ lat: Number.NaN, lng: 90 })).toBe(false);
  });

  it("compares a check-in with the person's own place, else the nearest", () => {
    const places = [HEAD_OFFICE, FACTORY];
    const atOffice = north(HEAD_OFFICE, 80);
    expect(checkAgainstPlaces({ ...atOffice, accuracy: 20 }, places)).toMatchObject({
      placeName: "Head office",
      away: false,
    });
    // Their own place is the factory: the office counts as away from it.
    const own = checkAgainstPlaces({ ...atOffice, accuracy: 20 }, places, "fa");
    expect(own).toMatchObject({ placeName: "Factory", away: true });
    expect(own!.distance).toBeGreaterThan(10_000);
    expect(checkAgainstPlaces(atOffice, [])).toBeNull();
  });

  it("allows for a vague position up to 200 m before flagging it", () => {
    const outside = north(HEAD_OFFICE, 300); // 150 m outside the radius
    expect(checkAgainstPlaces({ ...outside, accuracy: 10 }, [HEAD_OFFICE])!.away).toBe(true);
    expect(checkAgainstPlaces({ ...outside, accuracy: 180 }, [HEAD_OFFICE])!.away).toBe(false);
    const far = north(HEAD_OFFICE, 600); // 450 m outside
    expect(checkAgainstPlaces({ ...far, accuracy: 900 }, [HEAD_OFFICE])!.away).toBe(true);
  });

  it("keeps a ping every 30 seconds, or sooner after moving 50 m", () => {
    const here = HEAD_OFFICE;
    const pings = [
      { at: at(0), ...here },
      { at: at(10), ...north(here, 5) }, // too soon, not moved
      { at: at(20), ...north(here, 70) }, // moved: kept
      { at: at(25), ...north(here, 75) }, // too soon again
      { at: at(55), ...north(here, 75) }, // 35 s later: kept
      { at: at(55), ...north(here, 900) }, // same moment: dropped
    ];
    expect(thinPings(pings).map((p) => p.at.getUTCSeconds())).toEqual([0, 20, 55]);
    // Against the last ping already saved, out of order input still works.
    const kept = thinPings([...pings].reverse(), { at: at(-5), ...here });
    expect(kept.map((p) => p.at.getUTCSeconds())).toEqual([20, 55]);
  });

  it("measures a trail without counting GPS jitter", () => {
    const a = { ...HEAD_OFFICE, accuracy: 10 };
    const b = { ...north(HEAD_OFFICE, 1000), accuracy: 10 };
    const jitter = { ...north(HEAD_OFFICE, 1015), accuracy: 30 };
    expect(trailMetres([a, b])).toBeCloseTo(1000, -1);
    expect(trailMetres([a, b, jitter])).toBe(trailMetres([a, b]));
    expect(trailMetres([a])).toBe(0);
  });

  it("writes distances and links people can open without a key", () => {
    expect(distanceText(350.4)).toBe("350 m");
    expect(distanceText(2400)).toBe("2.4 km");
    expect(distanceText(10_900)).toBe("11 km");
    expect(pointLink(HEAD_OFFICE)).toBe(
      "https://www.google.com/maps/search/?api=1&query=23.780600,90.407000",
    );
    expect(routeLink([HEAD_OFFICE])).toBeNull();
    const trail = Array.from({ length: 40 }, (_, i) => north(HEAD_OFFICE, i * 100));
    const url = new URL(routeLink(trail)!);
    expect(url.searchParams.get("origin")).toBe("23.780600,90.407000");
    expect(url.searchParams.get("waypoints")!.split("|").length).toBeLessThanOrEqual(8);
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });
});
