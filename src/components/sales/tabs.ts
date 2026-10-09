import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type SalesTab = { href: string; label: string; anyOf: readonly PermissionKey[] };

/*
 * The Sales area's tabs, shown to the people their Server Actions let in: every
 * list reads with sales.view. What may be done in each comes with its screen.
 */
export const SALES_TABS: readonly SalesTab[] = [
  { href: "/sales/orders", label: "Orders", anyOf: ["sales.view"] },
  { href: "/sales/quotations", label: "Quotations", anyOf: ["sales.view"] },
  { href: "/sales/proformas", label: "Proformas", anyOf: ["sales.view"] },
  { href: "/sales/invoices", label: "Invoices", anyOf: ["sales.view"] },
  { href: "/sales/payments", label: "Payments", anyOf: ["sales.view"] },
];

/** The tabs this person may open, in order; the first is where /sales goes. */
export function visibleSalesTabs(permissions: Iterable<string>): SalesTab[] {
  const held = [...permissions];
  return SALES_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
