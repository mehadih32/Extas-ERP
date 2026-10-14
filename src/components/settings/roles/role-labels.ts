import type { SystemRole } from "@prisma/client";

import { MONEY_PERMISSIONS, PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

import { ACCESS_TREE, leavesOf, permissionDescription } from "./access-tree";

/*
 * How the Roles screens group and describe permissions: by the main areas of the
 * access tree (./access-tree.ts), which holds every permission in the catalogue
 * (rbac/permissions.ts) exactly once; a test keeps it that way as modules add keys.
 */

export type PermissionItem = { key: PermissionKey; description: string; money: boolean };

export type PermissionGroup = {
  id: string;
  label: string;
  /** Said once above the group's permissions. */
  note?: string;
  permissions: PermissionItem[];
};

const MONEY = new Set<string>(MONEY_PERMISSIONS);

/** Whether a permission records money coming in or going out. */
export function isMoneyPermission(key: string): boolean {
  return MONEY.has(key);
}

/**
 * The catalogue in the groups the role screens list it by: the access tree's main
 * areas, each with its permissions in the tree's order.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = ACCESS_TREE.map((area) => ({
  id: area.id,
  label: area.label,
  note: area.note,
  permissions: leavesOf(area).map((l) => ({
    key: l.key,
    description: permissionDescription(l.key),
    money: MONEY.has(l.key),
  })),
}));

export const PERMISSION_COUNT = PERMISSIONS.length;

/**
 * What each built-in role is for, shown until an admin writes a description of
 * their own. Their permissions can still be changed, so these say what the role
 * is for rather than listing what it holds.
 */
const BUILT_IN_SUMMARIES: Record<SystemRole, string> = {
  SUPER_ADMIN: "The owners: every permission, always, including the team and the roles.",
  ACCOUNTS: "For the accounts team: money in and out, the books, expenses and payroll.",
  PRODUCTION_MANAGER: "For production: projects, raw materials, purchases and stock intake.",
  SALES_EXECUTIVE: "For the sales team: quotations, orders and buyers. They do not record money.",
  WAREHOUSE_TEAM: "For the store: stock counts, raw materials and checking returned goods.",
  EMPLOYEE: "For everyone else: their own attendance, leave, payslips and expense claims.",
};

/** The role's own description, or what a built-in role is for. */
export function roleSummary(role: {
  description: string | null;
  systemRole: SystemRole | null;
}): string | null {
  return role.description ?? (role.systemRole ? BUILT_IN_SUMMARIES[role.systemRole] : null);
}

/** Whether giving this role money permissions goes past the house rule (Accounts and Super Admin). */
export function warnsAboutMoney(
  role: { systemRole: SystemRole | null } | null,
  permissions: Iterable<string>,
): boolean {
  if (role?.systemRole === "ACCOUNTS" || role?.systemRole === "SUPER_ADMIN") return false;
  return [...permissions].some(isMoneyPermission);
}
