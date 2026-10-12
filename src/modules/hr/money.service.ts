import { Prisma } from "@prisma/client";
import { z } from "zod";

import { addDays, DATE_ONLY, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { addMonths, monthEnd } from "@/modules/accounts/periods";
import type { CompanyContext } from "@/modules/auth/context";
import { monthLabel } from "@/modules/hr/calendar";
import { latestPhotos } from "@/modules/hr/directory.service";

/*
 * HR > Money (hr.money.view, Super Admin unless given): how much went to staff
 * as salary, conveyance, bonus and overtime in a period, who got it, and for
 * each person every month or trip with its purpose.
 *
 * Salary, bonus and overtime come from approved payrolls (drafts are not
 * money yet) and count on the last day of their month, so each month falls in
 * exactly one period. Salary is what the days worked earned: basic plus
 * allowances, less the absence deduction. Conveyance is the approved trips
 * claimed (the amount approved), counted on the day of the trip. Every total
 * is added up in the database, a handful of grouped queries for the page.
 */

export const MONEY_RANGES = ["week", "month", "6m", "year", "all", "custom"] as const;
export type MoneyRange = (typeof MONEY_RANGES)[number];

export const MONEY_KINDS = ["salary", "conveyance", "bonus", "overtime"] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

const day = z.string().regex(DATE_ONLY);

/** The period, from the address: unknown values fall back to the last month. */
export const moneyQuery = z.object({
  range: z.enum(MONEY_RANGES).catch("month").default("month"),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
});

const breakdownQuery = moneyQuery.extend({
  kind: z.enum(MONEY_KINDS),
  employeeId: z.string().min(1).max(64),
});

export type MoneyPeriod = {
  range: MoneyRange;
  /** First day counted, or null for everything up to `to`. */
  from: string | null;
  /** Last day counted (today, or the chosen day). */
  to: string;
};

/** The days a range covers, ending today (a custom range keeps its own days). */
export function moneyPeriod(today: string, raw: unknown = {}): MoneyPeriod {
  const q = moneyQuery.parse(raw ?? {});
  switch (q.range) {
    case "week":
      return { range: "week", from: addDays(today, -6), to: today };
    case "6m":
      return { range: "6m", from: addDays(addMonths(today, -6), 1), to: today };
    case "year":
      return { range: "year", from: addDays(addMonths(today, -12), 1), to: today };
    case "all":
      return { range: "all", from: null, to: today };
    case "custom":
      if (q.from && q.to && q.from <= q.to) return { range: "custom", from: q.from, to: q.to };
      break;
  }
  return { range: "month", from: addDays(addMonths(today, -1), 1), to: today };
}

const ym = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { y, m };
};

/**
 * Approved payrolls whose month ends inside the period: from the month of the
 * first day (its end is never before it) to the last month that has ended by
 * the last day.
 */
export function payrollMonths(period: MoneyPeriod): { first: string | null; last: string } | null {
  const last =
    monthEnd(period.to) === period.to
      ? period.to.slice(0, 7)
      : addMonths(`${period.to.slice(0, 7)}-01`, -1).slice(0, 7);
  const first = period.from ? period.from.slice(0, 7) : null;
  if (first && first > last) return null;
  return { first, last };
}

function runWhere(companyId: string, period: MoneyPeriod): Prisma.PayrollRunWhereInput | null {
  const months = payrollMonths(period);
  if (!months) return null;
  const last = ym(months.last);
  const bounds: Prisma.PayrollRunWhereInput[] = [
    { OR: [{ year: { lt: last.y } }, { year: last.y, month: { lte: last.m } }] },
  ];
  if (months.first) {
    const first = ym(months.first);
    bounds.push({ OR: [{ year: { gt: first.y } }, { year: first.y, month: { gte: first.m } }] });
  }
  return { companyId, status: { in: ["APPROVED", "PAID"] }, AND: bounds };
}

/** Approved trips (the amount approved, else the amount asked) per person in the period. */
async function conveyanceByPerson(companyId: string, period: MoneyPeriod) {
  const from = period.from ? Prisma.sql`AND "date" >= ${period.from}::date` : Prisma.empty;
  return prisma.$queryRaw<Array<{ employeeId: string; n: number; total: Prisma.Decimal }>>`
    SELECT "employeeId", COUNT(*)::int AS n, SUM(COALESCE("approvedAmount", "amount")) AS total
    FROM "StaffClaim"
    WHERE "companyId" = ${companyId}
      AND "kind" = 'CONVEYANCE' AND "status" = 'APPROVED'
      AND "date" <= ${period.to}::date ${from}
    GROUP BY "employeeId"`;
}

const ZERO = new Prisma.Decimal(0);
const dec = (v: Prisma.Decimal | null | undefined) => v ?? ZERO;

function assertCanSee(ctx: CompanyContext) {
  if (!ctx.can("hr.money.view")) {
    throw new AppError("FORBIDDEN", "Only people allowed to see staff money can open this.");
  }
}

type Row = { employeeId: string; amount: Prisma.Decimal; count: number; hours?: Prisma.Decimal };

/** The four totals, and for each who got it (largest first), for the period. */
export async function getMoneySummary(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSee(ctx);
  const today = localDay(new Date(), ctx.company.timezone);
  const period = moneyPeriod(today, raw);
  const runs = runWhere(ctx.company.id, period);
  const [salary, bonus, overtime, conveyance] = await Promise.all([
    runs
      ? prisma.payrollItem.groupBy({
          by: ["employeeId"],
          where: { run: runs },
          _sum: { basic: true, allowances: true, unpaidLeaveDeduction: true },
          _count: { _all: true },
        })
      : [],
    runs
      ? prisma.payrollItem.groupBy({
          by: ["employeeId"],
          where: { run: runs, bonus: { gt: 0 } },
          _sum: { bonus: true },
          _count: { _all: true },
        })
      : [],
    runs
      ? prisma.payrollItem.groupBy({
          by: ["employeeId"],
          where: { run: runs, overtime: { gt: 0 } },
          _sum: { overtime: true, overtimeHours: true },
          _count: { _all: true },
        })
      : [],
    conveyanceByPerson(ctx.company.id, period),
  ]);

  const rows: Record<MoneyKind, Row[]> = {
    salary: salary.map((g) => ({
      employeeId: g.employeeId,
      amount: dec(g._sum.basic)
        .plus(dec(g._sum.allowances))
        .minus(dec(g._sum.unpaidLeaveDeduction)),
      count: g._count._all,
    })),
    conveyance: conveyance.map((g) => ({
      employeeId: g.employeeId,
      amount: new Prisma.Decimal(g.total),
      count: g.n,
    })),
    bonus: bonus.map((g) => ({
      employeeId: g.employeeId,
      amount: dec(g._sum.bonus),
      count: g._count._all,
    })),
    overtime: overtime.map((g) => ({
      employeeId: g.employeeId,
      amount: dec(g._sum.overtime),
      count: g._count._all,
      hours: dec(g._sum.overtimeHours),
    })),
  };

  const ids = [...new Set(MONEY_KINDS.flatMap((k) => rows[k].map((r) => r.employeeId)))];
  const [people, photos] = await Promise.all([
    ids.length
      ? prisma.employee.findMany({
          where: { companyId: ctx.company.id, id: { in: ids } },
          select: { id: true, code: true, name: true, designation: true, department: true },
        })
      : [],
    latestPhotos(ctx, ids),
  ]);
  const byId = new Map(people.map((p) => [p.id, { ...p, photoId: photos.get(p.id) ?? null }]));

  const kind = (k: MoneyKind) => {
    const list = rows[k]
      .filter((r) => byId.has(r.employeeId) && !r.amount.isZero())
      .sort(
        (a, b) =>
          b.amount.comparedTo(a.amount) ||
          byId.get(a.employeeId)!.name.localeCompare(byId.get(b.employeeId)!.name),
      )
      .map((r) => ({
        employee: byId.get(r.employeeId)!,
        amount: r.amount.toFixed(2),
        /** Payroll months, or trips for conveyance. */
        count: r.count,
        /** Overtime hours paid, for overtime. */
        hours: r.hours ? r.hours.toFixed(2) : null,
      }));
    return {
      total: list.reduce((t, r) => t.plus(r.amount), ZERO).toFixed(2),
      /** Payroll lines, or trips for conveyance. */
      count: list.reduce((t, r) => t + r.count, 0),
      /** Overtime hours paid in all, for overtime. */
      hours: k === "overtime" ? list.reduce((t, r) => t.plus(r.hours ?? 0), ZERO).toFixed(2) : null,
      people: list,
    };
  };

  return {
    today,
    period,
    months: payrollMonths(period),
    kinds: {
      salary: kind("salary"),
      conveyance: kind("conveyance"),
      bonus: kind("bonus"),
      overtime: kind("overtime"),
    },
  };
}

export type MoneySummary = Awaited<ReturnType<typeof getMoneySummary>>;

type LineState = { label: string; tone: "done" | "warn" | "open" };

export type MoneyLine = {
  id: string;
  /** The day it counts on (a payroll month's last day, or the trip's day). */
  date: string;
  /** "October 2026", or the claim number for a trip. */
  title: string;
  amount: string;
  /** What it was for. */
  purpose: string | null;
  /** What the month's pay was made of, or the amount asked for a cut trip. */
  details: Array<{ label: string; amount: string; minus?: boolean; note?: string | null }>;
  state: LineState | null;
  /** Overtime: the approved days of that month. */
  days: Array<{ date: string; minutes: number; dayOff: boolean; reason: string | null }>;
  /** Where to see it in full: the payslip of that month (or the salary it was paid back with). */
  payslip: { runId: string; itemId: string } | null;
};

const paidState = (net: Prisma.Decimal, paid: Prisma.Decimal): LineState =>
  paid.gte(net) && net.gt(0)
    ? { label: "Paid", tone: "done" }
    : paid.gt(0)
      ? { label: "Part paid", tone: "warn" }
      : { label: "To be paid", tone: "open" };

const money = (v: Prisma.Decimal) => v.toFixed(2);

/** One person's months or trips behind a total, newest first. */
export async function getMoneyBreakdown(ctx: CompanyContext, raw: unknown) {
  assertCanSee(ctx);
  const q = breakdownQuery.parse(raw);
  const today = localDay(new Date(), ctx.company.timezone);
  const period = moneyPeriod(today, q);
  const employee = await prisma.employee.findFirst({
    where: { id: q.employeeId, companyId: ctx.company.id },
    select: { id: true, code: true, name: true, designation: true, department: true },
  });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const photos = await latestPhotos(ctx, [employee.id]);
  const lines =
    q.kind === "conveyance"
      ? await tripLines(ctx.company.id, employee.id, period)
      : await payrollLines(ctx.company.id, employee.id, period, q.kind);
  return {
    period,
    kind: q.kind,
    employee: { ...employee, photoId: photos.get(employee.id) ?? null },
    total: lines.reduce((t, l) => t.plus(l.amount), ZERO).toFixed(2),
    lines,
  };
}

export type MoneyBreakdown = Awaited<ReturnType<typeof getMoneyBreakdown>>;

async function payrollLines(
  companyId: string,
  employeeId: string,
  period: MoneyPeriod,
  kind: Exclude<MoneyKind, "conveyance">,
): Promise<MoneyLine[]> {
  const runs = runWhere(companyId, period);
  if (!runs) return [];
  const items = await prisma.payrollItem.findMany({
    where: {
      employeeId,
      run: runs,
      ...(kind === "bonus" ? { bonus: { gt: 0 } } : {}),
      ...(kind === "overtime" ? { overtime: { gt: 0 } } : {}),
    },
    include: { run: { select: { id: true, year: true, month: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
  });
  const monthOf = (i: (typeof items)[number]) =>
    `${i.run.year}-${String(i.run.month).padStart(2, "0")}`;

  // Overtime: the approved days of those months, in one query.
  const days = new Map<string, MoneyLine["days"]>();
  if (kind === "overtime" && items.length > 0) {
    const months = items.map(monthOf).sort();
    const entries = await prisma.overtimeEntry.findMany({
      where: {
        employeeId,
        status: "APPROVED",
        date: {
          gte: new Date(`${months[0]}-01T00:00:00Z`),
          lte: new Date(`${monthEnd(`${months.at(-1)}-01`)}T00:00:00Z`),
        },
      },
      select: { date: true, approvedMinutes: true, basis: true, reason: true },
      orderBy: { date: "asc" },
    });
    for (const e of entries) {
      const date = e.date.toISOString().slice(0, 10);
      const list = days.get(date.slice(0, 7)) ?? [];
      list.push({
        date,
        minutes: e.approvedMinutes ?? 0,
        dayOff: e.basis === "DAY_OFF",
        reason: e.reason,
      });
      days.set(date.slice(0, 7), list);
    }
  }

  return items.map((i) => {
    const month = monthOf(i);
    const base = {
      id: i.id,
      date: monthEnd(`${month}-01`),
      title: monthLabel(month),
      state: paidState(i.netPay, i.paidAmount),
      days: [] as MoneyLine["days"],
      payslip: { runId: i.run.id, itemId: i.id },
    };
    if (kind === "bonus") {
      return {
        ...base,
        amount: money(i.bonus),
        purpose: i.note ?? `Bonus with the ${monthLabel(month)} salary`,
        details: [],
      };
    }
    if (kind === "overtime") {
      return {
        ...base,
        amount: money(i.overtime),
        purpose: `${i.overtimeHours.toFixed(2).replace(/\.?0+$/, "")} hours of overtime${i.overtimeEdited ? " (hours set on the payroll)" : ""}`,
        details: [],
        days: days.get(month) ?? [],
      };
    }
    const details: MoneyLine["details"] = [{ label: "Basic", amount: money(i.basic) }];
    if (i.allowances.gt(0)) details.push({ label: "Allowances", amount: money(i.allowances) });
    if (i.unpaidLeaveDeduction.gt(0)) {
      details.push({ label: "Absence", amount: money(i.unpaidLeaveDeduction), minus: true });
    }
    return {
      ...base,
      amount: money(i.basic.plus(i.allowances).minus(i.unpaidLeaveDeduction)),
      purpose: `${i.presentDays.toString()} of ${i.workingDays} working days present${i.note ? ` · ${i.note}` : ""}`,
      details,
    };
  });
}

/** The most trips one person's list shows; the total still counts them all. */
const TRIP_LIMIT = 500;

async function tripLines(
  companyId: string,
  employeeId: string,
  period: MoneyPeriod,
): Promise<MoneyLine[]> {
  const claims = await prisma.staffClaim.findMany({
    where: {
      companyId,
      employeeId,
      kind: "CONVEYANCE",
      status: "APPROVED",
      date: {
        lte: new Date(`${period.to}T00:00:00Z`),
        ...(period.from ? { gte: new Date(`${period.from}T00:00:00Z`) } : {}),
      },
    },
    select: {
      id: true,
      number: true,
      date: true,
      amount: true,
      approvedAmount: true,
      purpose: true,
      fromPlace: true,
      toPlace: true,
      reason: true,
      paidAt: true,
      payrollItemId: true,
      payrollItem: { select: { runId: true } },
    },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: TRIP_LIMIT,
  });
  return claims.map((c) => {
    const approved = c.approvedAmount ?? c.amount;
    const route = c.fromPlace && c.toPlace ? `${c.fromPlace} to ${c.toPlace}` : null;
    const details: MoneyLine["details"] = approved.lt(c.amount)
      ? [{ label: "Asked", amount: money(c.amount), note: c.reason }]
      : [];
    return {
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      title: c.number,
      amount: money(approved),
      purpose: [route, c.purpose].filter(Boolean).join(" · ") || null,
      details,
      state: c.paidAt
        ? { label: "Paid back", tone: "done" as const }
        : c.payrollItemId
          ? { label: "With the salary", tone: "done" as const }
          : { label: "To be paid back", tone: "open" as const },
      days: [],
      payslip:
        c.payrollItemId && c.payrollItem
          ? { runId: c.payrollItem.runId, itemId: c.payrollItemId }
          : null,
    };
  });
}
