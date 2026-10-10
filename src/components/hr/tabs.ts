import { holdsAny } from "@/components/shell/nav-items";
import type { PermissionKey } from "@/modules/rbac/permissions";

export type HrTab = {
  href: string;
  label: string;
  /** Shown to people holding any of these. */
  anyOf: readonly PermissionKey[];
};

/** Employees, attendance, leave and holidays (hr.actions.ts hrRead). */
const HR_READ: readonly PermissionKey[] = ["hr.view", "hr.manage", "hr.payroll"];
/** Salaries and payroll (hr/access.ts canSeeSalaries). */
const SALARIES: readonly PermissionKey[] = ["hr.manage", "hr.payroll", "accounts.view"];

/*
 * The HR & payroll area's tabs, shown to the people their Server Actions let
 * in: employees, attendance, leave and holidays read with any HR key; payroll
 * with the keys that see salaries; the advances register also opens to whoever
 * pays advances out (accounts.payments.record).
 */
export const HR_TABS: readonly HrTab[] = [
  { href: "/hr", label: "Overview", anyOf: HR_READ },
  { href: "/hr/employees", label: "Employees", anyOf: HR_READ },
  { href: "/hr/attendance", label: "Attendance", anyOf: HR_READ },
  { href: "/hr/leave", label: "Leave", anyOf: HR_READ },
  { href: "/hr/payroll", label: "Payroll", anyOf: SALARIES },
  {
    href: "/hr/advances",
    label: "Advances",
    anyOf: [...SALARIES, "accounts.payments.record"],
  },
  { href: "/hr/settings", label: "Holidays & rules", anyOf: HR_READ },
];

/** The tabs this person may open, in order; the first is where /hr goes. */
export function visibleHrTabs(permissions: Iterable<string>): HrTab[] {
  const held = [...permissions];
  return HR_TABS.filter((tab) => holdsAny(held, tab.anyOf));
}

/** The employee's own pages ("My HR", portal.self). */
export const MY_HR_TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/me", label: "Today" },
  { href: "/me/attendance", label: "Attendance" },
  { href: "/me/leave", label: "Leave" },
  { href: "/me/payslips", label: "Payslips" },
  { href: "/me/advances", label: "Advances" },
];
