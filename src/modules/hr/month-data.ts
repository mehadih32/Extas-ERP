import type { Employee, HrSettings } from "@prisma/client";

import { dateColumn, dateOnly } from "@/lib/dates";
import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import type { HrCalendar } from "@/modules/hr/calendar";
import type { AttendanceMark, EmploymentInput, MonthRules } from "@/modules/hr/payroll-calc";
import { loadCalendar, loadHrSettings } from "@/modules/hr/setup";

/*
 * Loads what the salary maths needs (payroll-calc.ts) from the database: the
 * working calendar, salary history, attendance marks and approved leave.
 */

/** Employees on the books at any time between two days, by code. */
export async function employeesInPeriod(
  companyId: string,
  from: string,
  to: string,
  db: Db = prisma,
  employeeIds?: string[],
): Promise<Employee[]> {
  return db.employee.findMany({
    where: {
      companyId,
      ...(employeeIds ? { id: { in: employeeIds } } : {}),
      joinDate: { lte: dateColumn(to) },
      OR: [{ exitDate: null }, { exitDate: { gte: dateColumn(from) } }],
    },
    orderBy: { code: "asc" },
  });
}

/** Is the person employed on this day? */
export function employedOn(employee: Pick<Employee, "joinDate" | "exitDate">, day: string) {
  return (
    dateOnly(employee.joinDate) <= day && (!employee.exitDate || dateOnly(employee.exitDate) >= day)
  );
}

export async function loadRules(
  companyId: string,
  from: string,
  to: string,
  db: Db = prisma,
): Promise<{ settings: HrSettings; calendar: HrCalendar; rules: MonthRules }> {
  const settings = await loadHrSettings(companyId, db);
  const calendar = await loadCalendar(companyId, from, to, db, settings);
  return {
    settings,
    calendar,
    rules: { calendar, latesPerDeductionDay: settings.latesPerDeductionDay },
  };
}

/** Salary history, attendance and approved leave per employee for a period. */
export async function loadEmploymentInputs(
  companyId: string,
  employees: Employee[],
  from: string,
  to: string,
  db: Db = prisma,
): Promise<Map<string, EmploymentInput>> {
  const ids = employees.map((e) => e.id);
  const [revisions, marks, leave] = await Promise.all([
    db.salaryRevision.findMany({
      where: { employeeId: { in: ids } },
      orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    }),
    db.attendance.findMany({
      where: {
        companyId,
        employeeId: { in: ids },
        date: { gte: dateColumn(from), lte: dateColumn(to) },
      },
      select: { employeeId: true, date: true, status: true, overtimeMinutes: true },
    }),
    db.leaveRequest.findMany({
      where: {
        companyId,
        employeeId: { in: ids },
        status: "APPROVED",
        startDate: { lte: dateColumn(to) },
        endDate: { gte: dateColumn(from) },
      },
      select: {
        employeeId: true,
        startDate: true,
        endDate: true,
        halfDay: true,
        leaveType: { select: { isPaid: true } },
      },
    }),
  ]);
  const inputs = new Map<string, EmploymentInput>();
  const marksOf = new Map<string, Map<string, AttendanceMark>>();
  for (const e of employees) {
    const attendance = new Map<string, AttendanceMark>();
    marksOf.set(e.id, attendance);
    inputs.set(e.id, {
      joinDate: dateOnly(e.joinDate),
      exitDate: dateOnly(e.exitDate),
      salaries: [],
      fallbackSalary: e.baseSalary,
      attendance,
      leave: [],
    });
  }
  for (const r of revisions) {
    inputs.get(r.employeeId)?.salaries.push({
      effectiveFrom: dateOnly(r.effectiveFrom),
      amount: r.amount,
    });
  }
  for (const m of marks) {
    marksOf.get(m.employeeId)?.set(dateOnly(m.date), {
      status: m.status,
      overtimeMinutes: m.overtimeMinutes,
    });
  }
  for (const l of leave) {
    inputs.get(l.employeeId)?.leave.push({
      startDate: dateOnly(l.startDate),
      endDate: dateOnly(l.endDate),
      halfDay: l.halfDay,
      isPaid: l.leaveType.isPaid,
    });
  }
  return inputs;
}
