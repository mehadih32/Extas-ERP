import { describe, expect, it, vi } from "vitest";

import {
  checkClaim,
  type ClaimCheckInput,
  claimAccess,
  median,
  normalizePlace,
  placesOnRoute,
  routeKey,
  usualFare,
} from "@/modules/hr/claims";
import { regionOf, roadRoute } from "@/modules/integrations/maps";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The checks on a staff claim: the day's duty and GPS trail, the places on
 * the route, the usual fare and the route's past price, duplicates and the
 * receipt. Pure functions; the service gathers the facts.
 */

const HEAD_OFFICE = { id: "p1", name: "Head office", lat: 23.7806, lng: 90.407, radiusMeters: 150 };
const WAREHOUSE = {
  id: "p2",
  name: "Uttara warehouse",
  lat: 23.8759,
  lng: 90.3795,
  radiusMeters: 200,
};
const north = (from: { lat: number; lng: number }, metres: number) => ({
  lat: from.lat + metres / 111_195,
  lng: from.lng,
});
/** A trail walked north from the head office, in steps of this many metres. */
const walk = (steps: number, metres: number) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    ...north(HEAD_OFFICE, i * metres),
    accuracy: 10,
  }));

const trip = (over: Partial<ClaimCheckInput> = {}): ClaimCheckInput => ({
  kind: "CONVEYANCE",
  amount: 150,
  fromPlace: "Head office",
  toPlace: "Mirpur 10",
  duty: "ON_DUTY",
  gps: true,
  shiftOpen: false,
  trail: walk(10, 500),
  places: [HEAD_OFFICE, WAREHOUSE],
  ratePerKm: 30,
  sameDayOthers: 0,
  routeHistory: [],
  road: null,
  duplicateOf: null,
  hasReceipt: true,
  ...over,
});

describe("route words", () => {
  it("evens out places and keys a route the same either way round", () => {
    expect(normalizePlace("  Head Office, ")).toBe("head office");
    expect(normalizePlace("মিরপুর-১০")).toBe("মিরপুর ১০");
    expect(routeKey("Head office", "Mirpur 10")).toBe(routeKey("mirpur 10 ", "HEAD OFFICE"));
    expect(routeKey("Head office", "")).toBeNull();
  });

  it("finds the work places named on the route as whole words", () => {
    const places = [HEAD_OFFICE, WAREHOUSE, { ...HEAD_OFFICE, id: "p3", name: "Office" }];
    expect(
      placesOnRoute(["Head office", "Uttara warehouse gate"], places).map((p) => p.id),
    ).toEqual(["p1", "p2", "p3"]);
    expect(placesOnRoute(["Officers club", "Mirpur"], places)).toEqual([]);
  });

  it("works the usual fare out from the distance, never under 2 km", () => {
    expect(usualFare(8_400, 30)).toBe(252);
    expect(usualFare(600, 30)).toBe(60);
    expect(median([100, 300, 200])).toBe(200);
    expect(median([100, 200])).toBe(150);
    expect(median([])).toBeNull();
  });
});

describe("checking a trip", () => {
  it("passes a trip that matches the day's trail and price", () => {
    const { flags, check } = checkClaim(trip());
    expect(flags).toEqual([]);
    expect(check).toMatchObject({
      duty: "ON_DUTY",
      gps: true,
      points: 11,
      missed: [],
      usual: {
        basis: "TRAIL",
        amount: expect.closeTo(150, 0),
        metres: expect.any(Number),
        claimed: 150,
      },
    });
    expect(check.trailMetres).toBeGreaterThan(4_900);
  });

  it("flags a day not on duty, whatever the reason", () => {
    for (const duty of ["NO_CHECK_IN", "ABSENT", "ON_LEAVE", "DAY_OFF"] as const) {
      const { flags, check } = checkClaim(trip({ duty, trail: [] }));
      expect(flags, duty).toEqual(["NOT_ON_DUTY"]);
      expect(check.duty).toBe(duty);
    }
  });

  it("flags no trail and no travel only with GPS attendance on", () => {
    expect(checkClaim(trip({ trail: [walk(0, 0)[0]!] })).flags).toEqual(["NO_TRAIL"]);
    expect(checkClaim(trip({ trail: walk(4, 50) })).flags).toEqual(["NO_TRAVEL"]);
    // With GPS attendance off there is no trail to hold the trip against.
    const off = checkClaim(trip({ gps: false, trail: walk(4, 50) }));
    expect(off.flags).toEqual([]);
    expect(off.check).toMatchObject({ gps: false, trailMetres: null, usual: null });
  });

  it("flags a work place on the route the trail never reached", () => {
    const { flags, check } = checkClaim(trip({ toPlace: "Uttara warehouse" }));
    expect(flags).toEqual(["ROUTE_MISMATCH"]);
    expect(check.missed).toEqual(["Uttara warehouse"]);
    // Walking all the way there passes.
    const there = walk(22, 500).concat([{ ...WAREHOUSE, accuracy: 10 }]);
    expect(
      checkClaim(trip({ toPlace: "Uttara warehouse", trail: there, amount: 300 })).flags,
    ).toEqual([]);
  });

  it("holds the ends Google Maps found against the trail", () => {
    const road = { metres: 4_800, from: HEAD_OFFICE, to: north(HEAD_OFFICE, 4_900) };
    expect(checkClaim(trip({ road })).flags).toEqual([]);
    const far = { metres: 9_000, from: HEAD_OFFICE, to: north(HEAD_OFFICE, 9_000) };
    const { flags, check } = checkClaim(trip({ road: far, amount: 270 }));
    expect(flags).toEqual(["ROUTE_MISMATCH"]);
    expect(check.missed).toEqual(["Mirpur 10"]);
  });

  it("flags a price more than half again the usual fare for the road", () => {
    const road = { metres: 4_800, from: HEAD_OFFICE, to: north(HEAD_OFFICE, 4_900) };
    // 4.8 km at 30 a km is 144; up to 216 passes.
    expect(checkClaim(trip({ road, amount: 216 })).flags).toEqual([]);
    const { flags, check } = checkClaim(trip({ road, amount: 220 }));
    expect(flags).toEqual(["HIGH_PRICE"]);
    expect(check.usual).toEqual({ basis: "ROAD", amount: 144, metres: 4_800, claimed: 220 });
  });

  it("holds the day's claims together against the trail when there is no road distance", () => {
    // About 5 km walked: 150 usual. 150 + 100 already claimed that day is too much.
    const { flags, check } = checkClaim(trip({ sameDayOthers: 100, amount: 150 }));
    expect(flags).toEqual(["HIGH_PRICE"]);
    expect(check.usual).toMatchObject({ basis: "TRAIL", claimed: 250 });
  });

  it("holds the price against what the route was approved for before", () => {
    expect(checkClaim(trip({ routeHistory: [120], amount: 400, ratePerKm: 0 })).flags).toEqual([]);
    const { flags, check } = checkClaim(
      trip({ routeHistory: [120, 140, 130], amount: 200, ratePerKm: 0 }),
    );
    expect(flags).toEqual(["HIGH_PRICE"]);
    expect(check.usual).toEqual({ basis: "ROUTE", amount: 130, metres: null, claimed: 200 });
  });

  it("flags a duplicate and keeps a receipt optional for trips", () => {
    const { flags, check } = checkClaim(trip({ duplicateOf: "CLM-2026-00001", hasReceipt: false }));
    expect(flags).toEqual(["DUPLICATE"]);
    expect(check.duplicateOf).toBe("CLM-2026-00001");
  });

  it("checks local material for a receipt and duplicates only", () => {
    const material = trip({
      kind: "LOCAL_MATERIAL",
      fromPlace: null,
      toPlace: null,
      duty: "DAY_OFF",
      trail: [],
      amount: 5_000,
    });
    expect(checkClaim(material).flags).toEqual([]);
    expect(checkClaim({ ...material, shiftOpen: true }).check.shiftOpen).toBe(false);
    expect(checkClaim({ ...material, hasReceipt: false, duplicateOf: "CLM-1" }).flags).toEqual([
      "NO_RECEIPT",
      "DUPLICATE",
    ]);
  });
});

describe("who works claims", () => {
  const ctxWith = (...keys: PermissionKey[]) => ({ can: (p: PermissionKey) => keys.includes(p) });

  it("lets HR see, Accounts decide, and only payers pay", () => {
    expect(claimAccess(ctxWith("hr.manage"))).toEqual({ see: true, decide: false, pay: false });
    expect(claimAccess(ctxWith("expenses.manage"))).toEqual({
      see: true,
      decide: true,
      pay: false,
    });
    expect(claimAccess(ctxWith("accounts.payments.record"))).toEqual({
      see: true,
      decide: true,
      pay: true,
    });
    expect(claimAccess(ctxWith("hr.view", "portal.self"))).toEqual({
      see: false,
      decide: false,
      pay: false,
    });
  });
});

describe("Google Maps' road route", () => {
  const answer = (body: unknown, status = 200) => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  };
  const settings = { GOOGLE_MAPS_API_KEY: "AIza-test" };

  it("asks nothing without a key", async () => {
    const { fetchImpl } = answer({});
    expect(await roadRoute("Head office", "Mirpur 10", { settings: {}, fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives the road distance and the two ends it found", async () => {
    const { fetchImpl, calls } = answer({
      status: "OK",
      routes: [
        {
          legs: [
            {
              distance: { value: 7_350 },
              start_location: { lat: 23.78, lng: 90.407 },
              end_location: { lat: 23.807, lng: 90.368 },
            },
          ],
        },
      ],
    });
    const route = await roadRoute("Head office", "Mirpur 10", {
      region: regionOf("Asia/Dhaka"),
      settings,
      fetchImpl,
    });
    expect(route).toEqual({
      found: true,
      metres: 7_350,
      from: { lat: 23.78, lng: 90.407 },
      to: { lat: 23.807, lng: 90.368 },
    });
    const url = new URL(calls[0]!);
    expect(url.pathname).toBe("/maps/api/directions/json");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      origin: "Head office",
      destination: "Mirpur 10",
      key: "AIza-test",
      region: "bd",
    });
    expect(regionOf("Europe/London")).toBeNull();
  });

  it("says when the route can't be found or the key is refused, and throws to try again", async () => {
    expect(
      await roadRoute("x", "y", {
        settings,
        fetchImpl: answer({ status: "ZERO_RESULTS" }).fetchImpl,
      }),
    ).toEqual({ found: false, why: "NOT_FOUND" });
    expect(
      await roadRoute("x", "y", {
        settings,
        fetchImpl: answer({ status: "REQUEST_DENIED" }).fetchImpl,
      }),
    ).toEqual({ found: false, why: "DENIED" });
    await expect(
      roadRoute("x", "y", {
        settings,
        fetchImpl: answer({ status: "OVER_QUERY_LIMIT" }).fetchImpl,
      }),
    ).rejects.toThrow("OVER_QUERY_LIMIT");
    await expect(
      roadRoute("x", "y", { settings, fetchImpl: answer({}, 500).fetchImpl }),
    ).rejects.toThrow("500");
  });
});
