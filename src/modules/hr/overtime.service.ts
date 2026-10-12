import type { Attendance, HrSettings, OvertimeEntry, Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay, localTime, weekday } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanManageHr, assertNotOwnRecord, isCompanyOwner } from "@/modules/hr/access";
import { type DayType, monthLabel, monthRange, weekdayName } from "@/modules/hr/calendar";
import {
  checkAgainstTrail,
  findOvertime,
  OVERTIME_STEP_MINUTES,
  type TrailCheck,
} from "@/modules/hr/overtime";
import { assertMonthsOpen } from "@/modules/hr/period-lock";
import {
  approveAllOvertimeSchema,
  decideOvertimeSchema,
  overtimeLedgerSchema,
} from "@/modules/hr/schemas";
import { loadHrSettings } from "@/modules/hr/setup";

/*
 * Shadow overtime. When someone checks themselves out after the end of the
 * working day (or works on a day off), the app records the overtime here,
 * silently: staff never see it, not on My HR nor through the portal API. HR
 * (hr.manage) sees the month's ledger and approves each entry as found,
 * changes the hours (with a reason) or rejects it (with a reason). Only the
 * approved minutes are written to the day's attendance (overtimeMinutes), which
 * payroll already pays at the person's overtime rate. Decisions are frozen once
 * the month's payroll is approved, and nobody decides their own overtime (a
 * Super Admin aside).
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

/** Found overtime this long or longer is flagged as a long day. */
const LONG_DAY_MINUTES = 4 * 60;

const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** "2 h 15 min" for the audit trail. */
function minutesWords(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// =============================================================================
// Finding overtime at check-out
// =============================================================================

/**
 * Records the overtime in a self check-out, inside the check-out's
 * transaction (after its position is saved). With GPS attendance, a check-in
 * at a work place lets the trail say when the person actually left it.
 * Nothing is recorded when shadow overtime is off or there is no overtime; an
 * entry HR already decided is left alone.
 */
export async function recordShadowOvertime(
  tx: Tx,
  input: {
    companyId: string;
    mark: Attendance;
    settings: HrSettings;
    timeZone: string;
  },
): Promise<OvertimeEntry | null> {
  const { companyId, mark, settings, timeZone } = input;
  if (!settings.shadowOvertime || !mark.checkIn || !mark.checkOut) return null;
  const day = dateOnly(mark.date);
  const holiday = await tx.holiday.findFirst({
    where: { companyId, date: mark.date },
    select: { id: true },
  });
  const dayType: DayType = holiday
    ? "HOLIDAY"
    : settings.weeklyOffDays.includes(weekday(day))
      ? "WEEKLY_OFF"
      : "WORKING";
  const found = findOvertime({
    day,
    dayType,
    checkIn: mark.checkIn,
    checkOut: mark.checkOut,
    rules: settings,
    timeZone,
  });
  const existing = await tx.overtimeEntry.findUnique({ where: { attendanceId: mark.id } });
  if (existing && existing.status !== "PENDING") return existing;
  if (!found) {
    if (existing) await tx.overtimeEntry.delete({ where: { id: existing.id } });
    return null;
  }

  let trail: TrailCheck | null = null;
  if (mark.checkInPlaceId && !mark.checkInAway) {
    const place = await tx.workLocation.findFirst({
      where: { id: mark.checkInPlaceId, companyId },
    });
    if (place) {
      const pings = await tx.locationPing.findMany({
        where: {
          companyId,
          employeeId: mark.employeeId,
          at: { gte: found.startsAt, lte: mark.checkOut },
        },
        select: { at: true, lat: true, lng: true, accuracy: true },
        orderBy: { at: "asc" },
      });
      trail = checkAgainstTrail({
        found,
        checkOut: mark.checkOut,
        pings,
        place: {
          id: place.id,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          radiusMeters: place.radiusMeters,
        },
        checkOutAt:
          mark.checkOutLat !== null && mark.checkOutLng !== null
            ? { lat: mark.checkOutLat, lng: mark.checkOutLng, accuracy: mark.checkOutAccuracy }
            : null,
        rules: settings,
      });
    }
  }

  const data = {
    basis: found.basis,
    startsAt: found.startsAt,
    checkOut: mark.checkOut,
    detectedMinutes: found.minutes,
    suggestedMinutes: trail?.suggestedMinutes ?? null,
    lastAtPlace: trail?.lastAtPlace ?? null,
  };
  return existing
    ? tx.overtimeEntry.update({ where: { id: existing.id }, data })
    : tx.overtimeEntry.create({
        data: {
          companyId,
          employeeId: mark.employeeId,
          attendanceId: mark.id,
          date: mark.date,
          ...data,
        },
      });
}

// =============================================================================
// HR: the overtime ledger
// =============================================================================

/** Why HR should look before approving: shown as flags on the ledger. */
export type OvertimeFlag =
  | "LEFT_EARLY" // the trail shows they left the work place before checking out
  | "AWAY_AT_CHECK_OUT" // checked out away from the work place
  | "NO_LOCATION" // checked out without a location while GPS attendance is on
  | "LONG_DAY"; // four hours or more

const ledgerInclude = {
  employee: {
    select: {
      id: true,
      code: true,
      name: true,
      designation: true,
      userId: true,
      overtimeRate: true,
    },
  },
  attendance: {
    select: {
      checkIn: true,
      checkOut: true,
      overtimeMinutes: true,
      checkInAway: true,
      checkOutAway: true,
      checkOutLat: true,
      checkInPlace: { select: { name: true } },
    },
  },
  decidedBy: { select: { name: true } },
} satisfies Prisma.OvertimeEntryInclude;

type LedgerEntry = Prisma.OvertimeEntryGetPayload<{ include: typeof ledgerInclude }>;

function flagsOf(e: LedgerEntry, gpsAttendance: boolean): OvertimeFlag[] {
  const flags: OvertimeFlag[] = [];
  if (e.suggestedMinutes !== null) flags.push("LEFT_EARLY");
  if (e.attendance.checkOutAway && !e.attendance.checkInAway) flags.push("AWAY_AT_CHECK_OUT");
  if (gpsAttendance && e.attendance.checkOutLat === null) flags.push("NO_LOCATION");
  if (e.detectedMinutes >= LONG_DAY_MINUTES) flags.push("LONG_DAY");
  return flags;
}

/** Pay for some overtime minutes at the person's hourly overtime rate. */
function payFor(minutes: number, rate: Prisma.Decimal | null) {
  if (!rate) return null;
  return rate.times(minutes).dividedBy(60).toDecimalPlaces(2).toFixed(2);
}

/**
 * The month's overtime for HR: each entry with what the app found, what the
 * trail suggests, the decision and why, and the pay it comes to. Totals cover
 * the whole month; `status` only narrows the list.
 */
export async function getOvertimeLedger(ctx: CompanyContext, raw: unknown = {}) {
  assertCanManageHr(ctx, "Only HR can see overtime.");
  const q = overtimeLedgerSchema.parse(raw);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const today = localDay(new Date(), tz);
  const month = q.month ?? today.slice(0, 7);
  const { from, to } = monthRange(month);
  const [settings, entries, closed] = await Promise.all([
    loadHrSettings(companyId),
    ctx.db.overtimeEntry.findMany({
      where: {
        date: { gte: dateColumn(from), lte: dateColumn(to) },
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      },
      include: ledgerInclude,
      orderBy: [{ date: "desc" }, { checkOut: "desc" }],
    }),
    ctx.db.payrollRun.findFirst({
      where: {
        year: Number(month.slice(0, 4)),
        month: Number(month.slice(5, 7)),
        status: { not: "DRAFT" },
      },
      select: { id: true },
    }),
  ]);
  const owner = isCompanyOwner(ctx);
  const rows = entries.map((e) => {
    const day = dateOnly(e.date);
    const outDay = localDay(e.checkOut, tz);
    const own = e.employee.userId === ctx.user.id && !owner;
    const paidMinutes = e.status === "APPROVED" ? (e.approvedMinutes ?? 0) : e.detectedMinutes;
    return {
      id: e.id,
      date: day,
      weekday: weekdayName(weekday(day)),
      employee: {
        id: e.employee.id,
        code: e.employee.code,
        name: e.employee.name,
        designation: e.employee.designation,
      },
      basis: e.basis,
      checkIn: e.attendance.checkIn ? localTime(e.attendance.checkIn, tz) : null,
      checkOut: localTime(e.checkOut, tz),
      /** Checked out after midnight. */
      checkOutNextDay: outDay !== day,
      placeName: e.attendance.checkInPlace?.name ?? null,
      startsAt: localTime(e.startsAt, tz),
      detectedMinutes: e.detectedMinutes,
      suggestedMinutes: e.suggestedMinutes,
      lastAtPlace: e.lastAtPlace ? localTime(e.lastAtPlace, tz) : null,
      status: e.status,
      approvedMinutes: e.approvedMinutes,
      reason: e.reason,
      decidedBy: e.decidedBy?.name ?? null,
      decidedAt: e.decidedAt ? localDay(e.decidedAt, tz) : null,
      /** The overtime on the day's attendance now (what payroll pays). */
      inRegister: e.attendance.overtimeMinutes,
      /** Approved, but the day was changed in the attendance register since. */
      changedInRegister:
        e.status === "APPROVED" && e.attendance.overtimeMinutes !== (e.approvedMinutes ?? 0),
      flags: flagsOf(e, settings.gpsAttendance),
      /** Pay at the person's overtime rate: approved minutes, else as found. */
      pay: payFor(paidMinutes, e.employee.overtimeRate),
      rate: e.employee.overtimeRate?.toFixed(2) ?? null,
      can: { decide: !closed && !own },
      own,
    };
  });
  const sum = (list: typeof rows, pick: (r: (typeof rows)[number]) => number) =>
    list.reduce((total, r) => total + pick(r), 0);
  const waiting = rows.filter((r) => r.status === "PENDING");
  const approved = rows.filter((r) => r.status === "APPROVED");
  const approvedPay = approved.reduce(
    (total, r) => total + (r.pay === null ? 0 : Number(r.pay)),
    0,
  );
  const readyToApprove = waiting.filter((r) => r.flags.length === 0 && r.can.decide);
  return {
    month,
    label: monthLabel(month),
    thisMonth: today.slice(0, 7),
    closed: closed !== null,
    rules: {
      shadowOvertime: settings.shadowOvertime,
      officeEndTime: settings.officeEndTime,
      overtimeMinMinutes: settings.overtimeMinMinutes,
      stepMinutes: OVERTIME_STEP_MINUTES,
      gpsAttendance: settings.gpsAttendance,
    },
    totals: {
      waiting: { count: waiting.length, minutes: sum(waiting, (r) => r.detectedMinutes) },
      approved: {
        count: approved.length,
        minutes: sum(approved, (r) => r.approvedMinutes ?? 0),
        pay: approvedPay.toFixed(2),
      },
      rejected: rows.filter((r) => r.status === "REJECTED").length,
      needsLook: waiting.filter((r) => r.flags.length > 0).length,
      /** Waiting entries "Approve all as found" would approve. */
      readyToApprove: readyToApprove.length,
    },
    rows: q.status ? rows.filter((r) => r.status === q.status) : rows,
    status: q.status ?? null,
  };
}

export type OvertimeLedger = Awaited<ReturnType<typeof getOvertimeLedger>>;

/** Waiting overtime in a month, for the payroll screen's reminder. */
export async function waitingOvertime(ctx: CompanyContext, month: string) {
  const { from, to } = monthRange(month);
  return ctx.db.overtimeEntry.count({
    where: { status: "PENDING", date: { gte: dateColumn(from), lte: dateColumn(to) } },
  });
}

/**
 * Approves (as found, or other minutes with a reason) or rejects (with a
 * reason) one entry. Approving writes the minutes to the day's attendance for
 * payroll; rejecting an approved entry takes them off again (unless the day
 * was changed in the attendance register since). Changing an earlier decision
 * is allowed until the month's payroll is approved.
 */
export async function decideOvertime(
  ctx: CompanyContext,
  entryId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can approve overtime.");
  const input = decideOvertimeSchema.parse(raw);
  const companyId = ctx.company.id;
  const entry = await ctx.db.overtimeEntry.findUnique({
    where: { id: entryId },
    include: { employee: { select: { name: true, userId: true } } },
  });
  if (!entry) throw new AppError("NOT_FOUND", "Overtime not found.");
  assertNotOwnRecord(ctx, entry.employee, "Someone else in HR decides your own overtime.");
  const approve = input.decision === "APPROVE";
  const minutes = approve ? (input.minutes ?? entry.detectedMinutes) : 0;
  const reason = input.reason?.trim() || null;
  if (approve && minutes !== entry.detectedMinutes && (reason?.length ?? 0) < 5) {
    const message = "Say why the hours differ from what the app found.";
    throw new AppError("VALIDATION", message, { reason: [message] });
  }
  const day = dateOnly(entry.date);

  const saved = await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, companyId, [day.slice(0, 7)], "overtime");
    // Re-read under the month's lock: someone else may have just decided it.
    const current = await tx.overtimeEntry.findFirst({
      where: { id: entry.id, companyId },
      include: { attendance: { select: { id: true, overtimeMinutes: true } } },
    });
    if (!current) throw new AppError("NOT_FOUND", "Overtime not found.");
    const updated = await tx.overtimeEntry.update({
      where: { id: current.id },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        approvedMinutes: approve ? minutes : null,
        reason,
        decidedById: ctx.user.id,
        decidedAt: new Date(),
      },
    });
    const wasApproved = current.status === "APPROVED";
    if (approve) {
      await tx.attendance.update({
        where: { id: current.attendance.id },
        data: { overtimeMinutes: minutes },
      });
    } else if (
      wasApproved &&
      current.attendance.overtimeMinutes === (current.approvedMinutes ?? 0)
    ) {
      await tx.attendance.update({
        where: { id: current.attendance.id },
        data: { overtimeMinutes: 0 },
      });
    }
    const found = minutesWords(current.detectedMinutes);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "OvertimeEntry",
        entityId: current.id,
        summary: approve
          ? `Approved ${minutesWords(minutes)} overtime for ${entry.employee.name} on ${day}${
              minutes === current.detectedMinutes ? " as found" : ` (found ${found}: ${reason})`
            }`
          : `Rejected ${found} overtime for ${entry.employee.name} on ${day}: ${reason}`,
        before: { status: current.status, approvedMinutes: current.approvedMinutes },
        after: { status: updated.status, approvedMinutes: updated.approvedMinutes },
      },
      tx,
    );
    return updated;
  }, TX_OPTIONS);
  return {
    id: saved.id,
    status: saved.status,
    approvedMinutes: saved.approvedMinutes,
    hours: hoursOf(saved.approvedMinutes ?? 0),
  };
}

/**
 * Approves a month's waiting overtime as found, leaving out entries with a
 * flag (they need a look first) and the person's own.
 */
export async function approveAllOvertime(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can approve overtime.");
  const { month } = approveAllOvertimeSchema.parse(raw);
  const companyId = ctx.company.id;
  const ledger = await getOvertimeLedger(ctx, { month, status: "PENDING" });
  const ids = ledger.rows.filter((r) => r.flags.length === 0 && r.can.decide).map((r) => r.id);
  if (ids.length === 0) {
    throw new AppError("CONFLICT", "Nothing is waiting that can be approved as found.");
  }
  const approved = await prisma.$transaction(async (tx) => {
    await assertMonthsOpen(tx, companyId, [month], "overtime");
    const pending = await tx.overtimeEntry.findMany({
      where: { companyId, id: { in: ids }, status: "PENDING" },
    });
    const now = new Date();
    for (const e of pending) {
      await tx.overtimeEntry.update({
        where: { id: e.id },
        data: {
          status: "APPROVED",
          approvedMinutes: e.detectedMinutes,
          reason: null,
          decidedById: ctx.user.id,
          decidedAt: now,
        },
      });
      await tx.attendance.update({
        where: { id: e.attendanceId },
        data: { overtimeMinutes: e.detectedMinutes },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "OvertimeEntry",
        entityId: null,
        summary: `Approved ${pending.length} overtime entr${pending.length === 1 ? "y" : "ies"} as found for ${monthLabel(month)} (${minutesWords(
          pending.reduce((t, e) => t + e.detectedMinutes, 0),
        )})`,
      },
      tx,
    );
    return pending.length;
  }, TX_OPTIONS);
  return { approved, needsLook: ledger.totals.needsLook };
}
