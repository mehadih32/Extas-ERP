import { type Employee, type LeaveType, Prisma } from "@prisma/client";

import { dateColumn, dateOnly, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { monthsBetween } from "@/modules/accounts/periods";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import {
  assertCanManageHr,
  assertNotOwnRecord,
  linkedEmployee,
  requireLinkedEmployee,
} from "@/modules/hr/access";
import { isWorkingDay, leaveDayCount, toHalfDays } from "@/modules/hr/calendar";
import { employedOn } from "@/modules/hr/month-data";
import { assertMonthsOpen } from "@/modules/hr/period-lock";
import {
  adjustLeaveBalanceSchema,
  approveLeaveSchema,
  cancelLeaveSchema,
  createLeaveSchema,
  leaveBalancesSchema,
  listLeaveSchema,
  rejectLeaveSchema,
  requestLeaveSchema,
} from "@/modules/hr/schemas";
import { loadCalendar } from "@/modules/hr/setup";

/*
 * Leave: employees ask (portal) or HR records it; HR approves, rejects or
 * cancels. Days count working days only (weekly days off and holidays are
 * skipped) and are re-counted when holidays or days off change. Paid leave
 * types have a yearly allowance (shared out by months worked for people who
 * join or leave during the year, unless the type says otherwise); unpaid leave
 * has no limit and is deducted in payroll. Approved leave in a month whose
 * payroll is approved cannot change until that payroll is reopened.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000 };

const leaveInclude = {
  employee: { select: { id: true, code: true, name: true, userId: true } },
  leaveType: { select: { id: true, name: true, isPaid: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  attachment: { select: { id: true, fileName: true, mimeType: true } },
} satisfies Prisma.LeaveRequestInclude;

type LeaveRow = Prisma.LeaveRequestGetPayload<{ include: typeof leaveInclude }>;

function presentLeave(r: LeaveRow) {
  return {
    id: r.id,
    employee: { id: r.employee.id, code: r.employee.code, name: r.employee.name },
    leaveType: r.leaveType,
    startDate: dateOnly(r.startDate),
    endDate: dateOnly(r.endDate),
    halfDay: r.halfDay,
    days: r.days.toNumber(),
    reason: r.reason,
    status: r.status,
    requestedBy: r.requestedBy,
    /** Who approved or rejected it. */
    decidedBy: r.approvedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    attachment: r.attachment,
    createdAt: r.createdAt,
  };
}

const today = (ctx: CompanyContext) => localDay(new Date(), ctx.company.timezone);

const yearBounds = (year: number) => ({
  gte: dateColumn(`${year}-01-01`),
  lte: dateColumn(`${year}-12-31`),
});

const fmtDays = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Holds the employee's leave until the transaction ends (no double-booking). */
async function lockEmployeeLeave(tx: Tx, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${employeeId}`}))`;
}

// =============================================================================
// Balances
// =============================================================================

/**
 * A year's allowance before any adjustment: the full days, or a share for the
 * months worked that year (to the nearest half day). Unpaid leave: null (no limit).
 */
export function defaultEntitlement(
  type: Pick<LeaveType, "isPaid" | "prorate" | "daysPerYear">,
  employee: Pick<Employee, "joinDate" | "exitDate">,
  year: number,
): number | null {
  if (!type.isPaid) return null;
  if (!type.prorate) return type.daysPerYear;
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;
  const join = dateOnly(employee.joinDate);
  const exit = dateOnly(employee.exitDate);
  const from = join > yearFrom ? join : yearFrom;
  const to = exit && exit < yearTo ? exit : yearTo;
  if (from > to) return 0;
  return toHalfDays((type.daysPerYear * monthsBetween(from, to).length) / 12);
}

async function entitlementFor(
  db: Tx | typeof prisma,
  employee: Employee,
  type: LeaveType,
  year: number,
) {
  if (!type.isPaid) return null;
  const row = await db.leaveBalance.findUnique({
    where: {
      employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: type.id, year },
    },
  });
  return row?.adjusted ? row.entitled.toNumber() : defaultEntitlement(type, employee, year);
}

/** Every leave type's allowance, taken, waiting and left for one employee and year. */
export async function balancesFor(db: Tx | typeof prisma, employee: Employee, year: number) {
  const [types, rows, requests] = await Promise.all([
    db.leaveType.findMany({ where: { companyId: employee.companyId }, orderBy: { name: "asc" } }),
    db.leaveBalance.findMany({ where: { employeeId: employee.id, year } }),
    db.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: yearBounds(year),
      },
      select: { leaveTypeId: true, status: true, days: true },
    }),
  ]);
  // A retired leave type still shows while this year has requests or a set allowance on it.
  const inUse = (typeId: string) =>
    requests.some((r) => r.leaveTypeId === typeId) ||
    rows.some((r) => r.leaveTypeId === typeId && r.adjusted);
  return types
    .filter((type) => type.isActive || inUse(type.id))
    .map((type) => {
      const row = rows.find((r) => r.leaveTypeId === type.id);
      const mine = requests.filter((r) => r.leaveTypeId === type.id);
      const sum = (status: "PENDING" | "APPROVED") =>
        mine.filter((r) => r.status === status).reduce((t, r) => t + r.days.toNumber(), 0);
      const used = sum("APPROVED");
      const entitled = !type.isPaid
        ? null
        : row?.adjusted
          ? row.entitled.toNumber()
          : defaultEntitlement(type, employee, year);
      return {
        leaveType: {
          id: type.id,
          name: type.name,
          isPaid: type.isPaid,
          daysPerYear: type.daysPerYear,
          isActive: type.isActive,
        },
        year,
        /** null for unpaid leave (no limit). */
        entitled,
        used,
        pending: sum("PENDING"),
        remaining: entitled === null ? null : entitled - used,
        adjusted: row?.adjusted ?? false,
        note: row?.note ?? null,
      };
    });
}

/** Keeps the stored LeaveBalance row in step with the approved requests. */
export async function syncLeaveBalanceTx(
  tx: Tx,
  employeeId: string,
  leaveTypeId: string,
  year: number,
) {
  const [employee, type, taken, row] = await Promise.all([
    tx.employee.findUniqueOrThrow({ where: { id: employeeId } }),
    tx.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } }),
    tx.leaveRequest.aggregate({
      where: { employeeId, leaveTypeId, status: "APPROVED", startDate: yearBounds(year) },
      _sum: { days: true },
    }),
    tx.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    }),
  ]);
  const used = taken._sum.days ?? new Prisma.Decimal(0);
  const entitled = row?.adjusted
    ? row.entitled
    : new Prisma.Decimal(defaultEntitlement(type, employee, year) ?? 0);
  await tx.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    create: { employeeId, leaveTypeId, year, entitled, used },
    update: { entitled, used },
  });
}

/** Paid leave may not go past the allowance (unpaid leave has no limit). */
async function assertWithinBalance(
  tx: Tx,
  employee: Employee,
  type: LeaveType,
  year: number,
  days: number,
  options: { countPending: boolean; exceptRequestId?: string },
) {
  if (!type.isPaid) return;
  const entitled = (await entitlementFor(tx, employee, type, year)) ?? 0;
  const taken = await tx.leaveRequest.aggregate({
    where: {
      employeeId: employee.id,
      leaveTypeId: type.id,
      status: options.countPending ? { in: ["PENDING", "APPROVED"] } : "APPROVED",
      startDate: yearBounds(year),
      ...(options.exceptRequestId ? { id: { not: options.exceptRequestId } } : {}),
    },
    _sum: { days: true },
  });
  const left = Math.max(0, entitled - (taken._sum.days?.toNumber() ?? 0));
  if (days > left) {
    throw new AppError(
      "VALIDATION",
      `${employee.name} has ${fmtDays(left)} of ${type.name} left for ${year}${
        options.countPending ? " (counting requests waiting for approval)" : ""
      }; this needs ${fmtDays(days)}. Use unpaid leave for the rest.`,
    );
  }
}

async function assertNoOverlap(
  tx: Tx,
  employeeId: string,
  start: string,
  end: string,
  exceptId?: string,
) {
  const clash = await tx.leaveRequest.findFirst({
    where: {
      employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: dateColumn(end) },
      endDate: { gte: dateColumn(start) },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    include: { leaveType: { select: { name: true } } },
  });
  if (clash) {
    throw new AppError(
      "CONFLICT",
      `This overlaps ${clash.leaveType.name} from ${dateOnly(clash.startDate)} to ${dateOnly(
        clash.endDate,
      )} (${clash.status.toLowerCase()}).`,
    );
  }
}

/** Full-day leave cannot cover a working day the person was marked at work. */
async function assertNoAttendanceClash(
  tx: Tx,
  companyId: string,
  employee: Employee,
  start: string,
  end: string,
  halfDay: boolean,
) {
  if (halfDay) return;
  const marks = await tx.attendance.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: dateColumn(start), lte: dateColumn(end) },
      status: { in: ["PRESENT", "LATE", "HALF_DAY"] },
    },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  if (marks.length === 0) return;
  const calendar = await loadCalendar(companyId, start, end, tx);
  const clashes = marks.map((m) => dateOnly(m.date)).filter((d) => isWorkingDay(calendar, d));
  if (clashes.length > 0) {
    throw new AppError(
      "CONFLICT",
      `${employee.name} was marked at work on ${clashes.join(", ")}. Clear that attendance or change the leave dates first.`,
    );
  }
}

function assertEmployed(employee: Employee, start: string, end: string) {
  if (!employedOn(employee, start) || !employedOn(employee, end)) {
    throw new AppError(
      "VALIDATION",
      `Leave must fall between ${employee.name}'s joining day and last working day.`,
    );
  }
}

async function countDays(
  tx: Tx,
  companyId: string,
  leave: { startDate: string; endDate: string; halfDay: boolean },
) {
  const calendar = await loadCalendar(companyId, leave.startDate, leave.endDate, tx);
  const days = leaveDayCount(calendar, leave);
  if (days === 0) {
    throw new AppError("VALIDATION", "Those dates are all weekly days off or holidays.");
  }
  return days;
}

// =============================================================================
// Requests
// =============================================================================

type NewLeave = {
  leaveTypeId: string;
  startDate: string;
  endDate?: string;
  halfDay: boolean;
  reason?: string | null;
  attachmentId?: string | null;
};

async function createLeaveTx(
  tx: Tx,
  ctx: CompanyContext,
  employee: Employee,
  input: NewLeave,
  options: { approve: boolean },
) {
  const companyId = ctx.company.id;
  const start = input.startDate;
  const end = input.endDate ?? start;
  const type = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId } });
  if (!type) throw new AppError("NOT_FOUND", "Leave type not found.");
  if (!type.isActive) throw new AppError("VALIDATION", `${type.name} is no longer in use.`);
  if (input.attachmentId) {
    const file = await tx.fileAsset.findFirst({ where: { id: input.attachmentId, companyId } });
    if (!file) throw new AppError("NOT_FOUND", "Attachment not found.");
  }
  assertEmployed(employee, start, end);
  const leave = { startDate: start, endDate: end, halfDay: input.halfDay };
  const days = await countDays(tx, companyId, leave);
  await lockEmployeeLeave(tx, employee.id);
  await assertMonthsOpen(tx, companyId, monthsBetween(start, end), "leave");
  await assertNoOverlap(tx, employee.id, start, end);
  const year = Number(start.slice(0, 4));
  await assertWithinBalance(tx, employee, type, year, days, { countPending: !options.approve });
  if (options.approve) {
    await assertNoAttendanceClash(tx, companyId, employee, start, end, input.halfDay);
  }
  const request = await tx.leaveRequest.create({
    data: {
      companyId,
      employeeId: employee.id,
      leaveTypeId: type.id,
      startDate: dateColumn(start),
      endDate: dateColumn(end),
      halfDay: input.halfDay,
      days,
      reason: input.reason ?? null,
      attachmentId: input.attachmentId ?? null,
      requestedById: ctx.user.id,
      status: options.approve ? "APPROVED" : "PENDING",
      ...(options.approve ? { approvedById: ctx.user.id, decidedAt: new Date() } : {}),
    },
  });
  if (options.approve) await syncLeaveBalanceTx(tx, employee.id, type.id, year);
  return { request, type, days };
}

async function loadLeave(ctx: CompanyContext, leaveId: string) {
  const request = await ctx.db.leaveRequest.findUnique({
    where: { id: leaveId },
    include: leaveInclude,
  });
  if (!request) throw new AppError("NOT_FOUND", "Leave request not found.");
  return request;
}

export async function getLeaveRequest(ctx: CompanyContext, leaveId: string) {
  return presentLeave(await loadLeave(ctx, leaveId));
}

export async function listLeaveRequests(ctx: CompanyContext, raw: unknown = {}) {
  const q = listLeaveSchema.parse(raw);
  const take = q.take ?? 50;
  const rows = await ctx.db.leaveRequest.findMany({
    where: {
      ...(q.status ? { status: q.status } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.leaveTypeId ? { leaveTypeId: q.leaveTypeId } : {}),
      ...(q.to ? { startDate: { lte: dateColumn(q.to) } } : {}),
      ...(q.from ? { endDate: { gte: dateColumn(q.from) } } : {}),
    },
    include: leaveInclude,
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items: items.map(presentLeave), nextCursor: hasMore ? items.at(-1)?.id : undefined };
}

/** HR records leave for an employee (optionally approving it at once). */
export async function createLeave(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx, "Only HR can record leave for someone else.");
  const input = createLeaveSchema.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  if (input.approve) {
    assertNotOwnRecord(ctx, employee, "Someone else must approve your own leave.");
  }
  const id = await prisma.$transaction(async (tx) => {
    const { request, type, days } = await createLeaveTx(tx, ctx, employee, input, {
      approve: input.approve,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "LeaveRequest",
        entityId: request.id,
        summary: `${input.approve ? "Recorded approved" : "Recorded"} ${type.name} for ${employee.name}: ${dateOnly(
          request.startDate,
        )} to ${dateOnly(request.endDate)} (${fmtDays(days)})`,
      },
      tx,
    );
    return request.id;
  }, TX_OPTIONS);
  return getLeaveRequest(ctx, id);
}

/** Locks a request and re-reads it inside the transaction. */
async function lockLeave(tx: Tx, ctx: CompanyContext, leaveId: string) {
  await lockRow(tx, "LeaveRequest", leaveId);
  const request = await tx.leaveRequest.findFirst({
    where: { id: leaveId, companyId: ctx.company.id },
    include: { employee: true, leaveType: true },
  });
  if (!request) throw new AppError("NOT_FOUND", "Leave request not found.");
  return request;
}

export async function approveLeave(
  ctx: CompanyContext,
  leaveId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can approve leave.");
  const { note } = approveLeaveSchema.parse(raw);
  const companyId = ctx.company.id;
  await prisma.$transaction(async (tx) => {
    const request = await lockLeave(tx, ctx, leaveId);
    if (request.status !== "PENDING") {
      throw new AppError("CONFLICT", `This request is already ${request.status.toLowerCase()}.`);
    }
    const { employee, leaveType: type } = request;
    assertNotOwnRecord(ctx, employee, "Someone else must approve your own leave.");
    const start = dateOnly(request.startDate);
    const end = dateOnly(request.endDate);
    assertEmployed(employee, start, end);
    // Holidays may have changed since it was asked for.
    const days = await countDays(tx, companyId, {
      startDate: start,
      endDate: end,
      halfDay: request.halfDay,
    });
    await lockEmployeeLeave(tx, employee.id);
    await assertMonthsOpen(tx, companyId, monthsBetween(start, end), "leave");
    const year = Number(start.slice(0, 4));
    await assertWithinBalance(tx, employee, type, year, days, { countPending: false });
    await assertNoAttendanceClash(tx, companyId, employee, start, end, request.halfDay);
    await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        days,
        approvedById: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
    await syncLeaveBalanceTx(tx, employee.id, type.id, year);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "LeaveRequest",
        entityId: request.id,
        summary: `Approved ${type.name} for ${employee.name}: ${start} to ${end} (${fmtDays(days)})`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getLeaveRequest(ctx, leaveId);
}

export async function rejectLeave(
  ctx: CompanyContext,
  leaveId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanManageHr(ctx, "Only HR can turn down leave.");
  const { note } = rejectLeaveSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const request = await lockLeave(tx, ctx, leaveId);
    if (request.status !== "PENDING") {
      throw new AppError("CONFLICT", `This request is already ${request.status.toLowerCase()}.`);
    }
    await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        approvedById: ctx.user.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "LeaveRequest",
        entityId: request.id,
        summary: `Turned down ${request.leaveType.name} for ${request.employee.name} (${dateOnly(
          request.startDate,
        )} to ${dateOnly(request.endDate)}): ${note}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getLeaveRequest(ctx, leaveId);
}

/**
 * Cancels leave. HR cancels waiting or approved leave (approved leave only while
 * its month's payroll is open); employees withdraw their own waiting requests.
 */
export async function cancelLeave(
  ctx: CompanyContext,
  leaveId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const { note } = cancelLeaveSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const request = await lockLeave(tx, ctx, leaveId);
    const own = request.employee.userId === ctx.user.id;
    if (!ctx.can("hr.manage")) {
      if (!own) throw new AppError("FORBIDDEN", "Only HR can cancel someone else's leave.");
      if (request.status !== "PENDING") {
        throw new AppError("CONFLICT", "Ask HR to cancel leave that is already approved.");
      }
    }
    if (request.status !== "PENDING" && request.status !== "APPROVED") {
      throw new AppError("CONFLICT", `This request is already ${request.status.toLowerCase()}.`);
    }
    const start = dateOnly(request.startDate);
    const end = dateOnly(request.endDate);
    if (request.status === "APPROVED") {
      // Approved leave decides pay, so it is someone else's call, as approving it was.
      assertNotOwnRecord(
        ctx,
        request.employee,
        "Someone else must cancel your own approved leave.",
      );
      await assertMonthsOpen(tx, ctx.company.id, monthsBetween(start, end), "leave");
    }
    await tx.leaveRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", decisionNote: note ?? request.decisionNote },
    });
    if (request.status === "APPROVED") {
      await syncLeaveBalanceTx(
        tx,
        request.employeeId,
        request.leaveTypeId,
        Number(start.slice(0, 4)),
      );
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "LeaveRequest",
        entityId: request.id,
        summary: `${own && !ctx.can("hr.manage") ? "Withdrew" : "Cancelled"} ${
          request.status === "APPROVED" ? "approved " : ""
        }${request.leaveType.name} for ${request.employee.name} (${start} to ${end})${
          note ? `: ${note}` : ""
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getLeaveRequest(ctx, leaveId);
}

/** Balances for one employee (default: the year now). */
export async function getLeaveBalances(ctx: CompanyContext, raw: unknown = {}) {
  const q = leaveBalancesSchema.parse(raw);
  if (!q.employeeId) throw new AppError("VALIDATION", "Choose the employee.");
  const employee = await ctx.db.employee.findUnique({ where: { id: q.employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const year = q.year ?? Number(today(ctx).slice(0, 4));
  return {
    employee: { id: employee.id, code: employee.code, name: employee.name },
    year,
    balances: await balancesFor(prisma, employee, year),
  };
}

/** HR sets a year's allowance by hand (e.g. leave carried over), or resets it. */
export async function adjustLeaveBalance(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanManageHr(ctx);
  const input = adjustLeaveBalanceSchema.parse(raw);
  const employee = await ctx.db.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const type = await ctx.db.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type) throw new AppError("NOT_FOUND", "Leave type not found.");
  if (!type.isPaid) {
    throw new AppError("VALIDATION", `${type.name} is unpaid and has no allowance to set.`);
  }
  await prisma.$transaction(async (tx) => {
    const key = {
      employeeId_leaveTypeId_year: {
        employeeId: employee.id,
        leaveTypeId: type.id,
        year: input.year,
      },
    };
    const before = await entitlementFor(tx, employee, type, input.year);
    await tx.leaveBalance.upsert({
      where: key,
      create: {
        employeeId: employee.id,
        leaveTypeId: type.id,
        year: input.year,
        entitled: input.entitled ?? 0,
        adjusted: input.entitled !== null,
        note: input.note ?? null,
      },
      update: { adjusted: input.entitled !== null, note: input.note ?? null },
    });
    if (input.entitled !== null) {
      await tx.leaveBalance.update({ where: key, data: { entitled: input.entitled } });
    }
    await syncLeaveBalanceTx(tx, employee.id, type.id, input.year);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "LeaveBalance",
        entityId: employee.id,
        summary: `${type.name} ${input.year} for ${employee.name}: ${
          input.entitled === null
            ? "back to the default allowance"
            : `allowance set to ${fmtDays(input.entitled)}`
        } (was ${fmtDays(before ?? 0)})${input.note ? ` — ${input.note}` : ""}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getLeaveBalances(ctx, { employeeId: employee.id, year: input.year });
}

/**
 * Re-counts the working days of waiting and approved leave touching a period
 * after holidays or weekly days off change. Leave in months whose payroll is
 * approved keeps its days.
 */
export async function recountLeaveDaysTx(tx: Tx, companyId: string, from: string, to: string) {
  const requests = await tx.leaveRequest.findMany({
    where: {
      companyId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: dateColumn(to) },
      endDate: { gte: dateColumn(from) },
    },
  });
  if (requests.length === 0) return 0;
  const closed = new Set(
    (
      await tx.payrollRun.findMany({
        where: { companyId, status: { not: "DRAFT" } },
        select: { year: true, month: true },
      })
    ).map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`),
  );
  const touched = new Map<string, { employeeId: string; leaveTypeId: string; year: number }>();
  let changed = 0;
  for (const r of requests) {
    const start = dateOnly(r.startDate);
    const end = dateOnly(r.endDate);
    if (monthsBetween(start, end).some((m) => closed.has(m))) continue;
    const calendar = await loadCalendar(companyId, start, end, tx);
    const days = leaveDayCount(calendar, { startDate: start, endDate: end, halfDay: r.halfDay });
    if (r.days.equals(days)) continue;
    await tx.leaveRequest.update({ where: { id: r.id }, data: { days } });
    changed += 1;
    if (r.status === "APPROVED") {
      const year = Number(start.slice(0, 4));
      touched.set(`${r.employeeId}:${r.leaveTypeId}:${year}`, {
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        year,
      });
    }
  }
  for (const t of touched.values()) {
    await syncLeaveBalanceTx(tx, t.employeeId, t.leaveTypeId, t.year);
  }
  return changed;
}

/** Leave covering a day, for the attendance register. */
export async function leaveOnDay(ctx: CompanyContext, day: string) {
  return ctx.db.leaveRequest.findMany({
    where: {
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: dateColumn(day) },
      endDate: { gte: dateColumn(day) },
    },
    include: { leaveType: { select: { id: true, name: true, isPaid: true } } },
  });
}

// =============================================================================
// Employee portal
// =============================================================================

/** The signed-in employee's balances and requests for a year. */
export async function myLeave(ctx: CompanyContext, raw: unknown = {}) {
  const employee = await requireLinkedEmployee(ctx);
  const q = leaveBalancesSchema.parse(raw);
  const year = q.year ?? Number(today(ctx).slice(0, 4));
  const requests = await ctx.db.leaveRequest.findMany({
    where: { employeeId: employee.id, startDate: yearBounds(year) },
    include: leaveInclude,
    orderBy: { startDate: "desc" },
  });
  const types = await ctx.db.leaveType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, isPaid: true },
    orderBy: { name: "asc" },
  });
  return {
    year,
    leaveTypes: types,
    balances: await balancesFor(prisma, employee, year),
    requests: requests.map(presentLeave),
  };
}

/** An employee asks for leave from the portal; HR approves it. */
export async function requestMyLeave(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  const employee = await requireLinkedEmployee(ctx);
  const input = requestLeaveSchema.parse(raw);
  const id = await prisma.$transaction(async (tx) => {
    const { request, type, days } = await createLeaveTx(tx, ctx, employee, input, {
      approve: false,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "LeaveRequest",
        entityId: request.id,
        summary: `${employee.name} asked for ${type.name}: ${dateOnly(request.startDate)} to ${dateOnly(
          request.endDate,
        )} (${fmtDays(days)})`,
      },
      tx,
    );
    return request.id;
  }, TX_OPTIONS);
  return getLeaveRequest(ctx, id);
}

/** An employee withdraws their own waiting request. */
export async function cancelMyLeave(
  ctx: CompanyContext,
  leaveId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  const employee = await linkedEmployee(ctx);
  const request = await ctx.db.leaveRequest.findUnique({ where: { id: leaveId } });
  if (!employee || !request || request.employeeId !== employee.id) {
    throw new AppError("NOT_FOUND", "Leave request not found.");
  }
  return cancelLeave(ctx, leaveId, raw, meta);
}
