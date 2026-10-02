import type { Attendance, Employee, Prisma } from "@prisma/client";

import { atLocalTime, dateColumn, dateOnly, localDay, localTime, weekday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, requireLinkedEmployee } from "@/modules/hr/access";
import { dayType, monthRange, weekdayName } from "@/modules/hr/calendar";
import { leaveOnDay } from "@/modules/hr/leave.service";
import {
  employedOn,
  employeesInPeriod,
  loadEmploymentInputs,
  loadRules,
} from "@/modules/hr/month-data";
import { evaluateMonth, minutesToHours } from "@/modules/hr/payroll-calc";
import { assertMonthsOpen } from "@/modules/hr/period-lock";
import {
  attendanceDaySchema,
  attendanceMonthSchema,
  checkInSchema,
  markAttendanceSchema,
} from "@/modules/hr/schemas";
import { loadHrSettings } from "@/modules/hr/setup";

/*
 * Attendance by exception: a working day nobody marked counts as present, so
 * HR only marks lates, half days and absences (and overtime minutes). Marking
 * a day replaces that day's record. Employees can also check in and out from
 * the portal; a check-in after the office start time plus the grace minutes is
 * late. Days in a month whose payroll is approved cannot change.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);
const thisMonth = (ctx: CompanyContext) => today(ctx).slice(0, 7);

function brief(e: Pick<Employee, "id" | "code" | "name" | "designation" | "department">) {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    designation: e.designation,
    department: e.department,
  };
}

function presentMark(m: Attendance | null | undefined, timeZone: string) {
  if (!m) return null;
  return {
    id: m.id,
    status: m.status,
    checkIn: m.checkIn ? localTime(m.checkIn, timeZone) : null,
    checkOut: m.checkOut ? localTime(m.checkOut, timeZone) : null,
    overtimeMinutes: m.overtimeMinutes,
    note: m.note,
    source: m.source,
  };
}

/** Is a check-in at this local time late? */
function isLateAt(time: string, settings: { officeStartTime: string; lateGraceMinutes: number }) {
  const [h, m] = settings.officeStartTime.split(":").map(Number) as [number, number];
  const limit = h * 60 + m + settings.lateGraceMinutes;
  const [ch, cm] = time.split(":").map(Number) as [number, number];
  return ch * 60 + cm > limit;
}

// =============================================================================
// HR: the day register, marking and monthly summaries
// =============================================================================

/** Everyone employed on a day with their mark and any leave (default: today). */
export async function getAttendanceDay(ctx: CompanyContext, raw: unknown = {}) {
  const q = attendanceDaySchema.parse(raw);
  const day = q.date ?? today(ctx);
  const companyId = ctx.company.id;
  const { calendar } = await loadRules(companyId, day, day);
  const [employees, marks, leave, holiday] = await Promise.all([
    employeesInPeriod(companyId, day, day),
    ctx.db.attendance.findMany({ where: { date: dateColumn(day) } }),
    leaveOnDay(ctx, day),
    ctx.db.holiday.findFirst({ where: { date: dateColumn(day) } }),
  ]);
  const markOf = new Map(marks.map((m) => [m.employeeId, m]));
  const rows = employees.map((e) => {
    const l = leave.find((x) => x.employeeId === e.id);
    return {
      employee: brief(e),
      mark: presentMark(markOf.get(e.id), ctx.company.timezone),
      leave: l ? { id: l.id, leaveType: l.leaveType, halfDay: l.halfDay, status: l.status } : null,
    };
  });
  const count = (status: string) => rows.filter((r) => r.mark?.status === status).length;
  return {
    date: day,
    weekday: weekdayName(weekday(day)),
    dayType: dayType(calendar, day),
    holiday: holiday?.name ?? null,
    totals: {
      employees: rows.length,
      present: count("PRESENT"),
      late: count("LATE"),
      halfDay: count("HALF_DAY"),
      absent: count("ABSENT"),
      onLeave: rows.filter((r) => r.leave?.status === "APPROVED").length,
      /** No mark and not on full-day leave: counts as present. */
      unmarked: rows.filter((r) => !r.mark && !(r.leave?.status === "APPROVED" && !r.leave.halfDay))
        .length,
    },
    rows,
  };
}

/** HR marks a day for several employees; each entry replaces that day's record. */
export async function markAttendance(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can mark attendance.");
  const input = markAttendanceSchema.parse(raw);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const day = input.date;
  if (day > today(ctx)) throw new AppError("VALIDATION", "Attendance cannot be marked ahead.");
  const ids = input.entries.map((e) => e.employeeId);
  const employees = await ctx.db.employee.findMany({ where: { id: { in: ids } } });
  const byId = new Map(employees.map((e) => [e.id, e]));
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) throw new AppError("NOT_FOUND", "Employee not found.");
    if (!employedOn(e, day)) {
      throw new AppError("VALIDATION", `${e.name} was not employed on ${day}.`);
    }
  }
  await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, companyId, [day.slice(0, 7)], "attendance");
    const onLeave = await tx.leaveRequest.findMany({
      where: {
        companyId,
        employeeId: { in: ids },
        status: "APPROVED",
        halfDay: false,
        startDate: { lte: dateColumn(day) },
        endDate: { gte: dateColumn(day) },
      },
      include: { leaveType: { select: { name: true } } },
    });
    if (onLeave.length > 0) {
      throw new AppError(
        "CONFLICT",
        `On approved leave that day: ${onLeave
          .map((l) => `${byId.get(l.employeeId)!.name} (${l.leaveType.name})`)
          .join(", ")}. Cancel the leave first to mark them.`,
      );
    }
    for (const entry of input.entries) {
      const data = {
        status: entry.status,
        checkIn: entry.checkIn ? atLocalTime(day, entry.checkIn, tz) : null,
        checkOut: entry.checkOut ? atLocalTime(day, entry.checkOut, tz) : null,
        overtimeMinutes: entry.overtimeMinutes,
        note: entry.note ?? null,
        source: "MANUAL" as const,
        recordedById: ctx.user.id,
      };
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: entry.employeeId, date: dateColumn(day) } },
        create: { companyId, employeeId: entry.employeeId, date: dateColumn(day), ...data },
        update: data,
      });
    }
    const tally = (s: string) => input.entries.filter((e) => e.status === s).length;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Attendance",
        entityId: null,
        summary: `Marked attendance for ${day}: ${input.entries.length} employee(s) — ${tally(
          "PRESENT",
        )} present, ${tally("LATE")} late, ${tally("HALF_DAY")} half day, ${tally("ABSENT")} absent`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getAttendanceDay(ctx, { date: day });
}

/** Removes a day's mark (the day counts as present again). */
export async function clearAttendance(
  ctx: CompanyContext,
  attendanceId: string,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can change attendance.");
  const mark = await ctx.db.attendance.findUnique({
    where: { id: attendanceId },
    include: { employee: { select: { name: true } } },
  });
  if (!mark) throw new AppError("NOT_FOUND", "Attendance record not found.");
  const day = dateOnly(mark.date);
  await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, ctx.company.id, [day.slice(0, 7)], "attendance");
    await tx.attendance.delete({ where: { id: mark.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Attendance",
        entityId: mark.id,
        summary: `Cleared ${mark.employee.name}'s ${mark.status.toLowerCase()} mark on ${day}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { cleared: true, date: day };
}

/** Day counts per employee for a month (the figures payroll uses). */
export async function getAttendanceSummary(ctx: CompanyContext, raw: unknown = {}) {
  const q = attendanceMonthSchema.parse(raw);
  const month = q.month ?? thisMonth(ctx);
  const { from, to } = monthRange(month);
  const companyId = ctx.company.id;
  const employees = await employeesInPeriod(
    companyId,
    from,
    to,
    prisma,
    q.employeeId ? [q.employeeId] : undefined,
  );
  const [{ rules, settings }, inputs] = await Promise.all([
    loadRules(companyId, from, to),
    loadEmploymentInputs(companyId, employees, from, to),
  ]);
  const rows = employees.flatMap((e) => {
    const f = evaluateMonth(month, rules, inputs.get(e.id)!);
    if (!f) return [];
    return [
      {
        employee: brief(e),
        employedFrom: f.employedFrom,
        employedTo: f.employedTo,
        workingDays: f.workingDays,
        presentDays: f.presentDays,
        lateDays: f.lateDays,
        halfDays: f.days.filter((d) => d.mark?.status === "HALF_DAY").length,
        absentDays: f.absentDays,
        paidLeaveDays: f.paidLeaveDays,
        unpaidLeaveDays: f.unpaidLeaveDays,
        latePenaltyDays: f.latePenaltyDays,
        unpaidDays: f.unpaidDays,
        overtimeHours: minutesToHours(f.overtimeMinutes).toNumber(),
      },
    ];
  });
  return {
    month,
    from,
    to,
    latesPerDeductionDay: settings.latesPerDeductionDay,
    rows,
  };
}

/** One employee's month, day by day, with the totals payroll uses. */
export async function employeeMonth(ctx: CompanyContext, employee: Employee, month: string) {
  const { from, to } = monthRange(month);
  const companyId = ctx.company.id;
  const [{ rules }, inputs, marks, holidays] = await Promise.all([
    loadRules(companyId, from, to),
    loadEmploymentInputs(companyId, [employee], from, to),
    ctx.db.attendance.findMany({
      where: { employeeId: employee.id, date: { gte: dateColumn(from), lte: dateColumn(to) } },
    }),
    ctx.db.holiday.findMany({ where: { date: { gte: dateColumn(from), lte: dateColumn(to) } } }),
  ]);
  const f = evaluateMonth(month, rules, inputs.get(employee.id)!);
  const markOf = new Map(marks.map((m) => [dateOnly(m.date), m]));
  const holidayOf = new Map(holidays.map((h) => [dateOnly(h.date), h.name]));
  return {
    employee: brief(employee),
    month,
    employed: f !== null,
    totals: f
      ? {
          workingDays: f.workingDays,
          presentDays: f.presentDays,
          lateDays: f.lateDays,
          absentDays: f.absentDays,
          paidLeaveDays: f.paidLeaveDays,
          unpaidLeaveDays: f.unpaidLeaveDays,
          latePenaltyDays: f.latePenaltyDays,
          unpaidDays: f.unpaidDays,
          overtimeHours: minutesToHours(f.overtimeMinutes).toNumber(),
        }
      : null,
    days: (f?.days ?? []).map((d) => ({
      date: d.date,
      weekday: weekdayName(weekday(d.date)),
      dayType: d.dayType,
      holiday: holidayOf.get(d.date) ?? null,
      mark: presentMark(markOf.get(d.date), ctx.company.timezone),
      leave: d.leave,
      present: d.present,
      absent: d.absent,
      paidLeave: d.paidLeave,
      unpaidLeave: d.unpaidLeave,
    })),
  };
}

export async function getEmployeeAttendance(
  ctx: CompanyContext,
  employeeId: string,
  raw: unknown = {},
) {
  const q = attendanceMonthSchema.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  return employeeMonth(ctx, employee, q.month ?? thisMonth(ctx));
}

// =============================================================================
// Employee portal: own month, check in and check out
// =============================================================================

export async function myAttendance(ctx: CompanyContext, raw: unknown = {}) {
  const q = attendanceMonthSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  return employeeMonth(ctx, employee, q.month ?? thisMonth(ctx));
}

async function todaysMark(tx: Tx, employeeId: string, day: string) {
  return tx.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: dateColumn(day) } },
  });
}

/** Checks the signed-in employee in now (late after the start time plus grace). */
export async function checkIn(ctx: CompanyContext, raw: unknown = {}, meta?: RequestMeta) {
  const { note } = checkInSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const settings = await loadHrSettings(companyId);
  if (!settings.selfCheckIn) {
    throw new AppError("FORBIDDEN", "Checking in from the portal is turned off. Ask HR.");
  }
  const now = new Date();
  const day = localDay(now, tz);
  if (!employedOn(employee, day)) {
    throw new AppError("FORBIDDEN", "You are not on the company's staff list today.");
  }
  const time = localTime(now, tz);
  const status = isLateAt(time, settings) ? "LATE" : "PRESENT";
  const mark = await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, companyId, [day.slice(0, 7)], "attendance");
    const leave = await tx.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        halfDay: false,
        startDate: { lte: dateColumn(day) },
        endDate: { gte: dateColumn(day) },
      },
    });
    if (leave) throw new AppError("CONFLICT", "You are on approved leave today.");
    const existing = await todaysMark(tx, employee.id, day);
    if (existing?.checkIn) {
      throw new AppError(
        "CONFLICT",
        `You already checked in today at ${localTime(existing.checkIn, tz)}.`,
      );
    }
    const saved = existing
      ? await tx.attendance.update({
          where: { id: existing.id },
          data: {
            checkIn: now,
            // HR's mark stands, except an absence: the person is here after all.
            ...(existing.status === "ABSENT" ? { status } : {}),
            note: note ?? existing.note,
          },
        })
      : await tx.attendance.create({
          data: {
            companyId,
            employeeId: employee.id,
            date: dateColumn(day),
            status,
            checkIn: now,
            note: note ?? null,
            source: "SELF",
            recordedById: ctx.user.id,
          },
        });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Attendance",
        entityId: saved.id,
        summary: `${employee.name} checked in at ${time}${status === "LATE" ? " (late)" : ""}`,
      },
      tx,
    );
    return saved;
  }, TX_OPTIONS);
  return { date: day, mark: presentMark(mark, tz) };
}

export async function checkOut(ctx: CompanyContext, raw: unknown = {}, meta?: RequestMeta) {
  const { note } = checkInSchema.parse(raw);
  const employee = await requireLinkedEmployee(ctx);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const settings = await loadHrSettings(companyId);
  if (!settings.selfCheckIn) {
    throw new AppError("FORBIDDEN", "Checking out from the portal is turned off. Ask HR.");
  }
  const now = new Date();
  const day = localDay(now, tz);
  const mark = await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, companyId, [day.slice(0, 7)], "attendance");
    const existing = await todaysMark(tx, employee.id, day);
    if (!existing?.checkIn) throw new AppError("CONFLICT", "Check in first.");
    if (existing.checkOut) {
      throw new AppError(
        "CONFLICT",
        `You already checked out today at ${localTime(existing.checkOut, tz)}.`,
      );
    }
    const saved = await tx.attendance.update({
      where: { id: existing.id },
      data: { checkOut: now, note: note ?? existing.note },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "Attendance",
        entityId: saved.id,
        summary: `${employee.name} checked out at ${localTime(now, tz)}`,
      },
      tx,
    );
    return saved;
  }, TX_OPTIONS);
  return { date: day, mark: presentMark(mark, tz) };
}
