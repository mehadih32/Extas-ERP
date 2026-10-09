import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type PartiesTab = { href: string; label: string; anyOf: readonly PermissionKey[] };

/*
 * The Buyers & suppliers area's tabs, shown to the people their Server Actions
 * let in: the lists and profiles need parties.view; what everyone owes and is
 * owed, like the statements, needs parties.ledger.view.
 */
export const PARTIES_TABS: readonly PartiesTab[] = [
  { href: "/parties/buyers", label: "Buyers", anyOf: ["parties.view"] },
  { href: "/parties/suppliers", label: "Suppliers", anyOf: ["parties.view"] },
  { href: "/parties/dues", label: "Dues", anyOf: ["parties.ledger.view"] },
];

/** The tabs this person may open, in order; the first is where /parties goes. */
export function visiblePartiesTabs(permissions: Iterable<string>): PartiesTab[] {
  const held = [...permissions];
  return PARTIES_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
