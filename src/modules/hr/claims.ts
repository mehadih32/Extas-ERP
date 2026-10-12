import type { StaffClaimFlag, StaffClaimKind } from "@prisma/client";

import type { PermissionKey } from "@/modules/rbac/permissions";

import {
  checkAgainstPlaces,
  distanceMetres,
  type Fix,
  type LatLng,
  type Place,
  trailMetres,
} from "@/modules/hr/geo";

/*
 * The checks on a staff claim (conveyance or local material), worked out
 * from facts the service gathers: whether the person was on duty that day,
 * their GPS trail for the shift, the work places, the usual fare per km, what
 * the same route usually costs, and Google Maps' road distance when that is
 * connected. Each check that fails adds a flag for Accounts to look at; the
 * employee never sees them. Pure functions, no database.
 */

/** "Head office to Mirpur", or "Yarn (5 kg) for PRD-2026-00003". */
export function claimWhat(c: {
  kind: StaffClaimKind;
  fromPlace: string | null;
  toPlace: string | null;
  item: string | null;
  quantity: string | null;
  project?: { code: string } | null;
}) {
  if (c.kind === "CONVEYANCE") return `${c.fromPlace} to ${c.toPlace}`;
  return `${c.item}${c.quantity ? ` (${c.quantity})` : ""}${c.project ? ` for ${c.project.code}` : ""}`;
}

/** Who decides staff claims: approving one puts it in the books. */
export const CLAIM_DECIDERS: readonly PermissionKey[] = [
  "expenses.manage",
  "accounts.payments.record",
];

/**
 * What a person may do with staff claims:
 *   see     the claims and their checks (HR, Accounts)
 *   decide  approve or reject them (expenses.manage, accounts.payments.record)
 *   pay     pay back what is owed (accounts.payments.record)
 */
export function claimAccess(ctx: { can: (permission: PermissionKey) => boolean }) {
  const decide = CLAIM_DECIDERS.some((p) => ctx.can(p));
  return {
    see: decide || ctx.can("hr.manage"),
    decide,
    pay: ctx.can("accounts.payments.record"),
  };
}

/** A claim more than this many times the usual price is flagged. */
export const HIGH_PRICE_FACTOR = 1.5;
/** The usual fare never counts a trip as shorter than this many km. */
export const MIN_FARE_KM = 2;
/** Less travel than this on the day's trail is no travel. */
export const NO_TRAVEL_METRES = 500;
/** A place Google Maps found counts as on the trail within this distance. */
export const ROUTE_MATCH_METRES = 1000;
/** The route's usual price needs at least this many approved claims. */
export const ROUTE_HISTORY_MIN = 2;

/**
 * Where the person stood that day:
 *   ON_DUTY      checked in (or marked present by HR)
 *   NO_CHECK_IN  a working day with self check-in, and no check-in
 *   ABSENT       marked absent
 *   ON_LEAVE     on approved leave
 *   DAY_OFF      a weekly day off or a holiday, with no check-in
 */
export type ClaimDuty = "ON_DUTY" | "NO_CHECK_IN" | "ABSENT" | "ON_LEAVE" | "DAY_OFF";

/** What the usual price was worked out from: Google's road distance, the day's GPS trail, or the route's past claims. */
export type UsualBasis = "ROAD" | "TRAIL" | "ROUTE";

export type UsualPrice = {
  basis: UsualBasis;
  /** The usual price. */
  amount: number;
  /** The distance it is for (road or trail), when it comes from one. */
  metres: number | null;
  /** What was compared with it: the claim, or (trail) everything claimed for that day. */
  claimed: number;
};

/** The checks as kept on the claim (StaffClaim.check). */
export type ClaimCheck = {
  duty: ClaimDuty;
  /** GPS attendance was on. */
  gps: boolean;
  /** The day's GPS trail: metres travelled, and how many positions. */
  trailMetres: number | null;
  points: number;
  /** Places on the route the trail never reached. */
  missed: string[];
  /** The usual price the claim was compared with (the one that flagged it, if any). */
  usual: UsualPrice | null;
  /** The number of an earlier claim it looks the same as. */
  duplicateOf: string | null;
  /** Checked while the shift was still open (checked again at check-out). */
  shiftOpen: boolean;
};

export type ClaimCheckInput = {
  kind: StaffClaimKind;
  amount: number;
  fromPlace: string | null;
  toPlace: string | null;
  duty: ClaimDuty;
  gps: boolean;
  shiftOpen: boolean;
  /** The shift's positions (check-in, pings, check-out), oldest first. */
  trail: readonly Fix[];
  places: readonly Place[];
  /** The usual fare for a km; 0 leaves the distance out of the price check. */
  ratePerKm: number;
  /** The person's other conveyance claims for the same day, added up. */
  sameDayOthers: number;
  /** Amounts approved for the same route before. */
  routeHistory: readonly number[];
  /** Google Maps' road route, when connected and found. */
  road: { metres: number | null; from: LatLng | null; to: LatLng | null } | null;
  duplicateOf: string | null;
  hasReceipt: boolean;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Lower case, punctuation as spaces, single spaces: "Head Office," is "head office". */
export function normalizePlace(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** The same key for a route either way round, or null without both ends. */
export function routeKey(from: string | null | undefined, to: string | null | undefined) {
  const a = normalizePlace(from);
  const b = normalizePlace(to);
  if (!a || !b) return null;
  return [a, b].sort().join(" | ");
}

/** The work places named on the route ("Head office to Uttara warehouse"). */
export function placesOnRoute(
  texts: ReadonlyArray<string | null | undefined>,
  places: readonly Place[],
): Place[] {
  const route = ` ${texts.map(normalizePlace).join(" ")} `;
  return places.filter((p) => {
    const name = normalizePlace(p.name);
    return name.length > 0 && route.includes(` ${name} `);
  });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The usual fare for a distance: at least MIN_FARE_KM at the rate per km. */
export function usualFare(metres: number, ratePerKm: number): number {
  return round2(Math.max(metres / 1000, MIN_FARE_KM) * ratePerKm);
}

/** Whether any trail position is inside the place (allowing for vague positions). */
function reached(place: Place, trail: readonly Fix[]) {
  return trail.some((p) => !checkAgainstPlaces(p, [place], place.id)!.away);
}

/** Whether any trail position is near a point Google Maps found. */
function passes(point: LatLng, trail: readonly Fix[]) {
  return trail.some(
    (p) =>
      distanceMetres(p, point) <= ROUTE_MATCH_METRES + Math.min(Math.max(p.accuracy ?? 0, 0), 200),
  );
}

/** The flags a claim gets, and what the checks found. */
export function checkClaim(input: ClaimCheckInput): {
  flags: StaffClaimFlag[];
  check: ClaimCheck;
} {
  const flags: StaffClaimFlag[] = [];
  const check: ClaimCheck = {
    duty: input.duty,
    gps: input.gps,
    trailMetres: null,
    points: input.trail.length,
    missed: [],
    usual: null,
    duplicateOf: input.duplicateOf,
    shiftOpen: input.shiftOpen,
  };

  if (input.kind === "LOCAL_MATERIAL") {
    // Bought, not travelled: the shift and its trail do not come into it.
    check.shiftOpen = false;
    if (!input.hasReceipt) flags.push("NO_RECEIPT");
    if (input.duplicateOf) flags.push("DUPLICATE");
    return { flags, check };
  }

  if (input.duty !== "ON_DUTY") flags.push("NOT_ON_DUTY");
  const trail = input.gps ? input.trail : [];
  const hasTrail = trail.length >= 2;
  if (input.gps && trail.length > 0) check.trailMetres = trailMetres(trail);
  if (input.gps && input.duty === "ON_DUTY") {
    if (!hasTrail) flags.push("NO_TRAIL");
    else if ((check.trailMetres ?? 0) < NO_TRAVEL_METRES) flags.push("NO_TRAVEL");
  }

  if (hasTrail) {
    const missed = placesOnRoute([input.fromPlace, input.toPlace], input.places)
      .filter((place) => !reached(place, trail))
      .map((place) => place.name);
    const road = input.road;
    if (road?.from && input.fromPlace && !passes(road.from, trail)) missed.push(input.fromPlace);
    if (road?.to && input.toPlace && !passes(road.to, trail)) missed.push(input.toPlace);
    check.missed = [...new Set(missed)];
    if (check.missed.length > 0) flags.push("ROUTE_MISMATCH");
  }

  const comparisons: UsualPrice[] = [];
  if (input.ratePerKm > 0) {
    const roadMetres = input.road?.metres ?? null;
    if (roadMetres !== null && roadMetres > 0) {
      comparisons.push({
        basis: "ROAD",
        amount: usualFare(roadMetres, input.ratePerKm),
        metres: roadMetres,
        claimed: input.amount,
      });
    } else if (check.trailMetres !== null && check.trailMetres >= NO_TRAVEL_METRES) {
      // The trail is the whole shift, so it is compared with all of the day's claims.
      comparisons.push({
        basis: "TRAIL",
        amount: usualFare(check.trailMetres, input.ratePerKm),
        metres: check.trailMetres,
        claimed: round2(input.amount + input.sameDayOthers),
      });
    }
  }
  if (input.routeHistory.length >= ROUTE_HISTORY_MIN) {
    comparisons.push({
      basis: "ROUTE",
      amount: round2(median(input.routeHistory)!),
      metres: null,
      claimed: input.amount,
    });
  }
  const high = comparisons.find((c) => c.claimed > c.amount * HIGH_PRICE_FACTOR);
  if (high) flags.push("HIGH_PRICE");
  check.usual = high ?? comparisons[0] ?? null;

  if (input.duplicateOf) flags.push("DUPLICATE");
  return { flags, check };
}
