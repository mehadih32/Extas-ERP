import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type MaterialsTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these... */
  anyOf: readonly PermissionKey[];
  /** ...and, when given, any of these too. */
  andAnyOf?: readonly PermissionKey[];
};

/** The people who see material prices and values (materials/access.ts). */
const SEE_COSTS: readonly PermissionKey[] = [
  "materials.purchase",
  "production.manage",
  "accounts.view",
  "accounts.manage",
  "accounts.payments.record",
];

/*
 * The Raw materials area's tabs, shown to the people their Server Actions let
 * in: stock, purchase orders and issue notes read with materials.view;
 * purchases and returns to suppliers are bills, so they need the prices too.
 */
export const MATERIALS_TABS: readonly MaterialsTab[] = [
  { href: "/materials", label: "Overview", anyOf: ["materials.view"] },
  { href: "/materials/stock", label: "Stock", anyOf: ["materials.view"] },
  { href: "/materials/orders", label: "Purchase orders", anyOf: ["materials.view"] },
  {
    href: "/materials/purchases",
    label: "Purchases",
    anyOf: ["materials.view"],
    andAnyOf: SEE_COSTS,
  },
  {
    href: "/materials/returns",
    label: "Supplier returns",
    anyOf: ["materials.view"],
    andAnyOf: SEE_COSTS,
  },
  { href: "/materials/issues", label: "Issue notes", anyOf: ["materials.view"] },
];

/** The tabs this person may open, in order. */
export function visibleMaterialsTabs(permissions: Iterable<string>): MaterialsTab[] {
  const held = [...permissions];
  return MATERIALS_TABS.filter(
    (tab) => holdsAny(held, tab.anyOf) && (!tab.andAnyOf || holdsAny(held, tab.andAnyOf)),
  );
}
