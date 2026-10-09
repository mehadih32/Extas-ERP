import type { AttendanceStatus, EmployeeStatus, LeaveStatus, PaymentMethod } from "@prisma/client";
import { z } from "zod";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { queryBoolean } from "@/lib/query-params";
import { addDays, monthsBetween } from "@/modules/accounts/periods";
import { listMoneyAccounts } from "@/modules/accounts/screens.service";
import type { CompanyContext } from "@/modules/auth/context";
import { actingAs, linkedEmployee } from "@/modules/hr/access";
import { getAdvance, listAdvances, myAdvances } from "@/modules/hr/advance.service";
import {
  getAttendanceDay,
  getAttendanceSummary,
  getEmployeeAttendance,
  myAttendance,
} from "@/modules/hr/attendance.service";
import { monthKey, monthLabel, monthRange } from "@/modules/hr/calendar";
import {
  employeeDirectory,
  employeeRecords,
  getEmployee,
  getEmployeeStatement,
  listEmployees,
} from "@/modules/hr/employee.service";
import {
  balancesFor,
  getLeaveRequest,
  listLeaveRequests,
  myLeave,
} from "@/modules/hr/leave.service";
import { employedOn } from "@/modules/hr/month-data";
import {
  getPayrollRun,
  getPayslip,
  listPayrollRuns,
  myPayslip,
  myPayslips,
} from "@/modules/hr/payroll.service";
import { getMyOverview } from "@/modules/hr/portal.service";
import {
  canApproveLeave,
  canCancelLeave,
  canChangeAdvance,
  canChangePayroll,
  canChangeSalary,
  canDeleteEmployee,
  canGivePortalLogin,
  canMarkDay,
  canPayPayroll,
  canReinstate,
  canRejectLeave,
  canRemoveHoliday,
  canRemovePortalLogin,
  canRemoveSalaryRevision,
  canReopenPayroll,
  canSetAllowance,
  canSwitchPaid,
  canTakeAdvanceBack,
  canUndoReturn,
  canVoidAdvance,
  canVoidSalaryPayment,
  hrKeys,
  isCashReturn,
  mayVoidAdvance,
} from "@/modules/hr/rules";
import { getHrSettings, listHolidays, listLeaveTypes } from "@/modules/hr/settings.service";

/*
 * What the HR & payroll screens and the employee's own "My HR" pages show, as
 * plain values (amounts as "12500.00", days as "2026-10-08" in company time),
 * with what the person looking may do decided by the same permissions and
 * rules the HR actions use (hr/rules.ts):
 *   hr.view             employees, attendance, leave and holidays
 *   hr.manage           employees and salaries, attendance, leave decisions, HR rules
 *   hr.payroll          prepares payroll; salaries, payslips and advances
 *   hr.payroll.approve  approves or reopens payroll
 *   accounts.*          paying salaries and advances, taking advances back
 *   portal.self         the employee's own records
 * Salaries, pay details, payslips and advances reach only the people who may
 * see salaries; the services leave them out for everyone else.
 */

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

/** What this person may do anywhere in HR & payroll (each screen narrows it to the record). */
export function hrAccess(ctx: CompanyContext) {
  return {
    ...hrKeys(ctx),
    /** Open a journal entry in Accounts. */
    openJournal: ctx.can("accounts.view"),
    /** Open an expense (conveyance settled from an advance). */
    openExpenses: ctx.can("expenses.manage") || ctx.can("accounts.view"),
  };
}

export type HrAccess = ReturnType<typeof hrAccess>;

/** Months whose payroll is approved or paid: their attendance, leave and salaries are frozen. */
async function closedMonths(ctx: CompanyContext): Promise<Set<string>> {
  const runs = await ctx.db.payrollRun.findMany({
    where: { status: { not: "DRAFT" } },
    select: { year: true, month: true },
  });
  return new Set(runs.map((r) => monthKey(r.year, r.month)));
}

const note = (verdict: { ok: boolean; message?: string }) =>
  verdict.ok ? null : (verdict as { message: string }).message;

/** Departments in use, for the filters and the employee form. */
async function departments(ctx: CompanyContext): Promise<string[]> {
  const rows = await ctx.db.employee.findMany({
    where: { department: { not: null } },
    select: { department: true },
    distinct: ["department"],
    orderBy: { department: "asc" },
  });
  return rows.flatMap((r) => (r.department ? [r.department] : []));
}

/** People employed today, by name, for the pickers on the leave and advance forms. */
async function currentPeople(ctx: CompanyContext) {
  const rows = await employeeDirectory(ctx, {});
  return rows.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    designation: e.designation,
  }));
}

export type PersonOption = Awaited<ReturnType<typeof currentPeople>>[number];

// =============================================================================
// Overview
// =============================================================================

/**
 * The HR Overview: who works here, who is in today, leave waiting for a
 * decision, coming holidays, and (for people who see salaries) where this
 * month's and last month's payroll stand and what is owed on advances.
 */
export async function getOverviewScreen(ctx: CompanyContext) {
  const access = hrAccess(ctx);
  const day = today(ctx);
  const month = day.slice(0, 7);
  const lastMonth = monthsBetween(addDays(`${month}-01`, -1), addDays(`${month}-01`, -1))[0]!;
  const [people, register, waiting, holidays, nextYearHolidays] = await Promise.all([
    ctx.db.employee.findMany({
      where: { OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(day) } }] },
      select: { department: true, status: true, joinDate: true, exitDate: true },
    }),
    getAttendanceDay(ctx, { date: day }),
    listLeaveRequests(ctx, { status: "PENDING", take: 6 }),
    listHolidays(ctx, { year: Number(day.slice(0, 4)) }),
    listHolidays(ctx, { year: Number(day.slice(0, 4)) + 1 }),
  ]);
  const pendingCount = await ctx.db.leaveRequest.count({ where: { status: "PENDING" } });
  const byDepartment = new Map<string, number>();
  for (const p of people) {
    const name = p.department ?? "No department";
    byDepartment.set(name, (byDepartment.get(name) ?? 0) + 1);
  }
  const onLeaveToday = register.rows
    .filter((r) => r.leave?.status === "APPROVED")
    .map((r) => ({
      employee: r.employee,
      leaveType: r.leave!.leaveType.name,
      halfDay: r.leave!.halfDay,
    }));
  const absentToday = register.rows
    .filter((r) => r.mark?.status === "ABSENT")
    .map((r) => r.employee);

  let payroll = null;
  if (access.salaries) {
    const runs = await listPayrollRuns(ctx, {});
    const find = (m: string) => runs.find((r) => r.month === m) ?? null;
    const runOf = (m: string) => {
      const r = find(m);
      return {
        month: m,
        label: monthLabel(m),
        run: r
          ? {
              id: r.id,
              status: r.status,
              employees: r.employees,
              totalNet: r.totalNet,
              unpaid: r.unpaid,
            }
          : null,
      };
    };
    payroll = {
      lastMonth: runOf(lastMonth),
      thisMonth: runOf(month),
      waitingApproval: runs.filter((r) => r.status === "DRAFT").length,
      unpaid: runs
        .filter((r) => r.status === "APPROVED")
        .map((r) => ({ id: r.id, label: r.label, unpaid: r.unpaid ?? "0.00" })),
    };
  }
  let advances = null;
  if (access.advances) {
    const open = await ctx.db.salaryAdvance.aggregate({
      where: { status: "OPEN" },
      _sum: { outstanding: true },
      _count: { _all: true },
    });
    advances = {
      open: open._count._all,
      outstanding: (open._sum.outstanding?.toFixed(2) ?? "0.00") as string,
    };
  }

  return {
    today: day,
    headcount: {
      current: people.length,
      onLongLeave: people.filter((p) => p.status === "ON_LEAVE").length,
      joinedThisMonth: people.filter((p) => dateOnly(p.joinDate).startsWith(month)).length,
      leaving: people.filter((p) => p.exitDate !== null).length,
    },
    byDepartment: [...byDepartment.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    register: {
      dayType: register.dayType,
      holiday: register.holiday,
      weekday: register.weekday,
      totals: register.totals,
    },
    onLeaveToday,
    absentToday,
    pendingLeave: { count: pendingCount, items: waiting.items },
    holidays: [...holidays.items, ...nextYearHolidays.items]
      .filter((h) => h.date >= day)
      .slice(0, 5),
    payroll,
    advances,
    can: {
      addEmployee: access.manage,
      markAttendance: access.manage,
      recordLeave: access.manage,
      startPayroll: access.payroll,
      giveAdvance: access.giveAdvance,
    },
  };
}

// =============================================================================
// Employees
// =============================================================================

const employeeListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  department: z.string().trim().max(80).optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"]).optional(),
  /** Everyone, including people who left. */
  former: queryBoolean.optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

/** One row of the employee list; the salary only for people who see salaries. */
export async function listEmployeeRows(ctx: CompanyContext, raw: unknown = {}) {
  const q = employeeListSchema.parse(raw);
  const left = q.status === "RESIGNED" || q.status === "TERMINATED";
  const page = await listEmployees(ctx, {
    search: q.search,
    department: q.department,
    status: q.status,
    current: !(q.former || left),
    cursor: q.cursor,
    take: q.take ?? 30,
  });
  return {
    items: page.items.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      designation: e.designation,
      department: e.department,
      phone: e.phone,
      status: e.status as EmployeeStatus,
      isCurrent: e.isCurrent,
      joinDate: e.joinDate,
      exitDate: e.exitDate,
      hasLogin: e.portalLogin !== null,
      salary: "salary" in e ? (e.salary as string) : null,
    })),
    nextCursor: page.nextCursor,
  };
}

export type EmployeeListRow = Awaited<ReturnType<typeof listEmployeeRows>>["items"][number];

export async function getEmployeeList(ctx: CompanyContext, raw: unknown = {}) {
  const access = hrAccess(ctx);
  const [rows, depts] = await Promise.all([listEmployeeRows(ctx, raw), departments(ctx)]);
  return {
    ...rows,
    departments: depts,
    seeSalaries: access.salaries,
    can: { add: access.manage },
  };
}

/**
 * One employee's page: their details, pay (for people who see salaries),
 * leave allowances for a year, this month's attendance, open advances and
 * payslips, with what may be done decided by hr/rules.ts.
 */
export async function getEmployeeScreen(
  ctx: CompanyContext,
  employeeId: string,
  options: { year?: number } = {},
) {
  const access = hrAccess(ctx);
  const day = today(ctx);
  const thisYear = Number(day.slice(0, 4));
  const e = await getEmployee(ctx, employeeId);
  const year = options.year ?? thisYear;
  const balances =
    year === thisYear
      ? e.leaveBalances
      : await balancesFor(
          prisma,
          await ctx.db.employee.findUniqueOrThrow({ where: { id: e.id } }),
          year,
        );
  const me = actingAs(ctx);
  const subject = { name: e.name, userId: e.portalLogin?.id ?? null, exitDate: e.exitDate };
  const records = access.manage ? await employeeRecords(ctx, e.id) : 0;
  const salary = access.manage ? canChangeSalary(subject, me) : null;
  const closed = await closedMonths(ctx);
  const pay =
    "salary" in e
      ? {
          salary: e.salary,
          upcomingSalary: e.upcomingSalary,
          overtimeRate: e.overtimeRate,
          salaryMethod: e.salaryMethod as PaymentMethod,
          bankName: e.bankName,
          bankAccountNumber: e.bankAccountNumber,
          walletNumber: e.walletNumber,
          notes: e.notes,
          salaryHistory: e.salaryHistory.map((r, index) => ({
            ...r,
            canRemove:
              access.manage &&
              salary?.ok === true &&
              canRemoveSalaryRevision({ isJoining: index === 0 }).ok &&
              !closed.has(r.effectiveFrom.slice(0, 7)),
          })),
          advances: e.advances,
          payslips: e.payslips,
        }
      : null;
  const activeTypes = balances.filter((b) => b.leaveType.isActive);

  return {
    today: day,
    employee: {
      id: e.id,
      code: e.code,
      name: e.name,
      designation: e.designation,
      department: e.department,
      phone: e.phone,
      whatsapp: e.whatsapp,
      email: e.email,
      nid: e.nid,
      address: e.address,
      dateOfBirth: e.dateOfBirth,
      bloodGroup: e.bloodGroup,
      emergencyContact: e.emergencyContact,
      joinDate: e.joinDate,
      exitDate: e.exitDate,
      exitReason: e.exitReason,
      status: e.status as EmployeeStatus,
      isCurrent: e.isCurrent,
      login: e.portalLogin
        ? { email: e.portalLogin.email, active: e.portalLogin.status === "ACTIVE" }
        : null,
    },
    pay,
    leave: {
      year,
      years: [thisYear - 1, thisYear, thisYear + 1],
      balances: balances.map((b) => ({
        ...b,
        canAdjust: access.manage && canSetAllowance(b.leaveType).ok,
      })),
    },
    thisMonth: e.thisMonth,
    leaveTypes: activeTypes.map((b) => b.leaveType),
    can: {
      edit: access.manage,
      changeSalary: access.manage && salary?.ok === true,
      exit: access.manage,
      reinstate: access.manage && canReinstate(subject).ok,
      remove: access.manage && canDeleteEmployee(subject, records).ok,
      giveLogin: access.manage && canGivePortalLogin(subject).ok,
      removeLogin: access.manage && canRemovePortalLogin(subject).ok,
      recordLeave: access.manage && e.isCurrent,
      giveAdvance: (access.giveAdvance || access.openingAdvance) && e.isCurrent,
      statement: access.salaries,
      openPayroll: access.salaries,
      openAdvances: access.advances,
    },
    notes: {
      salary: access.manage && salary && !salary.ok ? note(salary) : null,
      remove: access.manage ? note(canDeleteEmployee(subject, records)) : null,
    },
  };
}

export type EmployeeScreen = Awaited<ReturnType<typeof getEmployeeScreen>>;

/** The add and change form: the employee's details (when changing) and the departments in use. */
export async function getEmployeeForm(ctx: CompanyContext, employeeId?: string) {
  const access = hrAccess(ctx);
  if (!access.manage) throw new AppError("FORBIDDEN", "Only HR can add or change employees.");
  const [depts, e] = await Promise.all([
    departments(ctx),
    employeeId ? getEmployee(ctx, employeeId) : null,
  ]);
  return {
    today: today(ctx),
    departments: depts,
    employee:
      e && "salary" in e
        ? {
            id: e.id,
            code: e.code,
            name: e.name,
            designation: e.designation,
            department: e.department,
            phone: e.phone,
            whatsapp: e.whatsapp,
            email: e.email,
            nid: e.nid,
            address: e.address,
            dateOfBirth: e.dateOfBirth,
            bloodGroup: e.bloodGroup,
            emergencyContact: e.emergencyContact,
            notes: e.notes,
            joinDate: e.joinDate,
            exitDate: e.exitDate,
            status: e.status as EmployeeStatus,
            overtimeRate: e.overtimeRate,
            salaryMethod: e.salaryMethod as PaymentMethod,
            bankName: e.bankName,
            bankAccountNumber: e.bankAccountNumber,
            walletNumber: e.walletNumber,
          }
        : null,
    can: { setStatus: !e?.exitDate },
  };
}

export type EmployeeForm = Awaited<ReturnType<typeof getEmployeeForm>>;

const monthQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

/** One employee's month, day by day, with the totals payroll uses. */
export async function getEmployeeMonthScreen(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown = {},
) {
  const access = hrAccess(ctx);
  const q = monthQuery.parse(raw);
  const day = today(ctx);
  const month = q.month && q.month <= day.slice(0, 7) ? q.month : day.slice(0, 7);
  const [m, closed] = await Promise.all([
    getEmployeeAttendance(ctx, employeeId, { month }, { upTo: day }),
    closedMonths(ctx),
  ]);
  return {
    ...m,
    label: monthLabel(month),
    today: day,
    thisMonth: day.slice(0, 7),
    closed: closed.has(month),
    can: { mark: access.manage && !closed.has(month) },
  };
}

export type EmployeeMonthScreen = Awaited<ReturnType<typeof getEmployeeMonthScreen>>;

/** What the employee owes and is owed: advances, salaries posted and paid. */
export async function getStatementScreen(
  ctx: CompanyContext,
  employeeId: string,
  raw: { from?: string; to?: string } = {},
) {
  const access = hrAccess(ctx);
  const s = await getEmployeeStatement(ctx, employeeId, raw);
  return {
    ...s,
    lines: s.lines.map((l) => ({
      ...l,
      date: localDay(l.date, ctx.company.timezone),
      href: access.openJournal ? `/accounts/journal/${l.entryId}` : null,
    })),
  };
}

// =============================================================================
// Attendance
// =============================================================================

const dayQuery = z.object({ date: z.iso.date().optional() });

/**
 * The day register: everyone employed that day with their mark and any leave,
 * and whether the day may still be marked (it has come, and its month's payroll
 * is open).
 */
export async function getAttendanceScreen(ctx: CompanyContext, raw: unknown = {}) {
  const access = hrAccess(ctx);
  const q = dayQuery.parse(raw);
  const now = today(ctx);
  const date = q.date && q.date <= now ? q.date : now;
  const [register, closed] = await Promise.all([
    getAttendanceDay(ctx, { date }),
    closedMonths(ctx),
  ]);
  const marking = canMarkDay(date, now, closed);
  return {
    ...register,
    today: now,
    previous: addDays(date, -1),
    next: date < now ? addDays(date, 1) : null,
    can: { mark: access.manage && marking.ok },
    notes: { mark: access.manage && !marking.ok ? note(marking) : null },
  };
}

export type AttendanceScreen = Awaited<ReturnType<typeof getAttendanceScreen>>;

/** A month's day counts per employee: the figures payroll uses. */
export async function getAttendanceMonthScreen(ctx: CompanyContext, raw: unknown = {}) {
  const q = monthQuery.parse(raw);
  const now = today(ctx).slice(0, 7);
  const month = q.month && q.month <= now ? q.month : now;
  const [summary, closed] = await Promise.all([
    getAttendanceSummary(ctx, { month }, { upTo: today(ctx) }),
    closedMonths(ctx),
  ]);
  return { ...summary, label: monthLabel(month), thisMonth: now, closed: closed.has(month) };
}

// =============================================================================
// Leave
// =============================================================================

const leaveListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: z.string().min(1).max(40).optional(),
  leaveTypeId: z.string().min(1).max(40).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export async function listLeaveRows(ctx: CompanyContext, raw: unknown = {}) {
  const q = leaveListSchema.parse(raw);
  const page = await listLeaveRequests(ctx, { ...q, take: q.take ?? 30 });
  return {
    items: page.items.map((l) => ({
      id: l.id,
      employee: l.employee,
      leaveType: l.leaveType,
      startDate: l.startDate,
      endDate: l.endDate,
      halfDay: l.halfDay,
      days: l.days,
      reason: l.reason,
      status: l.status as LeaveStatus,
    })),
    nextCursor: page.nextCursor,
  };
}

export type LeaveRow = Awaited<ReturnType<typeof listLeaveRows>>["items"][number];

export async function getLeaveList(ctx: CompanyContext, raw: unknown = {}) {
  const access = hrAccess(ctx);
  const q = leaveListSchema.parse(raw);
  const [rows, types, pending, person] = await Promise.all([
    listLeaveRows(ctx, q),
    listLeaveTypes(ctx, { includeInactive: true }),
    ctx.db.leaveRequest.count({ where: { status: "PENDING" } }),
    q.employeeId
      ? ctx.db.employee.findUnique({
          where: { id: q.employeeId },
          select: { id: true, code: true, name: true },
        })
      : null,
  ]);
  return {
    ...rows,
    leaveTypes: types.map((t) => ({ id: t.id, name: t.name })),
    pending,
    employee: person,
    can: { record: access.manage },
  };
}

/** One leave request with the employee's allowance for its type and what may be done. */
export async function getLeaveScreen(ctx: CompanyContext, leaveId: string) {
  const access = hrAccess(ctx);
  const l = await getLeaveRequest(ctx, leaveId);
  const employee = await ctx.db.employee.findUniqueOrThrow({ where: { id: l.employee.id } });
  const [balances, closed] = await Promise.all([
    balancesFor(prisma, employee, Number(l.startDate.slice(0, 4))),
    closedMonths(ctx),
  ]);
  const leaveState = {
    status: l.status as LeaveStatus,
    employeeUserId: employee.userId,
    months: monthsBetween(l.startDate, l.endDate),
  };
  const me = actingAs(ctx);
  const approve = canApproveLeave(leaveState, me, closed);
  const cancel = canCancelLeave(leaveState, me, closed);
  return {
    leave: l,
    askedOn: localDay(l.createdAt, ctx.company.timezone),
    balance: balances.find((b) => b.leaveType.id === l.leaveType.id) ?? null,
    can: {
      approve: access.manage && approve.ok,
      reject: access.manage && canRejectLeave(leaveState).ok,
      cancel: access.manage && cancel.ok,
      openEmployee: access.view,
    },
    notes: {
      approve:
        access.manage && leaveState.status === "PENDING" && !approve.ok ? note(approve) : null,
      cancel: access.manage && leaveState.status === "APPROVED" && !cancel.ok ? note(cancel) : null,
    },
  };
}

export type LeaveScreen = Awaited<ReturnType<typeof getLeaveScreen>>;

/** HR records leave: the people employed now and the leave types in use. */
export async function getLeaveForm(ctx: CompanyContext, options: { employeeId?: string } = {}) {
  const access = hrAccess(ctx);
  if (!access.manage) throw new AppError("FORBIDDEN", "Only HR can record leave for someone else.");
  const [people, types] = await Promise.all([currentPeople(ctx), listLeaveTypes(ctx, {})]);
  const me = actingAs(ctx);
  const own = await linkedEmployee(ctx);
  return {
    today: today(ctx),
    people,
    leaveTypes: types.map((t) => ({ id: t.id, name: t.name, isPaid: t.isPaid })),
    employeeId: people.some((p) => p.id === options.employeeId) ? options.employeeId! : null,
    /** HR approves leave as it is recorded, except their own (unless a Super Admin). */
    ownEmployeeId: own && !me.isOwner ? own.id : null,
  };
}

export type LeaveForm = Awaited<ReturnType<typeof getLeaveForm>>;

// =============================================================================
// Payroll
// =============================================================================

/** The payrolls by month, newest first, and the months a new one can start for. */
export async function getPayrollList(ctx: CompanyContext, raw: { year?: unknown } = {}) {
  const access = hrAccess(ctx);
  const runs = await listPayrollRuns(ctx, {});
  const now = today(ctx).slice(0, 7);
  const years = [
    ...new Set([Number(now.slice(0, 4)), ...runs.map((r) => Number(r.month.slice(0, 4)))]),
  ].sort((a, b) => b - a);
  const year = Number(raw.year) && years.includes(Number(raw.year)) ? Number(raw.year) : null;
  const taken = new Set(runs.map((r) => r.month));
  const startable = Array.from({ length: 12 }, (_, i) => {
    const [y, m] = now.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
  })
    .filter((m) => !taken.has(m))
    .map((m) => ({ month: m, label: monthLabel(m) }));
  return {
    runs: year ? runs.filter((r) => r.month.startsWith(String(year))) : runs,
    years,
    year,
    startable,
    can: { start: access.payroll },
  };
}

/** One month's payroll: every employee's line, the payments, and what may be done. */
export async function getPayrollScreen(ctx: CompanyContext, runId: string) {
  const access = hrAccess(ctx);
  const run = await getPayrollRun(ctx, runId);
  const state = {
    status: run.status,
    year: Number(run.month.slice(0, 4)),
    month: Number(run.month.slice(5, 7)),
  };
  const live = run.payments.filter((p) => !p.voidedAt).length;
  const unpaid = run.items.filter(
    (i) => !i.paid && /[1-9]/.test(i.netPay) && !i.netPay.startsWith("-"),
  );
  const draft = canChangePayroll(state);
  const reopen = canReopenPayroll(state, live);
  const pay = canPayPayroll(state, unpaid.length);
  return {
    run,
    unpaid: unpaid.map((i) => ({ id: i.id, employee: i.employee, netPay: i.netPay })),
    moneyAccounts: access.pay && pay.ok ? await listMoneyAccounts(ctx) : [],
    today: today(ctx),
    can: {
      change: access.payroll && draft.ok,
      approve: access.approve && draft.ok,
      remove: access.payroll && draft.ok,
      reopen: access.approve && reopen.ok,
      pay: access.pay && pay.ok,
      voidPayment: access.pay && access.receive,
      openEmployee: access.view,
      openJournal: access.openJournal,
    },
    notes: {
      reopen: access.approve && run.status !== "DRAFT" && !reopen.ok ? note(reopen) : null,
      approve:
        run.status === "DRAFT" && !access.approve
          ? "Approving it is for someone who may approve payroll (by default the owner), so a second person checks the salaries."
          : null,
    },
    payments: run.payments.map((p) => ({
      ...p,
      paidOn: localDay(p.date, ctx.company.timezone),
      canVoid:
        access.pay &&
        access.receive &&
        canVoidSalaryPayment({ number: p.number, voided: p.voidedAt !== null }).ok,
    })),
  };
}

export type PayrollScreen = Awaited<ReturnType<typeof getPayrollScreen>>;

/** A payslip with the day it was paid in company time. */
function withPaidOn(ctx: CompanyContext, slip: Awaited<ReturnType<typeof getPayslip>>) {
  return {
    ...slip,
    paidOn:
      slip.payment.status === "PAID" ? localDay(slip.payment.date, ctx.company.timezone) : null,
  };
}

export async function getPayslipScreen(ctx: CompanyContext, runId: string, itemId: string) {
  const access = hrAccess(ctx);
  const slip = withPaidOn(ctx, await getPayslip(ctx, runId, itemId));
  return { slip, can: { openEmployee: access.view } };
}

export type Payslip = ReturnType<typeof withPaidOn>;

// =============================================================================
// Advances
// =============================================================================

const advanceListSchema = z.object({
  status: z.enum(["OPEN", "SETTLED", "VOID"]).optional(),
  employeeId: z.string().min(1).max(40).optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
});

export async function listAdvanceRows(ctx: CompanyContext, raw: unknown = {}) {
  const q = advanceListSchema.parse(raw);
  const page = await listAdvances(ctx, { ...q, take: q.take ?? 30 });
  return {
    outstanding: page.outstanding,
    items: page.items.map((a) => ({
      id: a.id,
      number: a.number,
      employee: a.employee,
      amount: a.amount,
      outstanding: a.outstanding,
      givenOn: a.givenOn,
      purpose: a.purpose,
      installmentAmount: a.installmentAmount,
      recoverFrom: a.recoverFrom,
      isOpening: a.isOpening,
      status: a.status,
    })),
    nextCursor: page.nextCursor,
  };
}

export type AdvanceRow = Awaited<ReturnType<typeof listAdvanceRows>>["items"][number];

export async function getAdvanceList(ctx: CompanyContext, raw: unknown = {}) {
  const access = hrAccess(ctx);
  const q = advanceListSchema.parse(raw);
  const [rows, person] = await Promise.all([
    listAdvanceRows(ctx, q),
    q.employeeId
      ? ctx.db.employee.findUnique({
          where: { id: q.employeeId },
          select: { id: true, code: true, name: true },
        })
      : null,
  ]);
  return {
    ...rows,
    employee: person,
    can: { give: access.giveAdvance, bringForward: access.openingAdvance },
  };
}

/** One advance: how it was given and settled, and what may be done with it. */
export async function getAdvanceScreen(ctx: CompanyContext, advanceId: string) {
  const access = hrAccess(ctx);
  const a = await getAdvance(ctx, advanceId);
  const live = a.settlements.filter((s) => !s.reversedAt).length;
  const voiding = canVoidAdvance(a, live);
  const open = canChangeAdvance(a);
  return {
    advance: {
      ...a,
      settlements: a.settlements.map((s) => ({
        ...s,
        settledOn: localDay(s.settledAt, ctx.company.timezone),
        canUndo:
          access.pay &&
          access.receive &&
          isCashReturn({ kind: s.kind, hasEntry: s.journalEntry !== null }) &&
          canUndoReturn(a, { reversed: s.reversedAt !== null }).ok,
      })),
    },
    moneyAccounts: access.receive && canTakeAdvanceBack(a).ok ? await listMoneyAccounts(ctx) : [],
    today: today(ctx),
    can: {
      change: access.changeRecovery && open.ok,
      takeBack: access.receive && canTakeAdvanceBack(a).ok,
      void: mayVoidAdvance(access, a) && voiding.ok,
      openEmployee: access.view,
      openJournal: access.openJournal,
      openPayroll: access.salaries,
      openExpenses: access.openExpenses,
    },
    notes: {
      void: mayVoidAdvance(access, a) && a.status !== "VOID" && !voiding.ok ? note(voiding) : null,
    },
  };
}

export type AdvanceScreen = Awaited<ReturnType<typeof getAdvanceScreen>>;

/** Giving an advance: the people employed now and the accounts money can come from. */
export async function getAdvanceForm(ctx: CompanyContext, options: { employeeId?: string } = {}) {
  const access = hrAccess(ctx);
  if (!access.giveAdvance && !access.openingAdvance) {
    throw new AppError("FORBIDDEN", "Only Accounts can pay out advances.");
  }
  const [people, accounts] = await Promise.all([
    currentPeople(ctx),
    access.giveAdvance ? listMoneyAccounts(ctx) : Promise.resolve([]),
  ]);
  return {
    today: today(ctx),
    people,
    moneyAccounts: accounts,
    employeeId: people.some((p) => p.id === options.employeeId) ? options.employeeId! : null,
    can: { give: access.giveAdvance, bringForward: access.openingAdvance },
  };
}

export type AdvanceForm = Awaited<ReturnType<typeof getAdvanceForm>>;

// =============================================================================
// HR settings: rules, holidays, leave types
// =============================================================================

export async function getSettingsScreen(ctx: CompanyContext, raw: { year?: unknown } = {}) {
  const access = hrAccess(ctx);
  const thisYear = Number(today(ctx).slice(0, 4));
  const year =
    Number(raw.year) >= thisYear - 5 && Number(raw.year) <= thisYear + 2
      ? Number(raw.year)
      : thisYear;
  const [rules, holidays, types, closed, approved] = await Promise.all([
    getHrSettings(ctx),
    listHolidays(ctx, { year }),
    listLeaveTypes(ctx, { includeInactive: true }),
    closedMonths(ctx),
    ctx.db.leaveRequest.groupBy({
      by: ["leaveTypeId"],
      where: { status: "APPROVED" },
      _count: { _all: true },
    }),
  ]);
  const approvedOf = new Map(approved.map((a) => [a.leaveTypeId, a._count._all]));
  return {
    rules: {
      weeklyOffDays: rules.weeklyOffDays,
      officeStartTime: rules.officeStartTime,
      lateGraceMinutes: rules.lateGraceMinutes,
      latesPerDeductionDay: rules.latesPerDeductionDay,
      selfCheckIn: rules.selfCheckIn,
    },
    year,
    years: [thisYear - 1, thisYear, thisYear + 1],
    holidays: holidays.items.map((h) => ({
      ...h,
      canRemove: access.manage && canRemoveHoliday(h.date, closed).ok,
    })),
    leaveTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      daysPerYear: t.daysPerYear,
      isPaid: t.isPaid,
      prorate: t.prorate,
      isActive: t.isActive,
      /** Paid or unpaid is fixed once the type has approved leave. */
      paidFixed: !canSwitchPaid(t, approvedOf.get(t.id) ?? 0).ok,
    })),
    can: { manage: access.manage },
  };
}

export type HrSettingsScreen = Awaited<ReturnType<typeof getSettingsScreen>>;

// =============================================================================
// My HR (the employee portal)
// =============================================================================

/**
 * The signed-in employee's own page: today's check-in, this month's
 * attendance, leave left, advances owed, latest payslips and their details.
 */
export async function getMyHrScreen(ctx: CompanyContext) {
  const o = await getMyOverview(ctx);
  const employee = await linkedEmployee(ctx);
  const day = o.today.date;
  const onLeave = employee
    ? await ctx.db.leaveRequest.findFirst({
        where: {
          employeeId: employee.id,
          status: "APPROVED",
          halfDay: false,
          startDate: { lte: dateColumn(day) },
          endDate: { gte: dateColumn(day) },
        },
        include: { leaveType: { select: { name: true } } },
      })
    : null;
  const working = employee ? employedOn(employee, day) : false;
  const closed = (await closedMonths(ctx)).has(day.slice(0, 7));
  const mark = o.today.mark;
  const open = o.today.selfCheckIn && working && !closed;
  return {
    ...o,
    onLeaveToday: onLeave ? onLeave.leaveType.name : null,
    can: {
      checkIn: open && !onLeave && !mark?.checkIn,
      checkOut: open && Boolean(mark?.checkIn) && !mark?.checkOut,
    },
  };
}

export type MyHrScreen = Awaited<ReturnType<typeof getMyHrScreen>>;

export async function getMyMonthScreen(ctx: CompanyContext, raw: unknown = {}) {
  const q = monthQuery.parse(raw);
  const day = today(ctx);
  const now = day.slice(0, 7);
  const month = q.month && q.month <= now ? q.month : now;
  const m = await myAttendance(ctx, { month }, { upTo: day });
  return { ...m, label: monthLabel(month), today: day, thisMonth: now };
}

/** The employee's leave for a year, with asking for leave and withdrawing a waiting request. */
export async function getMyLeaveScreen(ctx: CompanyContext, raw: { year?: unknown } = {}) {
  const thisYear = Number(today(ctx).slice(0, 4));
  const year =
    Number(raw.year) >= thisYear - 5 && Number(raw.year) <= thisYear + 1
      ? Number(raw.year)
      : thisYear;
  const l = await myLeave(ctx, { year });
  const me = actingAs(ctx);
  const closed = await closedMonths(ctx);
  return {
    ...l,
    today: today(ctx),
    years: [thisYear - 1, thisYear, thisYear + 1],
    requests: l.requests.map((r) => ({
      ...r,
      canWithdraw: canCancelLeave(
        {
          status: r.status as LeaveStatus,
          employeeUserId: me.userId,
          months: monthsBetween(r.startDate, r.endDate),
        },
        { ...me, manage: false },
        closed,
      ).ok,
    })),
  };
}

export type MyLeaveScreen = Awaited<ReturnType<typeof getMyLeaveScreen>>;

export async function getMyPayslipsScreen(ctx: CompanyContext) {
  return { payslips: await myPayslips(ctx) };
}

export async function getMyPayslipScreen(ctx: CompanyContext, itemId: string) {
  return { slip: withPaidOn(ctx, await myPayslip(ctx, itemId)) };
}

export async function getMyAdvancesScreen(ctx: CompanyContext) {
  const a = await myAdvances(ctx);
  return {
    ...a,
    items: a.items.map((x) => ({
      ...x,
      settlements: x.settlements.map((s) => ({
        ...s,
        settledOn: localDay(s.settledAt, ctx.company.timezone),
      })),
    })),
  };
}

export type MyAdvancesScreen = Awaited<ReturnType<typeof getMyAdvancesScreen>>;

/** Attendance statuses HR picks from when marking a day. */
export const MARK_STATUSES: readonly AttendanceStatus[] = ["PRESENT", "LATE", "HALF_DAY", "ABSENT"];

export { monthRange };
