import {
  FactoryIcon,
  HandshakeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShirtIcon,
} from "lucide-react";

import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * The app's sections, in menu order. Each module's screens add their entry here
 * with the permissions that open them (the same keys their Server Actions check).
 */
export type NavItem = {
  href: string;
  label: string;
  /** A shorter name for the phone's tab bar, where the cells are narrow. */
  shortLabel?: string;
  icon: LucideIcon;
  /** Shown to people holding any of these permissions; to everyone when empty. */
  anyOf: readonly PermissionKey[];
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon, anyOf: [] },
  {
    // Orders, quotations, proforma invoices, invoices and payments
    // (components/sales/tabs.ts).
    href: "/sales",
    label: "Sales",
    icon: ReceiptTextIcon,
    anyOf: ["sales.view"],
  },
  {
    // The production overview, projects, factory deliveries, supplier bills and
    // cost heads (components/production/tabs.ts). The store team, who only
    // receive goods, land on its Deliveries tab.
    href: "/production",
    label: "Production",
    icon: FactoryIcon,
    anyOf: ["production.view", "production.stock_intake"],
  },
  {
    // Styles and their stock matrix, stock counts, bad stock and the catalogue setup
    // (components/products/tabs.ts).
    href: "/products",
    label: "Products",
    icon: ShirtIcon,
    anyOf: ["inventory.view"],
  },
  {
    // Buyers, suppliers and what they owe or are owed (components/parties/tabs.ts).
    href: "/parties",
    label: "Buyers & suppliers",
    shortLabel: "Parties",
    icon: HandshakeIcon,
    anyOf: ["parties.view", "parties.ledger.view"],
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

/** Sections that fit in the phone's tab bar; the rest go under "More" with the account menu. */
export const PHONE_TABS = 4;

/** The phone's tab bar: up to PHONE_TABS sections as tabs, and the rest for the "More" menu. */
export function phoneTabs(items: readonly NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  if (items.length <= PHONE_TABS) return { tabs: [...items], more: [] };
  return { tabs: items.slice(0, PHONE_TABS), more: items.slice(PHONE_TABS) };
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
