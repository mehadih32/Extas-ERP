import { type ExpenseCategory, Prisma } from "@prisma/client";

import { dayRange, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { ZERO } from "@/modules/accounts/balances";
import {
  type CostPeriod,
  costPeriodOf,
  costWindow,
  costYears,
  parseCostPeriod,
} from "@/modules/accounts/cost-periods";
import type { CompanyContext } from "@/modules/auth/context";
import { assertCanSeeSalaries } from "@/modules/hr/access";

/*
 * The expense breakdown under the executive cards, for one month or a whole
 * calendar year:
 *   Salary & payroll        each employee's net pay on the approved payrolls
 *                           for those months (and how much is paid), plus
 *                           money paid in their name under a Salary-group
 *                           expense head, such as a "QC Bill"
 *   Administrative costs    posted expenses per head: rent, utilities,
 *                           marketing… (not production costs, which belong to
 *                           their projects, nor the Salary group, above)
 *   Asset purchases         fixed assets bought in those days, at cost
 *   Vendor summary          suppliers ranked by the money paid to them
 * And one employee's pay, month by month, for a year. Read only: nothing is
 * stored, nothing is posted.
 */

export { costPeriodParam, parseCostPeriod } from "@/modules/accounts/cost-periods";
export type { CostPeriod } from "@/modules/accounts/cost-periods";

/** Production costs (in their projects) and salaries (their own panel) are not running costs. */
const NOT_ADMIN: ExpenseCategory[] = ["PRODUCTION", "RAW_MATERIAL", "SALARY"];
const POSTED = { journalEntryId: { not: null }, voidedAt: null } satisfies Prisma.ExpenseWhereInput;
const LIVE_PAYMENT = {
  OR: [{ journalEntryId: null }, { journalEntry: { isReversed: false } }],
} satisfies Prisma.PaymentWhereInput;

const fixed = (value: Prisma.Decimal.Value | null | undefined) =>
  new Prisma.Decimal(value ?? 0).toFixed(2);
const sumOf = (values: Prisma.Decimal.Value[]) =>
  values.reduce<Prisma.Decimal>((t, v) => t.plus(v), ZERO);

function periodFrom(ctx: CompanyContext, raw: unknown): CostPeriod {
  if (raw === undefined || raw === null || raw === "") {
    return costPeriodOf(localDay(new Date(), ctx.company.timezone));
  }
  const period = parseCostPeriod(raw);
  if (!period) throw new AppError("VALIDATION", "Choose a month or a year.");
  return period;
}

/** The first year anything was entered in the books, for the year list. */
async function firstYear(companyId: string) {
  const first = await prisma.journalEntry.aggregate({
    where: { companyId },
    _min: { date: true },
  });
  return first._min.date ? first._min.date.getUTCFullYear() : null;
}

async function salaries(
  ctx: CompanyContext,
  period: CostPeriod,
  range: ReturnType<typeof dayRange>,
) {
  const companyId = ctx.company.id;
  const [payroll, inTheirName] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; net: Prisma.Decimal; paid: Prisma.Decimal | null }>>`
      SELECT pi."employeeId" AS id, SUM(pi."netPay") AS net,
             SUM(pi."netPay") FILTER (WHERE pi."paymentId" IS NOT NULL) AS paid
      FROM "PayrollItem" pi
      JOIN "PayrollRun" pr ON pr.id = pi."runId"
      WHERE pr."companyId" = ${companyId}
        AND pr.year = ${period.year}
        AND (${period.month}::int IS NULL OR pr.month = ${period.month}::int)
        AND pr.status IN ('APPROVED', 'PAID')
      GROUP BY 1`,
    ctx.db.expense.groupBy({
      by: ["employeeId"],
      where: { ...POSTED, date: { gte: range.start, lt: range.end }, head: { category: "SALARY" } },
      _sum: { amount: true },
    }),
  ]);
  const ids = [
    ...new Set([
      ...payroll.map((r) => r.id),
      ...inTheirName.flatMap((r) => (r.employeeId ? [r.employeeId] : [])),
    ]),
  ];
  const employees = await ctx.db.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, name: true, designation: true },
  });
  const otherOf = new Map(inTheirName.map((r) => [r.employeeId, r._sum.amount ?? ZERO]));
  const payOf = new Map(payroll.map((r) => [r.id, r]));
  const rows = employees
    .map((e) => {
      const pay = payOf.get(e.id);
      const net = new Prisma.Decimal(pay?.net ?? 0);
      const paid = new Prisma.Decimal(pay?.paid ?? 0);
      const other = new Prisma.Decimal(otherOf.get(e.id) ?? 0);
      return { ...e, net, paid, other, total: net.plus(other) };
    })
    .sort((a, b) => b.total.comparedTo(a.total) || a.name.localeCompare(b.name));
  const unnamed = new Prisma.Decimal(otherOf.get(null) ?? 0);
  const net = sumOf(rows.map((r) => r.net));
  const paid = sumOf(rows.map((r) => r.paid));
  const other = sumOf(rows.map((r) => r.other)).plus(unnamed);
  return {
    total: fixed(net.plus(other)),
    /** Net pay on the approved payrolls. */
    netPay: fixed(net),
    /** Of which paid. */
    paid: fixed(paid),
    unpaid: fixed(net.minus(paid)),
    /** Paid under Salary-group expense heads (a QC bill, an incentive). */
    otherPay: fixed(other),
    employees: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      designation: r.designation,
      netPay: fixed(r.net),
      unpaid: fixed(r.net.minus(r.paid)),
      otherPay: fixed(r.other),
      total: fixed(r.total),
    })),
    /** Salary-group expenses with no employee named. */
    unnamed: unnamed.isZero() ? null : fixed(unnamed),
  };
}

async function adminCosts(ctx: CompanyContext, range: ReturnType<typeof dayRange>) {
  const groups = await ctx.db.expense.groupBy({
    by: ["headId"],
    where: {
      ...POSTED,
      date: { gte: range.start, lt: range.end },
      head: { isProductionCost: false, category: { notIn: NOT_ADMIN } },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const heads = await ctx.db.expenseHead.findMany({
    where: { id: { in: groups.map((g) => g.headId) } },
    select: { id: true, name: true, category: true },
  });
  const headOf = new Map(heads.map((h) => [h.id, h]));
  const rows = groups
    .flatMap((g) => {
      const head = headOf.get(g.headId);
      return head ? [{ ...head, amount: g._sum.amount ?? ZERO, count: g._count._all }] : [];
    })
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.name.localeCompare(b.name));
  return {
    total: fixed(sumOf(rows.map((r) => r.amount))),
    count: rows.reduce((t, r) => t + r.count, 0),
    heads: rows.map((r) => ({ ...r, amount: fixed(r.amount) })),
  };
}

async function assetPurchases(ctx: CompanyContext, range: ReturnType<typeof dayRange>) {
  const assets = await ctx.db.fixedAsset.findMany({
    where: { purchaseDate: { gte: range.start, lt: range.end } },
    select: {
      id: true,
      name: true,
      category: true,
      purchaseDate: true,
      purchaseCost: true,
      currentValue: true,
      status: true,
    },
    orderBy: [{ purchaseDate: "desc" }, { id: "asc" }],
  });
  const tz = ctx.company.timezone;
  return {
    total: fixed(sumOf(assets.map((a) => a.purchaseCost))),
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      boughtOn: localDay(a.purchaseDate, tz),
      cost: fixed(a.purchaseCost),
      bookValue: fixed(a.currentValue),
      status: a.status,
    })),
  };
}

async function vendors(ctx: CompanyContext, range: ReturnType<typeof dayRange>) {
  const groups = await ctx.db.payment.groupBy({
    by: ["partyId"],
    where: {
      ...LIVE_PAYMENT,
      direction: "PAID",
      partyId: { not: null },
      paymentDate: { gte: range.start, lt: range.end },
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const parties = await ctx.db.party.findMany({
    where: { id: { in: groups.flatMap((g) => (g.partyId ? [g.partyId] : [])) } },
    select: { id: true, code: true, name: true, kind: true },
  });
  const partyOf = new Map(parties.map((p) => [p.id, p]));
  const rows = groups
    .flatMap((g) => {
      const party = g.partyId ? partyOf.get(g.partyId) : undefined;
      return party ? [{ ...party, amount: g._sum.amount ?? ZERO, payments: g._count._all }] : [];
    })
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.name.localeCompare(b.name));
  return {
    total: fixed(sumOf(rows.map((r) => r.amount))),
    suppliers: rows.map((r) => ({ ...r, amount: fixed(r.amount) })),
  };
}

/** The four panels for "?costs=2026-10" (a month) or "?costs=2026" (a year); this month by default. */
export async function getExpenseBreakdown(ctx: CompanyContext, raw?: unknown) {
  const period = periodFrom(ctx, raw);
  const window = costWindow(period);
  const range = dayRange(window.from, window.to, ctx.company.timezone);
  const thisYear = Number(localDay(new Date(), ctx.company.timezone).slice(0, 4));
  const [salary, admin, assets, paid, first] = await Promise.all([
    salaries(ctx, period, range),
    adminCosts(ctx, range),
    assetPurchases(ctx, range),
    vendors(ctx, range),
    firstYear(ctx.company.id),
  ]);
  const years = costYears(
    Math.min(first ?? thisYear, period.year),
    Math.max(thisYear, period.year),
  );
  return {
    period: { ...period, ...window, years },
    salaries: salary,
    adminCosts: admin,
    assets,
    vendors: paid,
    can: {
      recordAsset: ctx.can("accounts.manage"),
      openParty: ctx.can("parties.view"),
    },
  };
}

export type ExpenseBreakdown = Awaited<ReturnType<typeof getExpenseBreakdown>>;

const DEDUCTIONS = [
  "unpaidLeaveDeduction",
  "advanceDeduction",
  "taxDeduction",
  "otherDeductions",
] as const;

/**
 * One employee's pay for a calendar year, month by month: basic, allowances,
 * overtime, bonus, deductions and net pay from each approved payroll (with
 * when it was paid), and what was paid in their name under each Salary-group
 * expense head (a QC bill), one column per head.
 */
export async function getEmployeePay(ctx: CompanyContext, employeeId: string, rawYear?: unknown) {
  assertCanSeeSalaries(ctx);
  const tz = ctx.company.timezone;
  const thisYear = Number(localDay(new Date(), tz).slice(0, 4));
  const year =
    rawYear === undefined || rawYear === null || rawYear === "" ? thisYear : Number(rawYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new AppError("VALIDATION", "Choose a year.");
  }
  const employee = await ctx.db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      code: true,
      name: true,
      designation: true,
      department: true,
      status: true,
    },
  });
  if (!employee) throw new AppError("NOT_FOUND", "Employee not found.");
  const window = costWindow({ year, month: null });
  const range = dayRange(window.from, window.to, tz);
  const [items, expenses, first] = await Promise.all([
    prisma.payrollItem.findMany({
      where: {
        employeeId: employee.id,
        run: { companyId: ctx.company.id, year, status: { in: ["APPROVED", "PAID"] } },
      },
      select: {
        id: true,
        basic: true,
        allowances: true,
        overtime: true,
        bonus: true,
        unpaidLeaveDeduction: true,
        advanceDeduction: true,
        taxDeduction: true,
        otherDeductions: true,
        netPay: true,
        run: { select: { id: true, month: true, status: true } },
        payment: { select: { date: true, number: true } },
      },
    }),
    ctx.db.expense.findMany({
      where: {
        ...POSTED,
        employeeId: employee.id,
        date: { gte: range.start, lt: range.end },
        head: { category: "SALARY" },
      },
      select: { date: true, amount: true, head: { select: { id: true, name: true } } },
    }),
    firstYear(ctx.company.id),
  ]);

  const heads = [...new Map(expenses.map((e) => [e.head.id, e.head])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const months = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((month) => {
    const item = items.find((i) => i.run.month === month) ?? null;
    const inMonth = expenses.filter((e) => Number(localDay(e.date, tz).slice(5, 7)) === month);
    if (!item && inMonth.length === 0) return [];
    const other = heads.map((h) =>
      sumOf(inMonth.filter((e) => e.head.id === h.id).map((e) => e.amount)),
    );
    const deductions = item ? sumOf(DEDUCTIONS.map((k) => item[k])) : ZERO;
    const net = item?.netPay ?? ZERO;
    return [
      {
        month,
        payroll: item
          ? {
              runId: item.run.id,
              itemId: item.id,
              basic: fixed(item.basic),
              allowances: fixed(item.allowances),
              overtime: fixed(item.overtime),
              bonus: fixed(item.bonus),
              deductions: fixed(deductions),
              netPay: fixed(net),
              paidOn: item.payment ? localDay(item.payment.date, tz) : null,
            }
          : null,
        other: other.map(fixed),
        total: fixed(net.plus(sumOf(other))),
      },
    ];
  });
  const column = (pick: (i: (typeof items)[number]) => Prisma.Decimal) =>
    fixed(sumOf(items.map(pick)));
  const otherTotals = heads.map((h) =>
    sumOf(expenses.filter((e) => e.head.id === h.id).map((e) => e.amount)),
  );
  const net = sumOf(items.map((i) => i.netPay));
  return {
    employee,
    year,
    years: costYears(Math.min(first ?? thisYear, year), Math.max(thisYear, year)),
    heads,
    months,
    totals: {
      basic: column((i) => i.basic),
      allowances: column((i) => i.allowances),
      overtime: column((i) => i.overtime),
      bonus: column((i) => i.bonus),
      deductions: column((i) => sumOf(DEDUCTIONS.map((k) => i[k]))),
      netPay: fixed(net),
      unpaid: fixed(sumOf(items.filter((i) => !i.payment).map((i) => i.netPay))),
      other: otherTotals.map(fixed),
      otherPay: fixed(sumOf(otherTotals)),
      total: fixed(net.plus(sumOf(otherTotals))),
    },
    can: {
      openProfile: ctx.can("hr.view") || ctx.can("hr.manage"),
      openPayslip: true,
    },
  };
}

export type EmployeePay = Awaited<ReturnType<typeof getEmployeePay>>;
