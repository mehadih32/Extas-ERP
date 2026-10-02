import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { localDay, weekday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { money } from "@/modules/accounts/balances";
import * as chart from "@/modules/accounts/chart.service";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { addDays } from "@/modules/accounts/periods";
import * as reports from "@/modules/accounts/reports.service";
import type { CompanyContext } from "@/modules/auth/context";
import * as expenses from "@/modules/expenses/expense.service";
import * as advances from "@/modules/hr/advance.service";
import * as attendance from "@/modules/hr/attendance.service";
import { eachDay, monthRange } from "@/modules/hr/calendar";
import * as employees from "@/modules/hr/employee.service";
import * as leave from "@/modules/hr/leave.service";
import * as payroll from "@/modules/hr/payroll.service";
import * as portal from "@/modules/hr/portal.service";
import * as settings from "@/modules/hr/settings.service";
import { createRole } from "@/modules/rbac/role.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const today = () => localDay(new Date(), TZ);

/** "YYYY-MM" `n` months before this one (negative: ahead). */
function monthsAgo(n: number) {
  const [y, m] = today().split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

/** A month's working days with the default weekly day off (Friday) and no holidays. */
function workingDays(month: string) {
  const { from, to } = monthRange(month);
  return eachDay(from, to).filter((d) => weekday(d) !== 5);
}

/** Last month: the payroll month in these tests. */
const M1 = monthsAgo(1);
const M2 = monthsAgo(2);
const WD = workingDays(M1);
const DIM = monthRange(M1).days;
const wd = (i: number) => WD[i]!;

/**
 * A company with Super Admin, Accounts, a Sales Executive, an Employee (portal
 * login), an "HR Manager" (hr.view + hr.manage) and an "HR Viewer" (hr.view).
 */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roleId);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const admin = await member(roles.SUPER_ADMIN, "admin");
  const hrRole = await createRole(admin.ctx, {
    name: "HR Manager",
    permissions: ["hr.view", "hr.manage", "portal.self"],
  });
  const viewerRole = await createRole(admin.ctx, { name: "HR Viewer", permissions: ["hr.view"] });
  const accounts = await member(roles.ACCOUNTS, "accounts");
  const sales = await member(roles.SALES_EXECUTIVE, "sales");
  const staff = await member(roles.EMPLOYEE, "sumon");
  const hr = await member(hrRole.id, "hr");
  const viewer = await member(viewerRole.id, "viewer");
  const acc = await ensureControlAccounts(company.id);
  const hire = (person: string, salary: number, extra: Record<string, unknown> = {}) =>
    employees.createEmployee(admin.ctx, { name: person, joinDate: "2025-01-01", salary, ...extra });
  return {
    company,
    admin: admin.ctx,
    accounts: accounts.ctx,
    sales: sales.ctx,
    viewer: viewer.ctx,
    hr,
    staff,
    acc,
    hire,
  };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** An account's balance in its normal direction, e.g. "1500.00". */
async function balance(ctx: CompanyContext, accountId: string) {
  return (await chart.getAccount(ctx, accountId)).balance;
}

async function expectBooksOk(ctx: CompanyContext) {
  const check = await reports.getBooksCheck(ctx);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.ok).toBe(true);
  expect(check.checks.map((c) => c.key)).toEqual(
    expect.arrayContaining(["EMPLOYEE_LINES", "EMPLOYEE_ADVANCES", "SALARIES_PAYABLE"]),
  );
}

type Profile = Awaited<ReturnType<typeof employees.getEmployee>>;
/** The profile as HR, payroll and Accounts see it (with salary details). */
const withPay = (p: Profile) => p as Extract<Profile, { salaryHistory: unknown }>;

type Run = Awaited<ReturnType<typeof payroll.getPayrollRun>>;
const line = (r: Run, employeeId: string) => r.items.find((i) => i.employee.id === employeeId)!;

run("employees", () => {
  beforeEach(resetDb);

  it("adds people with codes, keeps salary history and shows pay only to HR, payroll and Accounts", async () => {
    const env = await setup();
    const rahim = await env.hire("Rahim Uddin", 30000, { designation: "Merchandiser" });
    const karim = await env.hire("Karim Mia", 20000, { overtimeRate: 100 });
    expect([rahim.code, karim.code]).toEqual(["EMP-0001", "EMP-0002"]);
    await expectAppError(
      employees.createEmployee(env.hr.ctx, {
        name: "Rahim Again",
        code: "emp-0001",
        joinDate: "2025-01-01",
        salary: 1000,
      }),
      "CONFLICT",
    );
    for (const ctx of [env.sales, env.accounts, env.viewer]) {
      await expectAppError(
        employees.createEmployee(ctx, { name: "Someone", joinDate: "2025-01-01", salary: 1000 }),
        "FORBIDDEN",
      );
    }

    // hr.view sees the profile and leave, not the pay; Accounts sees the pay.
    const asViewer = await employees.getEmployee(env.viewer, rahim.id);
    expect(asViewer).not.toHaveProperty("salary");
    expect(asViewer).not.toHaveProperty("salaryHistory");
    expect(asViewer.leaveBalances.map((b) => b.leaveType.name)).toEqual([
      "Casual Leave",
      "Earned Leave",
      "Maternity Leave",
      "Sick Leave",
      "Unpaid Leave",
    ]);
    expect((await employees.listEmployees(env.viewer)).items[0]).not.toHaveProperty("salary");
    expect(await employees.getEmployee(env.accounts, rahim.id)).toMatchObject({
      salary: "30000.00",
    });

    // A raise from a day onwards; the joining salary stays in the history.
    const raised = withPay(
      await employees.reviseSalary(env.hr.ctx, karim.id, {
        amount: 26000,
        effectiveFrom: `${M1}-16`,
        reason: "Annual raise",
      }),
    );
    expect(raised.salaryHistory.map((r) => [r.effectiveFrom, r.amount])).toEqual([
      ["2025-01-01", "20000.00"],
      [`${M1}-16`, "26000.00"],
    ]);
    expect(raised.salary).toBe("26000.00");
    await expectAppError(
      employees.reviseSalary(env.hr.ctx, karim.id, { amount: 1, effectiveFrom: "2024-12-31" }),
      "VALIDATION",
    );
    await expectAppError(
      employees.deleteSalaryRevision(env.hr.ctx, karim.id, raised.salaryHistory[0]!.id),
      "CONFLICT",
    );

    // Nobody changes their own salary (a Super Admin can).
    const me = await env.hire("Hasina Akter", 25000);
    await employees.grantPortalAccess(env.admin, me.id, { userId: env.hr.user.id });
    await expectAppError(
      employees.reviseSalary(env.hr.ctx, me.id, { amount: 90000, effectiveFrom: today() }),
      "FORBIDDEN",
    );

    // Leaving, and coming back.
    const lastDay = monthRange(M1).to;
    expect(
      await employees.exitEmployee(env.hr.ctx, karim.id, {
        exitDate: lastDay,
        status: "RESIGNED",
        reason: "Moved city",
      }),
    ).toMatchObject({ status: "RESIGNED", exitDate: lastDay, isCurrent: false });
    const names = async (q: Record<string, string> = {}) =>
      (await employees.listEmployees(env.hr.ctx, q)).items.map((e) => e.name);
    expect(await names()).not.toContain("Karim Mia");
    expect(await names({ current: "false" })).toContain("Karim Mia");
    expect(await employees.reinstateEmployee(env.hr.ctx, karim.id)).toMatchObject({
      status: "ACTIVE",
      exitDate: null,
    });

    // Added by mistake: deleted. With records: they stay.
    const typo = await env.hire("Typo", 1000);
    expect(await employees.deleteEmployee(env.hr.ctx, typo.id)).toEqual({ deleted: true });
    await attendance.markAttendance(env.hr.ctx, {
      date: wd(0),
      entries: [{ employeeId: rahim.id, status: "ABSENT" }],
    });
    await expectAppError(employees.deleteEmployee(env.hr.ctx, rahim.id), "CONFLICT");

    // Other companies never see them.
    const other = await setup("Fabric Apparel");
    await expectAppError(employees.getEmployee(other.admin, rahim.id), "NOT_FOUND");
    expect((await employees.listEmployees(other.admin)).items).toEqual([]);
  });
});

run("attendance and leave", () => {
  beforeEach(resetDb);

  it("marks attendance by exception and keeps leave in working days within the allowance", async () => {
    const env = await setup();
    const rahim = await env.hire("Rahim Uddin", 30000);
    const sumon = await env.hire("Sumon Ali", 15000);
    const types = await settings.listLeaveTypes(env.hr.ctx);
    const casual = types.find((t) => t.name === "Casual Leave")!;
    const unpaid = types.find((t) => t.name === "Unpaid Leave")!;
    expect(await settings.getHrSettings(env.viewer)).toMatchObject({
      weeklyOffDays: [5],
      weeklyOffDayNames: ["Friday"],
      officeStartTime: "09:00",
    });

    // Not ahead, only by HR, only while employed.
    const mark = (ctx: CompanyContext, date: string, entries: unknown[]) =>
      attendance.markAttendance(ctx, { date, entries });
    await expectAppError(
      mark(env.hr.ctx, addDays(today(), 1), [{ employeeId: rahim.id, status: "PRESENT" }]),
      "VALIDATION",
    );
    await expectAppError(
      mark(env.viewer, wd(0), [{ employeeId: rahim.id, status: "ABSENT" }]),
      "FORBIDDEN",
    );
    await expectAppError(
      mark(env.hr.ctx, "2024-12-31", [{ employeeId: rahim.id, status: "ABSENT" }]),
      "VALIDATION",
    );
    const day = await mark(env.hr.ctx, wd(0), [
      { employeeId: rahim.id, status: "ABSENT", note: "No call" },
      { employeeId: sumon.id, status: "LATE", checkIn: "09:40", overtimeMinutes: 90 },
    ]);
    expect(day.totals).toMatchObject({ employees: 2, absent: 1, late: 1, unmarked: 0 });
    expect(day.rows.find((r) => r.employee.id === sumon.id)!.mark).toMatchObject({
      status: "LATE",
      checkIn: "09:40",
      overtimeMinutes: 90,
    });
    // Marking again replaces the day's record.
    await mark(env.hr.ctx, wd(0), [
      { employeeId: sumon.id, status: "PRESENT", overtimeMinutes: 90 },
    ]);

    // HR records leave (approved at once): working days only, no overlaps.
    const approved = await leave.createLeave(env.hr.ctx, {
      employeeId: rahim.id,
      leaveTypeId: casual.id,
      startDate: wd(2),
      endDate: wd(3),
      reason: "Family event",
      approve: true,
    });
    expect(approved).toMatchObject({ status: "APPROVED", days: 2 });
    await expectAppError(
      leave.createLeave(env.hr.ctx, {
        employeeId: rahim.id,
        leaveTypeId: unpaid.id,
        startDate: wd(3),
        approve: true,
      }),
      "CONFLICT",
    );
    // Someone on leave is not marked at work, and leave does not cover a day at work.
    await expectAppError(
      mark(env.hr.ctx, wd(2), [{ employeeId: rahim.id, status: "PRESENT" }]),
      "CONFLICT",
    );
    await expectAppError(
      leave.createLeave(env.hr.ctx, {
        employeeId: sumon.id,
        leaveTypeId: casual.id,
        startDate: wd(0),
        approve: true,
      }),
      "CONFLICT",
    );

    // The allowance: 10 days a year; more than is left is refused; HR can set it by hand.
    const year = Number(wd(2).slice(0, 4));
    const casualOf = async (employeeId: string) =>
      (await leave.getLeaveBalances(env.hr.ctx, { employeeId, year })).balances.find(
        (b) => b.leaveType.id === casual.id,
      );
    expect(await casualOf(rahim.id)).toMatchObject({
      entitled: 10,
      used: 2,
      pending: 0,
      remaining: 8,
    });
    const far = Number(M1.slice(5, 7)) <= 6 ? "11" : "02";
    await expectAppError(
      leave.createLeave(env.hr.ctx, {
        employeeId: rahim.id,
        leaveTypeId: casual.id,
        startDate: `${year}-${far}-01`,
        endDate: `${year}-${far}-25`,
        approve: true,
      }),
      "VALIDATION",
    );
    await leave.adjustLeaveBalance(env.hr.ctx, {
      employeeId: rahim.id,
      leaveTypeId: casual.id,
      year,
      entitled: 12.5,
      note: "Carried over",
    });
    expect(await casualOf(rahim.id)).toMatchObject({ entitled: 12.5, remaining: 10.5 });

    // The portal: the employee asks, HR decides.
    await employees.grantPortalAccess(env.hr.ctx, sumon.id, { userId: env.staff.user.id });
    const asked = await leave.requestMyLeave(env.staff.ctx, {
      leaveTypeId: casual.id,
      startDate: wd(6),
      reason: "Doctor",
    });
    expect(asked).toMatchObject({ status: "PENDING", days: 1, employee: { id: sumon.id } });
    const mine = await leave.myLeave(env.staff.ctx, { year });
    expect(mine.requests.map((r) => r.id)).toEqual([asked.id]);
    expect(mine.balances.find((b) => b.leaveType.id === casual.id)).toMatchObject({
      pending: 1,
      used: 0,
    });
    await expectAppError(leave.approveLeave(env.staff.ctx, asked.id, {}), "FORBIDDEN");
    await leave.approveLeave(env.hr.ctx, asked.id, { note: "Get well soon" });
    await expectAppError(leave.cancelMyLeave(env.staff.ctx, asked.id, {}), "CONFLICT");
    await expectAppError(leave.cancelMyLeave(env.staff.ctx, approved.id, {}), "NOT_FOUND");

    // HR does not approve (or cancel) their own leave.
    const hasina = await env.hire("Hasina Akter", 25000);
    await employees.grantPortalAccess(env.admin, hasina.id, { userId: env.hr.user.id });
    const own = await leave.requestMyLeave(env.hr.ctx, {
      leaveTypeId: casual.id,
      startDate: wd(8),
    });
    await expectAppError(leave.approveLeave(env.hr.ctx, own.id, {}), "FORBIDDEN");
    await leave.approveLeave(env.admin, own.id, {});
    await expectAppError(leave.cancelLeave(env.hr.ctx, own.id, {}), "FORBIDDEN");

    // A new holiday re-counts leave over it.
    await settings.createHolidays(env.hr.ctx, { date: wd(3), name: "Special Holiday" });
    expect(await leave.getLeaveRequest(env.hr.ctx, approved.id)).toMatchObject({ days: 1 });
    expect(await casualOf(rahim.id)).toMatchObject({ used: 1 });
    await expectAppError(
      settings.createHolidays(env.hr.ctx, { holidays: [{ date: wd(3), name: "Again" }] }),
      "CONFLICT",
    );

    // What payroll will use for the month.
    const summary = await attendance.getAttendanceSummary(env.hr.ctx, { month: M1 });
    expect(summary.rows.find((r) => r.employee.id === rahim.id)).toMatchObject({
      workingDays: WD.length - 1,
      absentDays: 1,
      paidLeaveDays: 1,
      lateDays: 0,
    });
    expect(summary.rows.find((r) => r.employee.id === sumon.id)).toMatchObject({
      paidLeaveDays: 1,
      absentDays: 0,
      overtimeHours: 1.5,
    });

    // Checking in and out from the portal.
    const checkedIn = await attendance.checkIn(env.staff.ctx, { note: "At the factory" });
    expect(["PRESENT", "LATE"]).toContain(checkedIn.mark?.status);
    expect(checkedIn.mark?.source).toBe("SELF");
    await expectAppError(attendance.checkIn(env.staff.ctx), "CONFLICT");
    expect((await attendance.checkOut(env.staff.ctx)).mark?.checkOut).not.toBeNull();
    await expectAppError(attendance.checkIn(env.sales), "NOT_FOUND");
    await settings.updateHrSettings(env.hr.ctx, { selfCheckIn: false });
    await expectAppError(attendance.checkOut(env.staff.ctx), "FORBIDDEN");
  });
});

run("salary advances and conveyance", () => {
  beforeEach(resetDb);

  it("pays advances from Accounts and settles conveyance from them before cash", async () => {
    const env = await setup();
    const sumon = await env.hire("Sumon Ali", 15000);
    const rahim = await env.hire("Rahim Uddin", 30000);
    await employees.grantPortalAccess(env.hr.ctx, sumon.id, { userId: env.staff.user.id });

    // Only Accounts pays money out.
    for (const ctx of [env.hr.ctx, env.sales, env.staff.ctx]) {
      await expectAppError(
        advances.giveAdvance(ctx, { employeeId: sumon.id, amount: 1000 }),
        "FORBIDDEN",
      );
    }
    const given = await advances.giveAdvance(env.accounts, {
      employeeId: sumon.id,
      amount: 1000,
      purpose: "Factory visits",
    });
    expect(given).toMatchObject({ amount: "1000.00", outstanding: "1000.00", status: "OPEN" });
    expect(given.number).toMatch(/^ADV-/);
    expect(await balance(env.admin, env.acc.EMPLOYEE_ADVANCES)).toBe("1000.00");
    expect(await balance(env.admin, env.acc.CASH)).toBe("-1000.00");

    // A conveyance claim names the employee who recorded it and is paid from their advance.
    const heads = await expenses.listExpenseHeads(env.staff.ctx);
    const conveyance = heads.find((h) => h.name === "Conveyance")!;
    const food = heads.find((h) => h.name === "Food & Refreshments")!;
    const claim = await expenses.createExpense(env.staff.ctx, {
      headId: conveyance.id,
      amount: 300,
      purpose: "Factory visit",
      fromLocation: "Office",
      toLocation: "Gazipur",
    });
    expect(claim).toMatchObject({ status: "PENDING", employee: { id: sumon.id } });
    const paid = await expenses.approveExpense(env.accounts, claim.id, {});
    expect(paid).toMatchObject({ status: "POSTED", fromAdvance: "300.00", paidFrom: null });
    expect((await advances.getAdvance(env.accounts, given.id)).outstanding).toBe("700.00");
    expect(await balance(env.admin, env.acc.CASH)).toBe("-1000.00");
    expect(await balance(env.admin, env.acc.EMPLOYEE_ADVANCES)).toBe("700.00");
    await expectAppError(
      expenses.updateExpense(env.accounts, paid.id, { employeeId: rahim.id }),
      "CONFLICT",
    );

    // More than the advance: the rest is paid in cash. Voiding it puts the advance back.
    const big = await expenses.createExpense(env.staff.ctx, {
      headId: conveyance.id,
      amount: 1500,
      purpose: "Buyer visit",
    });
    const bigPaid = await expenses.approveExpense(env.accounts, big.id, { method: "CASH" });
    expect(bigPaid).toMatchObject({ fromAdvance: "700.00", paidFrom: { id: env.acc.CASH } });
    expect((await advances.getAdvance(env.accounts, given.id)).status).toBe("SETTLED");
    expect(await balance(env.admin, env.acc.CASH)).toBe("-1800.00");
    await expenses.voidExpense(env.accounts, big.id, { reason: "Entered twice" });
    const back = await advances.getAdvance(env.accounts, given.id);
    expect(back).toMatchObject({ status: "OPEN", outstanding: "700.00" });
    expect(back.settlements.map((s) => [s.kind, s.amount, s.reversedAt !== null])).toEqual([
      ["EXPENSE", "300.00", false],
      ["EXPENSE", "700.00", true],
    ]);
    expect(await balance(env.admin, env.acc.CASH)).toBe("-1000.00");

    // Accounts can pay a claim in cash and leave the advance alone.
    const lunch = await expenses.createExpense(env.staff.ctx, {
      headId: food.id,
      amount: 120,
      purpose: "Lunch with buyer",
    });
    expect(
      await expenses.approveExpense(env.accounts, lunch.id, { useAdvance: false }),
    ).toMatchObject({ fromAdvance: "0.00", paidFrom: { id: env.acc.CASH } });
    expect((await advances.getAdvance(env.accounts, given.id)).outstanding).toBe("700.00");

    // Unspent money comes back to Accounts; a return entered by mistake can be undone.
    await expectAppError(
      advances.returnAdvance(env.hr.ctx, given.id, { amount: 100 }),
      "FORBIDDEN",
    );
    const returned = await advances.returnAdvance(env.accounts, given.id, {
      amount: 200,
      note: "Unspent",
    });
    expect(returned.outstanding).toBe("500.00");
    await expectAppError(
      advances.returnAdvance(env.accounts, given.id, { amount: 600 }),
      "VALIDATION",
    );
    const cashReturn = returned.settlements.find((s) => s.kind === "CASH_RETURN")!;
    expect(
      (
        await advances.voidAdvanceReturn(env.accounts, given.id, cashReturn.id, {
          reason: "Counted wrong",
        })
      ).outstanding,
    ).toBe("700.00");
    await expectAppError(
      advances.voidAdvance(env.accounts, given.id, { reason: "Wrong person" }),
      "CONFLICT",
    );

    // Owed from before the ERP: brought forward against opening equity, then voided.
    const opening = await advances.giveAdvance(env.accounts, {
      employeeId: rahim.id,
      amount: 2500,
      date: "2025-01-01",
      installmentAmount: 500,
      isOpening: true,
    });
    expect(opening).toMatchObject({ isOpening: true, paidFrom: null, installmentAmount: "500.00" });
    expect(await balance(env.admin, env.acc.EMPLOYEE_ADVANCES)).toBe("3200.00");
    await advances.voidAdvance(env.accounts, opening.id, { reason: "Already paid back" });
    expect(await balance(env.admin, env.acc.EMPLOYEE_ADVANCES)).toBe("700.00");

    // The employee, the statement, the overview and the books agree.
    expect(await advances.myAdvances(env.staff.ctx)).toMatchObject({ outstanding: "700.00" });
    expect(await employees.getEmployeeStatement(env.accounts, sumon.id, {})).toMatchObject({
      advanceBalance: "700.00",
      salaryPayable: "0.00",
    });
    expect((await reports.getAccountsOverview(env.accounts)).payroll).toMatchObject({
      employeeAdvances: "700.00",
    });
    await expectBooksOk(env.admin);
  });
});

run("monthly payroll", () => {
  beforeEach(resetDb);

  it("works out, approves, pays and reopens a month's payroll through the books", async () => {
    const env = await setup();
    await settings.updateHrSettings(env.hr.ctx, { latesPerDeductionDay: 3 });
    const types = await settings.listLeaveTypes(env.hr.ctx);
    const casual = types.find((t) => t.name === "Casual Leave")!;
    const unpaid = types.find((t) => t.name === "Unpaid Leave")!;
    const rahim = await env.hire("Rahim Uddin", 30000);
    const karim = await env.hire("Karim Mia", 20000, { overtimeRate: 100 });
    const sumon = await env.hire("Sumon Ali", 15000);
    const jamal = await env.hire("Jamal Hossain", 18000);
    await employees.grantPortalAccess(env.hr.ctx, sumon.id, { userId: env.staff.user.id });

    // Advances: Rahim 6,000 at 2,000 a month and Jamal 5,000 at 1,000 from next month,
    // both two months ago; Sumon 1,000 today (not part of last month's payroll).
    const advanceDay = workingDays(M2)[0]!;
    const rahimAdvance = await advances.giveAdvance(env.accounts, {
      employeeId: rahim.id,
      amount: 6000,
      installmentAmount: 2000,
      date: advanceDay,
    });
    const jamalAdvance = await advances.giveAdvance(env.accounts, {
      employeeId: jamal.id,
      amount: 5000,
      installmentAmount: 1000,
      recoverFrom: monthsAgo(-1),
      date: advanceDay,
    });
    await advances.giveAdvance(env.accounts, { employeeId: sumon.id, amount: 1000 });

    // Last month: Rahim 1 absence, 3 lates (= 1 more day) and 2 days' casual leave; Karim a
    // raise from the 16th, 2 hours' overtime and a day's unpaid leave; Jamal left mid-month.
    const mark = (date: string, entries: unknown[]) =>
      attendance.markAttendance(env.hr.ctx, { date, entries });
    await mark(wd(0), [{ employeeId: rahim.id, status: "ABSENT" }]);
    for (const d of WD.slice(1, 4)) {
      await mark(d, [{ employeeId: rahim.id, status: "LATE", checkIn: "09:31" }]);
    }
    await mark(wd(4), [{ employeeId: karim.id, status: "PRESENT", overtimeMinutes: 120 }]);
    await leave.createLeave(env.hr.ctx, {
      employeeId: rahim.id,
      leaveTypeId: casual.id,
      startDate: wd(5),
      endDate: wd(6),
      approve: true,
    });
    await employees.reviseSalary(env.hr.ctx, karim.id, {
      amount: 26000,
      effectiveFrom: `${M1}-16`,
    });
    await leave.createLeave(env.hr.ctx, {
      employeeId: karim.id,
      leaveTypeId: unpaid.id,
      startDate: WD.find((d) => d >= `${M1}-16`)!,
      approve: true,
    });
    const jamalLastDay = wd(9);
    await employees.exitEmployee(env.hr.ctx, jamal.id, {
      exitDate: jamalLastDay,
      status: "RESIGNED",
    });

    // Accounts prepares the draft (HR alone cannot); never for a month not yet started.
    await expectAppError(payroll.createPayrollRun(env.hr.ctx, { month: M1 }), "FORBIDDEN");
    await expectAppError(
      payroll.createPayrollRun(env.accounts, { month: monthsAgo(-1) }),
      "VALIDATION",
    );
    const draft = await payroll.createPayrollRun(env.accounts, { month: M1 });
    await expectAppError(payroll.createPayrollRun(env.accounts, { month: M1 }), "CONFLICT");
    expect(draft).toMatchObject({ month: M1, status: "DRAFT", employees: 4 });

    const rahimCut = money(D(30000).times(2).dividedBy(DIM));
    const rahimGross = D(30000).minus(rahimCut);
    const r = line(draft, rahim.id);
    expect(r.days).toMatchObject({
      working: WD.length,
      absent: 1,
      late: 3,
      paidLeave: 2,
      unpaid: 2,
    });
    expect([r.salary, r.unpaidLeaveDeduction, r.grossPay, r.advanceDeduction, r.netPay]).toEqual([
      "30000.00",
      rahimCut.toFixed(2),
      rahimGross.toFixed(2),
      "2000.00",
      rahimGross.minus(2000).toFixed(2),
    ]);

    const karimBasic = money(
      D(20000)
        .times(15)
        .dividedBy(DIM)
        .plus(
          D(26000)
            .times(DIM - 15)
            .dividedBy(DIM),
        ),
    );
    const karimCut = money(D(26000).dividedBy(DIM));
    const k = line(draft, karim.id);
    expect([
      k.monthlySalary,
      k.salary,
      k.overtimeHours,
      k.overtime,
      k.unpaidLeaveDeduction,
    ]).toEqual(["26000.00", karimBasic.toFixed(2), "2.00", "200.00", karimCut.toFixed(2)]);
    expect(k.days).toMatchObject({ unpaidLeave: 1, unpaid: 1 });

    // Someone leaving gives back everything still owed, whatever the schedule said.
    const jamalGross = money(
      D(18000)
        .times(Number(jamalLastDay.slice(8, 10)))
        .dividedBy(DIM),
    );
    const j = line(draft, jamal.id);
    expect([j.salary, j.advanceDeduction, j.netPay]).toEqual([
      jamalGross.toFixed(2),
      "5000.00",
      jamalGross.minus(5000).toFixed(2),
    ]);
    expect(line(draft, sumon.id)).toMatchObject({
      grossPay: "15000.00",
      advanceDeduction: "0.00",
      netPay: "15000.00",
    });

    // Payroll adds a bonus and tax; impossible lines are refused.
    await payroll.setPayrollBonus(env.accounts, draft.id, {
      percentOfSalary: 50,
      employeeIds: [karim.id],
    });
    const edited = await payroll.updatePayrollItem(env.accounts, draft.id, k.id, {
      taxDeduction: 500,
      note: "TDS",
    });
    const karimGross = karimBasic.plus(200).plus(13000).minus(karimCut);
    const k2 = line(edited, karim.id);
    expect([k2.bonus, k2.taxDeduction, k2.grossPay, k2.netPay]).toEqual([
      "13000.00",
      "500.00",
      karimGross.toFixed(2),
      karimGross.minus(500).toFixed(2),
    ]);
    await expectAppError(
      payroll.updatePayrollItem(env.accounts, draft.id, j.id, { otherDeductions: 50000 }),
      "VALIDATION",
    );
    await expectAppError(
      payroll.updatePayrollItem(env.accounts, draft.id, r.id, { advanceDeduction: 7000 }),
      "VALIDATION",
    );

    // A second person approves: Super Admin by default, not Accounts or HR.
    await expectAppError(payroll.approvePayrollRun(env.accounts, draft.id), "FORBIDDEN");
    await expectAppError(payroll.approvePayrollRun(env.hr.ctx, draft.id), "FORBIDDEN");
    const approved = await payroll.approvePayrollRun(env.admin, draft.id);
    const totalGross = rahimGross.plus(karimGross).plus(15000).plus(jamalGross);
    const totalNet = totalGross.minus(2000 + 5000 + 500);
    expect(approved).toMatchObject({
      status: "APPROVED",
      approvedBy: { id: env.admin.user.id },
      totals: { gross: totalGross.toFixed(2), net: totalNet.toFixed(2), paid: "0.00" },
    });
    expect(localDay(approved.journalEntry!.date, TZ)).toBe(monthRange(M1).to);

    // The books: the salaries expense, advances recovered, tax held and net pay owed.
    expect(await balance(env.admin, env.acc.SALARIES)).toBe(totalGross.toFixed(2));
    expect(await balance(env.admin, env.acc.SALARY_TAX)).toBe("500.00");
    expect(await balance(env.admin, env.acc.SALARIES_PAYABLE)).toBe(totalNet.toFixed(2));
    // 6,000 + 5,000 + 1,000 given; 2,000 + 5,000 recovered.
    expect(await balance(env.admin, env.acc.EMPLOYEE_ADVANCES)).toBe("5000.00");
    expect((await advances.getAdvance(env.accounts, rahimAdvance.id)).outstanding).toBe("4000.00");
    expect((await advances.getAdvance(env.accounts, jamalAdvance.id)).status).toBe("SETTLED");
    expect((await reports.getAccountsOverview(env.accounts)).payroll).toMatchObject({
      salariesPayable: totalNet.toFixed(2),
      employeeAdvances: "5000.00",
      draftsAwaitingApproval: 0,
      awaitingPayment: { payrolls: 1, employees: 4, amount: totalNet.toFixed(2) },
    });
    await expectBooksOk(env.admin);

    // The approved month is frozen.
    await expectAppError(mark(wd(7), [{ employeeId: rahim.id, status: "ABSENT" }]), "CONFLICT");
    await expectAppError(
      leave.createLeave(env.hr.ctx, {
        employeeId: sumon.id,
        leaveTypeId: unpaid.id,
        startDate: wd(8),
        approve: true,
      }),
      "CONFLICT",
    );
    await expectAppError(
      employees.reviseSalary(env.hr.ctx, sumon.id, {
        amount: 16000,
        effectiveFrom: `${M1}-20`,
      }),
      "CONFLICT",
    );
    await expectAppError(
      settings.createHolidays(env.hr.ctx, { date: wd(8), name: "Late holiday" }),
      "CONFLICT",
    );
    await expectAppError(
      payroll.updatePayrollItem(env.accounts, draft.id, r.id, { bonus: 100 }),
      "CONFLICT",
    );

    // Payslips: printable for payroll, and each employee sees only their own.
    const slip = await payroll.getPayslip(env.accounts, draft.id, r.id);
    expect(slip).toMatchObject({
      label: expect.any(String),
      netPay: rahimGross.minus(2000).toFixed(2),
      payment: { status: "UNPAID" },
    });
    expect(slip.netPayInWords).toMatch(/^Taka .* Only$/);
    expect(slip.deductions).toEqual([
      { label: expect.stringMatching(/^Unpaid days \(2 x /), amount: rahimCut.toFixed(2) },
      { label: "Advance recovery", amount: "2000.00" },
    ]);
    const mySlips = await payroll.myPayslips(env.staff.ctx);
    expect(mySlips).toEqual([
      expect.objectContaining({ month: M1, netPay: "15000.00", paid: false }),
    ]);
    expect(await payroll.myPayslip(env.staff.ctx, mySlips[0]!.itemId)).toMatchObject({
      employee: { id: sumon.id },
    });
    await expectAppError(payroll.myPayslip(env.staff.ctx, r.id), "NOT_FOUND");
    await expectAppError(payroll.getPayrollRun(env.staff.ctx, draft.id), "FORBIDDEN");
    await expectAppError(payroll.listPayrollRuns(env.viewer), "FORBIDDEN");
    const home = await portal.getMyOverview(env.staff.ctx);
    expect(home).toMatchObject({
      profile: { id: sumon.id, salary: "15000.00" },
      advances: { open: 1, outstanding: "1000.00" },
      latestPayslips: [expect.objectContaining({ month: M1 })],
    });
    expect(home.profile).not.toHaveProperty("notes");

    // Accounts pays: Rahim first, then everyone else.
    for (const ctx of [env.hr.ctx, env.sales]) {
      await expectAppError(payroll.payPayrollRun(ctx, draft.id, {}), "FORBIDDEN");
    }
    const first = await payroll.payPayrollRun(env.accounts, draft.id, {
      itemIds: [r.id],
      method: "CASH",
      reference: "Envelope",
    });
    expect(first.run).toMatchObject({ status: "APPROVED" });
    expect(line(first.run, rahim.id)).toMatchObject({ paid: true });
    const rest = await payroll.payPayrollRun(env.accounts, draft.id, { method: "BANK_TRANSFER" });
    expect(rest.run).toMatchObject({ status: "PAID", totals: { unpaid: "0.00" } });
    expect(await balance(env.admin, env.acc.SALARIES_PAYABLE)).toBe("0.00");
    await expectAppError(payroll.payPayrollRun(env.accounts, draft.id, {}), "CONFLICT");
    expect((await payroll.myPayslips(env.staff.ctx))[0]).toMatchObject({ paid: true });
    expect(await employees.getEmployeeStatement(env.accounts, rahim.id, {})).toMatchObject({
      advanceBalance: "4000.00",
      salaryPayable: "0.00",
    });
    await expectBooksOk(env.admin);

    // Reopening needs the payments voided first; then the entry and recoveries are undone.
    const reason = { reason: "Attendance was wrong" };
    await expectAppError(payroll.reopenPayrollRun(env.admin, draft.id, reason), "CONFLICT");
    expect(
      await payroll.voidPayrollPayment(env.accounts, rest.paymentId, { reason: "Bank rejected" }),
    ).toMatchObject({ status: "APPROVED" });
    await expectAppError(payroll.reopenPayrollRun(env.admin, draft.id, reason), "CONFLICT");
    await payroll.voidPayrollPayment(env.accounts, first.paymentId, { reason: "Paid twice" });
    await expectAppError(payroll.reopenPayrollRun(env.accounts, draft.id, reason), "FORBIDDEN");
    const reopened = await payroll.reopenPayrollRun(env.admin, draft.id, reason);
    expect(reopened).toMatchObject({ status: "DRAFT", journalEntry: null, approvedBy: null });
    expect(await balance(env.admin, env.acc.SALARIES)).toBe("0.00");
    expect(await balance(env.admin, env.acc.SALARIES_PAYABLE)).toBe("0.00");
    expect((await advances.getAdvance(env.accounts, rahimAdvance.id)).outstanding).toBe("6000.00");
    expect(await advances.getAdvance(env.accounts, jamalAdvance.id)).toMatchObject({
      status: "OPEN",
      outstanding: "5000.00",
    });
    await expectBooksOk(env.admin);

    // Open again: a late change makes the draft out of date until it is recalculated.
    await mark(wd(7), [{ employeeId: rahim.id, status: "ABSENT" }]);
    await expectAppError(payroll.approvePayrollRun(env.admin, draft.id), "CONFLICT");
    const recalculated = await payroll.recalculatePayrollRun(env.accounts, draft.id);
    expect(line(recalculated, rahim.id).days).toMatchObject({ absent: 2, unpaid: 3 });
    expect(line(recalculated, karim.id)).toMatchObject({
      bonus: "13000.00",
      taxDeduction: "500.00",
      note: "TDS",
    });
    expect((await payroll.approvePayrollRun(env.admin, draft.id)).status).toBe("APPROVED");
    expect((await advances.getAdvance(env.accounts, rahimAdvance.id)).outstanding).toBe("4000.00");
    await expectBooksOk(env.admin);

    // Drafts can be thrown away; approved payrolls cannot.
    const older = await payroll.createPayrollRun(env.accounts, { month: M2 });
    expect(older.employees).toBe(4);
    expect(await payroll.deletePayrollRun(env.accounts, older.id)).toEqual({ deleted: true });
    await expectAppError(payroll.deletePayrollRun(env.accounts, draft.id), "CONFLICT");
    expect((await payroll.listPayrollRuns(env.accounts)).map((p) => [p.month, p.status])).toEqual([
      [M1, "APPROVED"],
    ]);
  });
});
