import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr } from "@/modules/hr/access";
import { weekdayName } from "@/modules/hr/calendar";
import { recountLeaveDaysTx } from "@/modules/hr/leave.service";
import { assertMonthsOpen } from "@/modules/hr/period-lock";
import {
  createHolidaysSchema,
  createLeaveTypeSchema,
  hrSettingsSchema,
  listHolidaysSchema,
  updateLeaveTypeSchema,
} from "@/modules/hr/schemas";
import { ensureHrSetup, loadHrSettings } from "@/modules/hr/setup";

/*
 * HR rules (weekly days off, office start time and late rules, self check-in),
 * holidays and leave types. Changing days off or holidays re-counts the days of
 * leave not yet locked by an approved payroll; months already approved keep
 * their figures.
 */

const TX_OPTIONS = { timeout: 60_000 };

function presentSettings(s: Awaited<ReturnType<typeof loadHrSettings>>) {
  return {
    weeklyOffDays: s.weeklyOffDays,
    weeklyOffDayNames: s.weeklyOffDays.map(weekdayName),
    officeStartTime: s.officeStartTime,
    lateGraceMinutes: s.lateGraceMinutes,
    latesPerDeductionDay: s.latesPerDeductionDay,
    selfCheckIn: s.selfCheckIn,
    updatedAt: s.updatedAt,
  };
}

function rulesSnapshot(s: Awaited<ReturnType<typeof loadHrSettings>>) {
  return {
    weeklyOffDays: s.weeklyOffDays,
    officeStartTime: s.officeStartTime,
    lateGraceMinutes: s.lateGraceMinutes,
    latesPerDeductionDay: s.latesPerDeductionDay,
    selfCheckIn: s.selfCheckIn,
  };
}

export async function getHrSettings(ctx: CompanyContext) {
  return presentSettings(await loadHrSettings(ctx.company.id));
}

export async function updateHrSettings(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can change the HR rules.");
  const input = hrSettingsSchema.parse(raw);
  const companyId = ctx.company.id;
  const before = await loadHrSettings(companyId);
  const offDaysChanged =
    input.weeklyOffDays !== undefined &&
    input.weeklyOffDays.join(",") !== before.weeklyOffDays.join(",");
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.hrSettings.update({ where: { companyId }, data: input });
    // Leave counts working days, so it changes with the weekly days off.
    const recounted = offDaysChanged
      ? await recountLeaveDaysTx(tx, companyId, "2000-01-01", "2100-12-31")
      : 0;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "HrSettings",
        entityId: saved.id,
        summary: `Updated HR rules: ${Object.keys(input).join(", ")}${
          recounted ? ` (re-counted ${recounted} leave request(s))` : ""
        }`,
        before: rulesSnapshot(before),
        after: rulesSnapshot(saved),
      },
      tx,
    );
    return saved;
  }, TX_OPTIONS);
  return presentSettings(updated);
}

// =============================================================================
// Holidays
// =============================================================================

export async function listHolidays(ctx: CompanyContext, raw: unknown = {}) {
  const q = listHolidaysSchema.parse(raw);
  const year = q.year ?? Number(localDay(new Date(), ctx.company.timezone).slice(0, 4));
  const rows = await ctx.db.holiday.findMany({
    where: { date: { gte: dateColumn(`${year}-01-01`), lte: dateColumn(`${year}-12-31`) } },
    orderBy: { date: "asc" },
  });
  return {
    year,
    items: rows.map((h) => ({
      id: h.id,
      date: dateOnly(h.date),
      weekday: weekdayName(h.date.getUTCDay()),
      name: h.name,
    })),
  };
}

/** Adds one holiday or a list (e.g. the year's public holidays). */
export async function createHolidays(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can set holidays.");
  const holidays = createHolidaysSchema.parse(raw);
  const companyId = ctx.company.id;
  const dates = holidays.map((h) => h.date);
  if (new Set(dates).size !== dates.length) {
    throw new AppError("VALIDATION", "The same date is listed twice.");
  }
  const taken = await ctx.db.holiday.findMany({
    where: { date: { in: dates.map(dateColumn) } },
  });
  if (taken.length > 0) {
    throw new AppError(
      "CONFLICT",
      `Already holidays: ${taken.map((h) => `${dateOnly(h.date)} (${h.name})`).join(", ")}.`,
    );
  }
  const sorted = [...dates].sort();
  await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(
      tx,
      companyId,
      dates.map((d) => d.slice(0, 7)),
      "holidays",
    );
    await tx.holiday.createMany({
      data: holidays.map((h) => ({ companyId, date: dateColumn(h.date), name: h.name })),
    });
    await recountLeaveDaysTx(tx, companyId, sorted[0]!, sorted.at(-1)!);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "Holiday",
        entityId: null,
        summary: `Added holiday(s): ${holidays.map((h) => `${h.date} ${h.name}`).join("; ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return listHolidays(ctx, { year: Number(sorted[0]!.slice(0, 4)) });
}

export async function deleteHoliday(ctx: CompanyContext, holidayId: string, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can set holidays.");
  const holiday = await ctx.db.holiday.findUnique({ where: { id: holidayId } });
  if (!holiday) throw new AppError("NOT_FOUND", "Holiday not found.");
  const day = dateOnly(holiday.date);
  await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, ctx.company.id, [day.slice(0, 7)], "holidays");
    await tx.holiday.delete({ where: { id: holiday.id } });
    await recountLeaveDaysTx(tx, ctx.company.id, day, day);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "Holiday",
        entityId: holiday.id,
        summary: `Removed holiday ${day} (${holiday.name})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { deleted: true };
}

// =============================================================================
// Leave types
// =============================================================================

export async function listLeaveTypes(ctx: CompanyContext, raw: { includeInactive?: unknown } = {}) {
  await ensureHrSetup(ctx.company.id);
  const includeInactive = raw.includeInactive === true || raw.includeInactive === "true";
  return ctx.db.leaveType.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
  });
}

async function assertNameFree(ctx: CompanyContext, name: string, exceptId?: string) {
  const clash = await ctx.db.leaveType.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw new AppError("CONFLICT", `A leave type called "${clash.name}" already exists.`);
}

export async function createLeaveType(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can change leave types.");
  const input = createLeaveTypeSchema.parse(raw);
  await ensureHrSetup(ctx.company.id);
  await assertNameFree(ctx, input.name);
  const type = await ctx.db.leaveType.create({ data: { companyId: ctx.company.id, ...input } });
  await auditInCompany(ctx, meta, {
    action: "CREATE",
    entityType: "LeaveType",
    entityId: type.id,
    summary: `Added leave type "${type.name}" (${type.isPaid ? `${type.daysPerYear} paid days a year` : "unpaid"})`,
  });
  return type;
}

export async function updateLeaveType(
  ctx: CompanyContext,
  leaveTypeId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can change leave types.");
  const input = updateLeaveTypeSchema.parse(raw);
  const type = await ctx.db.leaveType.findUnique({ where: { id: leaveTypeId } });
  if (!type) throw new AppError("NOT_FOUND", "Leave type not found.");
  if (input.name && input.name !== type.name) await assertNameFree(ctx, input.name, type.id);
  if (input.isPaid !== undefined && input.isPaid !== type.isPaid) {
    // Paid or unpaid decides past salaries: start a new type instead.
    const approved = await ctx.db.leaveRequest.count({
      where: { leaveTypeId: type.id, status: "APPROVED" },
    });
    if (approved > 0) {
      throw new AppError(
        "CONFLICT",
        `${type.name} already has approved leave, so it cannot switch between paid and unpaid. Add a new leave type instead.`,
      );
    }
  }
  const updated = await ctx.db.leaveType.update({ where: { id: type.id }, data: input });
  await auditInCompany(ctx, meta, {
    action: "UPDATE",
    entityType: "LeaveType",
    entityId: type.id,
    summary: `Updated leave type "${updated.name}": ${Object.keys(input).join(", ")}`,
  });
  return updated;
}
