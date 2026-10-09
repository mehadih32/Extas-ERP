import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type AccountsTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these. */
  anyOf: readonly PermissionKey[];
};

/*
 * The Accounts area's tabs, shown to the people their Server Actions let in.
 * The books, balances and reports read with accounts.view; supplier payments
 * also open to whoever pays them (accounts.payments.record); expenses open to
 * everyone who records one, who then sees only their own.
 */
export const ACCOUNTS_TABS: readonly AccountsTab[] = [
  { href: "/accounts", label: "Overview", anyOf: ["accounts.view"] },
  { href: "/accounts/cash-bank", label: "Cash & bank", anyOf: ["accounts.view"] },
  {
    href: "/accounts/supplier-payments",
    label: "Supplier payments",
    anyOf: ["accounts.view", "accounts.payments.record"],
  },
  {
    href: "/accounts/expenses",
    label: "Expenses",
    anyOf: ["expenses.create", "expenses.manage", "accounts.view", "accounts.payments.record"],
  },
  { href: "/accounts/journal", label: "Journal", anyOf: ["accounts.view"] },
  { href: "/accounts/chart", label: "Chart of accounts", anyOf: ["accounts.view"] },
  { href: "/accounts/reports", label: "Reports", anyOf: ["accounts.view"] },
];

/** The tabs this person may open, in order; the first is where /accounts goes. */
export function visibleAccountsTabs(permissions: Iterable<string>): AccountsTab[] {
  const held = [...permissions];
  return ACCOUNTS_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}
