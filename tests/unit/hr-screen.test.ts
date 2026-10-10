import type { SystemRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  dayCount,
  hrHref,
  leaveDates,
  leaveTypeText,
  marksVersion,
  minutesText,
  offDaysText,
  payDetails,
  recoveryText,
  shiftMonth,
} from "@/components/hr/labels";
import {
  advanceListQuery,
  advanceViewFrom,
  clearedHrView,
  employeeListQuery,
  employeeViewFrom,
  hrListSearch,
  isHrFiltered,
  leaveListQuery,
  leaveViewFrom,
} from "@/components/hr/list-view";
import { MY_HR_TABS, visibleHrTabs } from "@/components/hr/tabs";
import { phoneTabs, visibleNavItems } from "@/components/shell/nav-items";
import {
  canApproveLeave,
  canCancelLeave,
  canMarkDay,
  canPayPayroll,
  canRemoveHoliday,
  canReopenPayroll,
  canSwitchPaid,
  canVoidAdvance,
  hrKeys,
  mayVoidAdvance,
} from "@/modules/hr/rules";
import { DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from "@/modules/rbac/permissions";

const role = (name: SystemRole): string[] => [...DEFAULT_ROLE_PERMISSIONS[name]];
const holding = (keys: readonly string[]) => ({
  can: (key: PermissionKey) => keys.includes(key),
});
const tabs = (permissions: string[]) => visibleHrTabs(permissions).map((t) => t.label);
const nav = (permissions: string[]) => visibleNavItems(permissions).map((i) => i.href);
const message = (verdict: { ok: boolean; message?: string }) =>
  verdict.ok ? "allowed" : verdict.message;

describe("HR & payroll in the menu, by role", () => {
  const ALL = [
    "Overview",
    "Employees",
    "Attendance",
    "Leave",
    "Payroll",
    "Advances",
    "Holidays & rules",
  ];

  it("gives the owner and Accounts every tab, and My HR from the account menu", () => {
    for (const name of ["SUPER_ADMIN", "ACCOUNTS"] as const) {
      expect(tabs(role(name)), name).toEqual(ALL);
      expect(nav(role(name)), name).toContain("/hr");
      expect(nav(role(name)), name).not.toContain("/me");
    }
    const accounts = phoneTabs(visibleNavItems(role("ACCOUNTS")));
    expect(accounts.more.map((i) => i.href)).toContain("/hr");
  });

  it("gives everyone else My HR in place of HR & payroll", () => {
    for (const name of [
      "PRODUCTION_MANAGER",
      "SALES_EXECUTIVE",
      "WAREHOUSE_TEAM",
      "EMPLOYEE",
    ] as const) {
      expect(tabs(role(name)), name).toEqual([]);
      expect(nav(role(name)), name).not.toContain("/hr");
      expect(nav(role(name)), name).toContain("/me");
    }
    const employee = phoneTabs(visibleNavItems(role("EMPLOYEE")));
    expect(employee.tabs.map((i) => i.href)).toEqual([
      "/",
      "/planner",
      "/accounts/expenses",
      "/me",
    ]);
    expect(MY_HR_TABS.map((t) => t.label)).toEqual([
      "Today",
      "Tasks",
      "Attendance",
      "Leave",
      "Payslips",
      "Advances",
    ]);
  });

  it("keeps salaries from people who only see the staff list", () => {
    expect(tabs(["hr.view"])).toEqual([
      "Overview",
      "Employees",
      "Attendance",
      "Leave",
      "Holidays & rules",
    ]);
    expect(tabs(["accounts.view"])).toEqual(["Payroll", "Advances"]);
    // Whoever pays advances out sees the advances register and nothing else of HR.
    expect(tabs(["accounts.payments.record"])).toEqual(["Advances"]);
    expect(tabs(["portal.self"])).toEqual([]);
  });
});

describe("What each role may do in HR & payroll", () => {
  const keys = (name: SystemRole) => hrKeys(holding(DEFAULT_ROLE_PERMISSIONS[name]));

  it("lets Accounts prepare and pay payroll, and leaves approving it to the owner", () => {
    expect(keys("ACCOUNTS")).toMatchObject({
      view: true,
      manage: false,
      salaries: true,
      advances: true,
      payroll: true,
      approve: false,
      pay: true,
      giveAdvance: true,
      openingAdvance: true,
      self: true,
    });
    expect(keys("SUPER_ADMIN")).toMatchObject({ manage: true, approve: true, pay: true });
  });

  it("gives everyone else only their own records", () => {
    for (const name of [
      "PRODUCTION_MANAGER",
      "SALES_EXECUTIVE",
      "WAREHOUSE_TEAM",
      "EMPLOYEE",
    ] as const) {
      const { self, ...rest } = keys(name);
      expect(self, name).toBe(true);
      expect(Object.values(rest).some(Boolean), name).toBe(false);
    }
  });

  it("voids advances only with both money keys, or accounts.manage for ones brought forward", () => {
    const payer = hrKeys(holding(["accounts.payments.record"]));
    expect(mayVoidAdvance(payer, { isOpening: false })).toBe(false);
    const cashier = hrKeys(holding(["accounts.payments.record", "accounts.receipts.record"]));
    expect(mayVoidAdvance(cashier, { isOpening: false })).toBe(true);
    expect(mayVoidAdvance(cashier, { isOpening: true })).toBe(false);
    expect(mayVoidAdvance(keys("ACCOUNTS"), { isOpening: true })).toBe(true);
  });
});

describe("HR rules, in words HR understands", () => {
  const closed = new Set(["2026-09"]);
  const me = { userId: "u1", isOwner: false };

  it("freezes a month once its payroll is approved", () => {
    expect(message(canMarkDay("2026-09-14", "2026-10-09", closed))).toMatch(
      /payroll for September 2026 is approved, so attendance in that month cannot change/,
    );
    expect(message(canMarkDay("2026-10-10", "2026-10-09", closed))).toMatch(
      /cannot be marked ahead/,
    );
    expect(message(canMarkDay("2026-10-09", "2026-10-09", closed))).toBe("allowed");
    expect(message(canRemoveHoliday("2026-09-01", closed))).toMatch(/holidays in that month/);
    expect(message(canRemoveHoliday("2026-12-16", closed))).toBe("allowed");
  });

  it("has someone else approve one's own leave, and lets employees withdraw only waiting requests", () => {
    const leave = { status: "PENDING" as const, employeeUserId: "u1", months: ["2026-10"] };
    expect(message(canApproveLeave(leave, me, closed))).toMatch(/Someone else must approve/);
    expect(message(canApproveLeave(leave, { userId: "u2", isOwner: false }, closed))).toBe(
      "allowed",
    );
    const employee = { ...me, manage: false };
    expect(message(canCancelLeave(leave, employee, closed))).toBe("allowed");
    expect(message(canCancelLeave({ ...leave, status: "APPROVED" }, employee, closed))).toMatch(
      /Ask HR to cancel/,
    );
    expect(message(canCancelLeave({ ...leave, employeeUserId: "u2" }, employee, closed))).toMatch(
      /Only HR/,
    );
  });

  it("fixes paid or unpaid once a leave type has been taken", () => {
    expect(message(canSwitchPaid({ name: "Sick leave" }, 2))).toMatch(
      /Sick leave already has approved leave/,
    );
    expect(message(canSwitchPaid({ name: "Sick leave" }, 0))).toBe("allowed");
  });

  it("pays an approved payroll and reopens it only with no salary paid", () => {
    const run = { year: 2026, month: 10, status: "DRAFT" as const };
    expect(message(canPayPayroll(run, 3))).toMatch(/Approve the payroll for October 2026/);
    expect(message(canPayPayroll({ ...run, status: "APPROVED" }, 0))).toMatch(/Nothing is left/);
    expect(message(canPayPayroll({ ...run, status: "APPROVED" }, 2))).toBe("allowed");
    expect(message(canReopenPayroll({ ...run, status: "APPROVED" }, 1))).toMatch(
      /void those payments first/,
    );
    expect(
      message(canVoidAdvance({ number: "ADV-0002", status: "OPEN", isOpening: false }, 1)),
    ).toMatch(/Part of ADV-0002 has been recovered/);
  });
});

describe("HR words and figures", () => {
  it("counts days, minutes and leave dates the way people say them", () => {
    expect(dayCount(0.5)).toBe("half a day");
    expect(dayCount(1)).toBe("1 day");
    expect(dayCount(2.5)).toBe("2.5 days");
    expect(minutesText(45)).toBe("45 min");
    expect(minutesText(120)).toBe("2 h");
    expect(minutesText(90)).toBe("1 h 30 min");
    expect(leaveDates({ startDate: "2026-10-05", endDate: "2026-10-05", halfDay: true })).toMatch(
      /, half day$/,
    );
    expect(leaveDates({ startDate: "2026-10-05", endDate: "2026-10-07", halfDay: false })).toMatch(
      / to /,
    );
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("describes the working week, leave types and how an advance comes back", () => {
    expect(offDaysText([5])).toBe("Friday");
    expect(offDaysText([5, 6])).toBe("Friday and Saturday");
    expect(offDaysText([0, 5, 6])).toBe("Sunday, Friday and Saturday");
    expect(offDaysText([])).toBe("None");
    expect(leaveTypeText({ isPaid: true, daysPerYear: 14, prorate: true })).toBe(
      "14 days a year, shared out by the months worked",
    );
    expect(leaveTypeText({ isPaid: true, daysPerYear: 10, prorate: false })).toBe("10 days a year");
    expect(leaveTypeText({ isPaid: false, daysPerYear: 0, prorate: false })).toBe(
      "Unpaid, taken off the salary",
    );
    expect(recoveryText({ installmentAmount: "2000.00", recoverFrom: "2026-11" }, "BDT")).toMatch(
      /^BDT 2,000\.00 a month from /,
    );
    expect(recoveryText({ installmentAmount: null, recoverFrom: "2026-11" }, "BDT")).toMatch(
      /^All at the .* payroll$/,
    );
  });

  it("says where a salary goes", () => {
    const base = { bankName: "City Bank", bankAccountNumber: "123", walletNumber: "01711000000" };
    expect(payDetails({ ...base, salaryMethod: "BANK_TRANSFER" })).toBe("City Bank · 123");
    expect(payDetails({ ...base, salaryMethod: "BKASH" })).toBe("01711000000");
    expect(payDetails({ ...base, salaryMethod: "CASH" })).toBeNull();
  });

  it("starts the attendance register again only when the saved marks change", () => {
    const row = (status: string) => ({
      employee: { id: "e1" },
      mark: {
        id: "m1",
        status,
        checkIn: "09:05",
        checkOut: null,
        overtimeMinutes: 0,
        note: null,
      },
    });
    expect(marksVersion([row("PRESENT")])).toBe(marksVersion([row("PRESENT")]));
    expect(marksVersion([row("PRESENT")])).not.toBe(marksVersion([row("LATE")]));
    expect(marksVersion([{ employee: { id: "e1" }, mark: null }])).not.toBe(
      marksVersion([row("PRESENT")]),
    );
  });
});

describe("HR filters and addresses", () => {
  it("keeps only known filters and well-formed ids", () => {
    const people = employeeViewFrom({
      q: "  rahim ",
      status: "FIRED",
      department: "Cutting",
      former: "1",
    });
    expect(people).toEqual({
      list: "employees",
      q: "rahim",
      department: "Cutting",
      status: undefined,
      former: true,
    });
    expect(hrListSearch(people)).toBe("?q=rahim&department=Cutting&former=1");
    expect(employeeListQuery(people, "c1")).toMatchObject({
      search: "rahim",
      department: "Cutting",
      former: true,
      cursor: "c1",
    });
    const leave = leaveViewFrom({ status: "PENDING", type: "bad id!", employee: "e1" });
    expect(leave).toEqual({ list: "leave", status: "PENDING", type: undefined, employee: "e1" });
    expect(leaveListQuery(leave)).toMatchObject({ status: "PENDING", employeeId: "e1" });
    const advances = advanceViewFrom({ status: "OPEN" });
    expect(advanceListQuery(advances)).toMatchObject({ status: "OPEN" });
  });

  it("clears back to an unfiltered list", () => {
    const leave = leaveViewFrom({ status: "APPROVED" });
    expect(isHrFiltered(leave)).toBe(true);
    expect(clearedHrView(leave)).toEqual({ list: "leave" });
    expect(hrListSearch(clearedHrView(employeeViewFrom({ q: "x" })))).toBe("");
  });

  it("builds addresses with only the query they need", () => {
    expect(hrHref.employee("e1")).toBe("/hr/employees/e1");
    expect(hrHref.employee("e1", 2025)).toBe("/hr/employees/e1?year=2025");
    expect(hrHref.employeeMonth("a/b", "2026-09")).toBe(
      "/hr/employees/a%2Fb/attendance?month=2026-09",
    );
    expect(hrHref.attendance()).toBe("/hr/attendance");
    expect(hrHref.newLeave("e1")).toBe("/hr/leave/new?employee=e1");
    expect(hrHref.payslip("r1", "i1")).toBe("/hr/payroll/r1/payslips/i1");
    expect(hrHref.settings(2027)).toBe("/hr/settings?year=2027");
    expect(hrHref.myMonth()).toBe("/me/attendance");
    expect(hrHref.myLeave(2025)).toBe("/me/leave?year=2025");
    expect(hrHref.myPayslip("i1")).toBe("/me/payslips/i1");
  });
});
