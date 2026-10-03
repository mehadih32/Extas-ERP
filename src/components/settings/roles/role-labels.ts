import type { AppModule, SystemRole } from "@prisma/client";

import { MONEY_PERMISSIONS, PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

/*
 * How the Roles screens group and describe permissions. Every permission in the
 * catalogue (rbac/permissions.ts) belongs to exactly one group here; a test
 * keeps it that way as modules add keys.
 */

export type PermissionItem = { key: PermissionKey; description: string; money: boolean };

export type PermissionGroup = {
  id: string;
  label: string;
  /** Said once above the group's permissions. */
  note?: string;
  permissions: PermissionItem[];
};

const SECTIONS: Array<{ id: string; label: string; modules: AppModule[]; note?: string }> = [
  { id: "dashboard", label: "Dashboard", modules: ["DASHBOARD"] },
  {
    id: "administration",
    label: "Company administration",
    modules: ["SETTINGS"],
    note: "These let people manage the team, the roles and the company details. Someone who can manage roles can give any role every permission, so keep them for people you trust with the whole company.",
  },
  { id: "sales", label: "Sales", modules: ["SALES", "RETAIL", "WHOLESALE"] },
  { id: "stock", label: "Stock and raw materials", modules: ["INVENTORY"] },
  { id: "production", label: "Production", modules: ["PRODUCTION"] },
  { id: "parties", label: "Buyers and suppliers", modules: ["PARTIES"] },
  {
    id: "accounts",
    label: "Accounts",
    modules: ["ACCOUNTS"],
    note: "Recording money in or out is kept to Accounts and Super Admin by default, so the people who sell or produce never record cash themselves.",
  },
  { id: "expenses", label: "Expenses", modules: ["EXPENSES"] },
  { id: "hr", label: "HR and payroll", modules: ["HR"] },
  { id: "compliance", label: "Licences and registrations", modules: ["COMPLIANCE"] },
  { id: "documents", label: "Documents and letterhead", modules: ["TEMPLATES"] },
  { id: "reports", label: "Reports", modules: ["REPORTS"] },
  { id: "notepad", label: "Notepad and reminders", modules: ["NOTEPAD", "REMINDERS"] },
  { id: "backups", label: "Backups", modules: ["BACKUPS"] },
];

const MONEY = new Set<string>(MONEY_PERMISSIONS);

/** Whether a permission records money coming in or going out. */
export function isMoneyPermission(key: string): boolean {
  return MONEY.has(key);
}

/** The catalogue in the groups the role editor shows, each in catalogue order. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = SECTIONS.map((section) => ({
  id: section.id,
  label: section.label,
  note: section.note,
  permissions: PERMISSIONS.filter((p) => (section.modules as string[]).includes(p.module)).map(
    (p) => ({ key: p.key, description: p.description, money: MONEY.has(p.key) }),
  ),
})).filter((group) => group.permissions.length > 0);

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
