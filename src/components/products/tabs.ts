import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type ProductsTab = { href: string; label: string; anyOf: readonly PermissionKey[] };

/*
 * The Products area's tabs, shown to the people their Server Actions let in.
 * Styles (with their stock matrix), bad stock and the catalogue setup can be read
 * with inventory.view; changing them needs inventory.manage, as does the stock
 * count, which only exists to change stock.
 */
export const PRODUCTS_TABS: readonly ProductsTab[] = [
  { href: "/products", label: "Styles", anyOf: ["inventory.view"] },
  { href: "/products/stock-count", label: "Stock count", anyOf: ["inventory.manage"] },
  { href: "/products/bad-stock", label: "Bad stock", anyOf: ["inventory.view"] },
  { href: "/products/setup", label: "Setup", anyOf: ["inventory.view"] },
];

/** The tabs this person may open, in order. */
export function visibleProductsTabs(permissions: Iterable<string>): ProductsTab[] {
  const held = [...permissions];
  return PRODUCTS_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
