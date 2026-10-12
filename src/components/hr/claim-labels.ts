import type { StaffClaimFlag, StaffClaimKind } from "@prisma/client";

import { money } from "@/components/sales/labels";
import type { ClaimCheck, ClaimDuty } from "@/modules/hr/claims";
import type { MyClaimState } from "@/modules/hr/claims.service";
import { distanceText } from "@/modules/hr/geo";

/*
 * Words for staff claims (conveyance and local material), shared by the HR
 * claims ledger and My HR. The flags and what the checks found are for HR and
 * Accounts only.
 */

export const CLAIM_KIND_LABELS: Record<StaffClaimKind, string> = {
  CONVEYANCE: "Conveyance",
  LOCAL_MATERIAL: "Local material",
};

export const CLAIM_FLAG_LABELS: Record<StaffClaimFlag, string> = {
  NOT_ON_DUTY: "Not on duty",
  NO_TRAIL: "No GPS trail",
  NO_TRAVEL: "No travel",
  ROUTE_MISMATCH: "Route not on the trail",
  HIGH_PRICE: "Price unusually high",
  DUPLICATE: "Claimed already",
  NO_RECEIPT: "No receipt",
};

/** How My HR names where a claim stands. */
export const MY_CLAIM_STATE_LABELS: Record<MyClaimState, string> = {
  WAITING: "Waiting for Accounts",
  OWED: "Approved, to be paid",
  PAID: "Paid back",
  CANCELLED: "Cancelled by Accounts",
  REJECTED: "Not approved",
  WITHDRAWN: "Withdrawn",
};

const DUTY_TEXT: Record<Exclude<ClaimDuty, "ON_DUTY">, string> = {
  NO_CHECK_IN: "Did not check in that day.",
  ABSENT: "Marked absent that day.",
  ON_LEAVE: "On leave that day.",
  DAY_OFF: "A day off, with no check-in.",
};

/**
 * What the checks found, one sentence per flag, for HR and Accounts:
 * "The GPS trail never reached Uttara warehouse that day."
 */
export function claimFlagNotes(
  row: {
    flags: readonly StaffClaimFlag[];
    check: ClaimCheck | null;
    amount: string;
  },
  currency: string,
): string[] {
  const c = row.check;
  return row.flags.map((flag) => {
    switch (flag) {
      case "NOT_ON_DUTY":
        return c && c.duty !== "ON_DUTY" ? DUTY_TEXT[c.duty] : "Not on duty that day.";
      case "NO_TRAIL":
        return "GPS attendance is on, but the day has no positions to check the trip against.";
      case "NO_TRAVEL":
        return `The GPS trail shows only ${distanceText(c?.trailMetres ?? 0)} of travel that day.`;
      case "ROUTE_MISMATCH":
        return `The GPS trail never reached ${(c?.missed ?? []).join(" or ") || "a place on the route"} that day.`;
      case "HIGH_PRICE": {
        const u = c?.usual;
        if (!u) return "More than half again the usual price.";
        const usual = money(u.amount.toFixed(2), currency);
        const claimed = money(u.claimed.toFixed(2), currency);
        if (u.basis === "ROAD") {
          return `${claimed} is more than half again the usual ${usual} for ${distanceText(u.metres ?? 0)} by road.`;
        }
        if (u.basis === "TRAIL") {
          return `${claimed} claimed for the day is more than half again the usual ${usual} for the ${distanceText(
            u.metres ?? 0,
          )} the GPS trail shows.`;
        }
        return `${claimed} is more than half again the usual ${usual} for this route.`;
      }
      case "DUPLICATE":
        return c?.duplicateOf
          ? `Looks the same as ${c.duplicateOf}.`
          : "Looks the same as an earlier claim.";
      case "NO_RECEIPT":
        return "No receipt or memo photo.";
    }
  });
}

/**
 * What the GPS trail and the usual price say when nothing is wrong, for the
 * claim card: "GPS trail: 8.4 km in 46 positions · Usual ৳252 for the trail".
 */
export function claimCheckSummary(check: ClaimCheck | null, currency: string): string | null {
  if (!check) return null;
  const parts: string[] = [];
  if (check.gps && check.trailMetres !== null) {
    parts.push(
      `GPS trail that day: ${distanceText(check.trailMetres)} in ${check.points} position${
        check.points === 1 ? "" : "s"
      }`,
    );
  }
  if (check.usual) {
    const usual = money(check.usual.amount.toFixed(2), currency);
    parts.push(
      check.usual.basis === "ROUTE"
        ? `usually ${usual} for this route`
        : check.usual.basis === "ROAD"
          ? `usually ${usual} for ${distanceText(check.usual.metres ?? 0)} by road`
          : `usually ${usual} for the trail`,
    );
  }
  if (check.shiftOpen) parts.push("the shift is still open: checked again at check-out");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Head office → Mirpur 10", or "Yarn (5 kg) for PRD-2026-00003". */
export function claimTitle(c: {
  kind: StaffClaimKind;
  fromPlace: string | null;
  toPlace: string | null;
  item: string | null;
  quantity: string | null;
}): string {
  if (c.kind === "CONVEYANCE") return `${c.fromPlace ?? "?"} → ${c.toPlace ?? "?"}`;
  return `${c.item ?? "Material"}${c.quantity ? ` (${c.quantity})` : ""}`;
}
