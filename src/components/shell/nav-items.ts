import { LayoutDashboardIcon, type LucideIcon, SettingsIcon, ShirtIcon } from "lucide-react";

import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The app's sections, in menu order. Each module's screens add their entry here
 * with the permissions that open them (the same keys their Server Actions check).
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown to people holding any of these permissions; to everyone when empty. */
  anyOf: readonly PermissionKey[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon, anyOf: [] },
  {
    // Styles and their stock matrix, stock counts, bad stock and the catalogue setup
    // (components/products/tabs.ts).
    href: "/products",
    label: "Products",
    icon: ShirtIcon,
    anyOf: ["inventory.view"],
  },
  {
    // Team, roles and company details (components/settings/tabs.ts).
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
    anyOf: ["company.members.manage", "company.roles.manage", "company.settings"],
  },
];

/** Whether someone holding `permissions` may see an entry with these `anyOf` permissions. */
export function holdsAny(permissions: Iterable<string>, anyOf: readonly string[]): boolean {
  if (anyOf.length === 0) return true;
  const held = new Set(permissions);
  return anyOf.some((p) => held.has(p));
}

/** The sections this person may open in the active company. */
export function visibleNavItems(permissions: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => holdsAny(permissions, item.anyOf));
}

/** Whether a menu entry is the current section ("/sales" also covers "/sales/123"). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The tab a page belongs to: the longest tab address it sits under, so
 * "/products/stock-count" is the Stock count tab rather than Styles ("/products").
 */
export function activeTabHref(pathname: string, hrefs: readonly string[]): string | undefined {
  return hrefs
    .filter((href) => isActivePath(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
}
