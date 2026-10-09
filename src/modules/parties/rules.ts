import type { Party, PartyKind, PartyStatus } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import { isWalkIn } from "@/modules/parties/walk-in";

/*
 * What may be done with a buyer or supplier. The party services refuse with
 * these answers and the Buyers & suppliers screens read the same answers to
 * decide what to offer. Holding parties.manage (accounts.manage for opening
 * balances) is checked before these.
 */

export const WALK_IN_KEPT =
  "Walk-in customers is kept by the system for sales without a buyer profile.";

/** The only details of Walk-in customers that can change. */
export const WALK_IN_EDITABLE: readonly string[] = ["name", "notes"];

/** Grade and the Blue Verified badge: not for Walk-in customers. */
export function canChangeStanding(party: Pick<Party, "systemRole">): Verdict {
  if (isWalkIn(party)) return refuse("VALIDATION", WALK_IN_KEPT);
  return ALLOWED;
}

/** Changing these details of the account. */
export function canEditFields(party: Pick<Party, "systemRole">, fields: string[]): Verdict {
  if (isWalkIn(party) && fields.some((f) => !WALK_IN_EDITABLE.includes(f))) {
    return refuse("VALIDATION", `${WALK_IN_KEPT} Only its name and notes can change.`);
  }
  return ALLOWED;
}

/**
 * Buyer to supplier (or back) only with nothing owed either way, since the other
 * side's documents would lose their account. Becoming "both" is always possible.
 */
export function canChangeKind(from: PartyKind, to: PartyKind, balanceIsZero: boolean): Verdict {
  if (from === to || to === "BOTH" || balanceIsZero) return ALLOWED;
  return refuse("CONFLICT", "Settle the balance before changing between buyer and supplier.");
}

/**
 * Moving the account to `status`. Walk-in customers stays open, and only buyers
 * go dormant. Closing an account with money still due makes it settling instead
 * (the party service does that).
 */
export function canSetStatus(
  party: Pick<Party, "kind" | "systemRole">,
  status: PartyStatus,
): Verdict {
  if (isWalkIn(party)) return refuse("VALIDATION", `${WALK_IN_KEPT} It stays open.`);
  if (status === "DORMANT" && party.kind === "SUPPLIER") {
    return refuse("VALIDATION", "Only buyers can be marked dormant.");
  }
  return ALLOWED;
}

/**
 * The status changes a screen offers from where the account is: reopen, mark an
 * active buyer dormant, and close. An account reaches settling by being closed
 * while it still has a balance.
 */
export function statusChoices(party: Pick<Party, "kind" | "status" | "systemRole">): PartyStatus[] {
  const targets: PartyStatus[] = ["ACTIVE", "DORMANT", "CLOSED"];
  return targets.filter(
    (status) =>
      status !== party.status &&
      (status !== "DORMANT" || party.status === "ACTIVE") &&
      canSetStatus(party, status).ok,
  );
}

/** A supplier's opening balance is what was owed to them, never what they owed. */
export function canSetOpeningBalance(party: Pick<Party, "kind">, amount: number): Verdict {
  if (amount > 0 && party.kind === "SUPPLIER") {
    return refuse(
      "VALIDATION",
      "A supplier's opening balance is what you owed them, so it cannot be an amount they owed you.",
    );
  }
  return ALLOWED;
}
