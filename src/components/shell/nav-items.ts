import {
  FactoryIcon,
  HandshakeIcon,
  IdCardIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShirtIcon,
  SpoolIcon,
  UsersRoundIcon,
  WalletIcon,
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
  /** ...unless they hold any of these (they reach the same screens another way). */
  noneOf?: readonly PermissionKey[];
};

/**
 * The permissions that open the Accounts section (the books and reports,
 * supplier payments, everyone's expenses). Money received is recorded where it
 * comes in (Sales), so accounts.receipts.record alone opens nothing here.
 */
const ACCOUNTS_KEYS: readonly PermissionKey[] = [
  "accounts.view",
  "accounts.payments.record",
  "expenses.manage",
];

/**
 * The permissions that open HR & payroll: employees, attendance and leave (the
 * HR keys), payroll for Accounts (accounts.view) and the advances register for
 * whoever pays advances out (accounts.payments.record).
 */
export const HR_KEYS: readonly PermissionKey[] = [
  "hr.view",
  "hr.manage",
  "hr.payroll",
  "accounts.view",
  "accounts.payments.record",
];

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
    // Cash and bank, supplier payments, expenses, the journal, the chart of
    // accounts and the financial reports (components/accounts/tabs.ts).
    href: "/accounts",
    label: "Accounts",
    icon: LandmarkIcon,
    anyOf: ACCOUNTS_KEYS,
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
    // Fabric, trims and packaging: stock in each store, purchase orders, purchases,
    // returns to suppliers and issue notes to production (components/materials/tabs.ts).
    href: "/materials",
    label: "Materials",
    icon: SpoolIcon,
    anyOf: ["materials.view"],
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
    // Employees, attendance, leave, payroll, salary advances, holidays and HR rules
    // (components/hr/tabs.ts).
    href: "/hr",
    label: "HR & payroll",
    shortLabel: "HR",
    icon: UsersRoundIcon,
    anyOf: HR_KEYS,
  },
  {
    // Everyone else who spends company money records their own expenses as
    // claims; it is the Expenses tab of Accounts, reached from its own entry.
    href: "/accounts/expenses",
    label: "Expenses",
    icon: WalletIcon,
    anyOf: ["expenses.create"],
    noneOf: ACCOUNTS_KEYS,
  },
  {
    // The employee's own attendance and check-in, leave, payslips and advances.
    // People who open HR & payroll reach theirs from the account menu instead.
    href: "/me",
    label: "My HR",
    icon: IdCardIcon,
    anyOf: ["portal.self"],
    noneOf: HR_KEYS,
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
  return NAV_ITEMS.filter(
    (item) =>
      holdsAny(permissions, item.anyOf) &&
      !(item.noneOf && item.noneOf.some((p) => permissions.includes(p))),
  );
}

/** Sections that fit in the phone's tab bar; the rest go under "More" with the account menu. */
export const PHONE_TABS = 4;

/** The phone's tab bar: up to PHONE_TABS sections as tabs, and the rest for the "More" menu. */
export function phoneTabs(items: readonly NavItem[]): { tabs: NavItem[]; more: NavItem[] } {
  if (items.length <= PHONE_TABS) return { tabs: [...items], more: [] };
  return { tabs: items.slice(0, PHONE_TABS), more: items.slice(PHONE_TABS) };
}

/**
 * How many sections fit in the top bar on tablets (md), laptops (lg) and
 * computers (xl); the rest go under its "More" menu at that width.
 */
export const TOP_BAR_TABS = { md: 4, lg: 5, xl: 7 } as const;

/**
 * Up to which width a section at this position sits under the top bar's "More":
 * null when it always fits, "md" on tablets only, "lg" on tablets and laptops,
 * "all" at every width.
 */
export function topBarFold(index: number): "md" | "lg" | "all" | null {
  if (index < TOP_BAR_TABS.md) return null;
  if (index < TOP_BAR_TABS.lg) return "md";
  if (index < TOP_BAR_TABS.xl) return "lg";
  return "all";
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
