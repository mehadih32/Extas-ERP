import { type AccountSubType, type AccountType, Prisma } from "@prisma/client";

import { localDay, nextDay, startOfDayInZone } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import {
  accountTotals,
  type DateRange,
  money,
  type Totals,
  ZERO,
} from "@/modules/accounts/balances";
import { CASH_SUBTYPES, naturalBalance } from "@/modules/accounts/chart";
import { CONTROL_ACCOUNTS, ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  addDays,
  financialYearStart,
  monthStart,
  monthsBetween,
  resolvePeriod,
} from "@/modules/accounts/periods";
import { asOfSchema, profitAndLossSchema } from "@/modules/accounts/schemas";
import { billsOutOfStep } from "@/modules/accounts/supplier-settlement";
import type { CompanyContext } from "@/modules/auth/context";

/*
 * Financial statements straight from the journal, so they always agree with
 * every ledger:
 *   Profit & loss   Sales - Cost of goods sold = Gross profit;
 *                   Gross profit + Other income - Expenses = Net profit
 *   Balance sheet   Assets = Liabilities + Equity (equity includes the profit
 *                   kept in the business, split into earlier years and this year)
 *   Trial balance   every account's balance on its debit or credit side
 *   Books check     the ledgers agree with the stock, asset, loan, advance and
 *                   payroll registers
 * Periods are calendar days in company time; reversed entries cancel out.
 */

type AccountInfo = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subType: AccountSubType;
  isActive: boolean;
};

type ReportLine = { accountId: string; code: string; name: string; amount: string };

async function loadAccounts(companyId: string): Promise<AccountInfo[]> {
  await ensureControlAccounts(companyId);
  return prisma.ledgerAccount.findMany({
    where: { companyId },
    select: { id: true, code: true, name: true, type: true, subType: true, isActive: true },
    orderBy: { code: "asc" },
  });
}

/** Balance in the account's natural direction. */
function natural(account: AccountInfo, totals: Map<string, Totals>) {
  const t = totals.get(account.id);
  return t ? naturalBalance(account.type, t.debit, t.credit) : ZERO;
}

/** Non-zero lines for the accounts that pass `pick`, with their total. */
function section(
  accounts: AccountInfo[],
  totals: Map<string, Totals>,
  pick: (a: AccountInfo) => boolean,
  sign = 1,
) {
  let total = ZERO;
  const lines: ReportLine[] = [];
  for (const a of accounts) {
    if (!pick(a)) continue;
    const amount = natural(a, totals).times(sign);
    if (amount.isZero()) continue;
    total = total.plus(amount);
    lines.push({ accountId: a.id, code: a.code, name: a.name, amount: amount.toFixed(2) });
  }
  return { lines, total };
}

const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.isZero() ? null : part.dividedBy(whole).times(100).toDecimalPlaces(1).toFixed(1);

const EXPENSE_GROUPS: Array<{ key: string; label: string; subTypes: AccountSubType[] }> = [
  {
    key: "OPERATING",
    label: "Operating expenses",
    subTypes: ["OPERATING_EXPENSE", "PAYROLL_EXPENSE", "MARKETING_EXPENSE", "COURIER_EXPENSE"],
  },
  { key: "LOSSES", label: "Production & inventory losses", subTypes: ["INVENTORY_LOSS"] },
  { key: "FINANCE", label: "Finance costs", subTypes: ["FINANCE_COST"] },
];

/** The five P&L figures for a set of account totals. */
function profitFigures(accounts: AccountInfo[], totals: Map<string, Totals>) {
  const revenue = section(accounts, totals, (a) => a.subType === "SALES");
  const costOfSales = section(accounts, totals, (a) => a.subType === "COGS");
  const otherIncome = section(
    accounts,
    totals,
    (a) => a.type === "INCOME" && a.subType !== "SALES",
  );
  const expenseGroups = EXPENSE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    ...section(accounts, totals, (a) => a.type === "EXPENSE" && g.subTypes.includes(a.subType)),
  }));
  // Any other expense account (added later) still counts.
  const known = new Set<AccountSubType>(["COGS", ...EXPENSE_GROUPS.flatMap((g) => g.subTypes)]);
  const rest = section(accounts, totals, (a) => a.type === "EXPENSE" && !known.has(a.subType));
  if (rest.lines.length > 0) expenseGroups.push({ key: "OTHER", label: "Other expenses", ...rest });
  const expenses = expenseGroups.reduce((t, g) => t.plus(g.total), ZERO);
  const grossProfit = revenue.total.minus(costOfSales.total);
  const netProfit = grossProfit.plus(otherIncome.total).minus(expenses);
  return { revenue, costOfSales, otherIncome, expenseGroups, expenses, grossProfit, netProfit };
}

/** Net profit over a range (income - expenses), straight from the journal. */
export async function netProfitFor(companyId: string, range: DateRange) {
  // Income adds (credit - debit) and expenses subtract (debit - credit): both are credit - debit.
  const [row] = await prisma.$queryRaw<Array<{ profit: Prisma.Decimal | null }>>`
    SELECT SUM(jl.credit - jl.debit) AS profit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId}
      AND la.type IN ('INCOME'::"AccountType", 'EXPENSE'::"AccountType")
      ${range.start ? Prisma.sql`AND je.date >= ${range.start}` : Prisma.empty}
      ${range.end ? Prisma.sql`AND je.date < ${range.end}` : Prisma.empty}`;
  return new Prisma.Decimal(row?.profit ?? 0);
}

/** Debit / credit per account per local calendar month ("2026-07"). */
async function monthlyTotals(companyId: string, range: DateRange, timeZone: string) {
  const rows = await prisma.$queryRaw<
    Array<{ month: string; accountId: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>
  >`
    SELECT to_char((je.date AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM') AS month,
           jl."accountId", SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId}
      ${range.start ? Prisma.sql`AND je.date >= ${range.start}` : Prisma.empty}
      ${range.end ? Prisma.sql`AND je.date < ${range.end}` : Prisma.empty}
    GROUP BY 1, 2`;
  const byMonth = new Map<string, Map<string, Totals>>();
  for (const r of rows) {
    const month = byMonth.get(r.month) ?? new Map<string, Totals>();
    month.set(r.accountId, {
      debit: new Prisma.Decimal(r.debit),
      credit: new Prisma.Decimal(r.credit),
    });
    byMonth.set(r.month, month);
  }
  return byMonth;
}

function companyHeader(ctx: CompanyContext) {
  const c = ctx.company;
  return {
    name: c.name,
    legalName: c.legalName,
    address: c.address,
    phone: c.phone,
    email: c.email,
    logoUrl: c.logoUrl,
    currency: c.currency,
  };
}

/** End of a calendar day in company time (exclusive bound). */
function endOfDay(ctx: CompanyContext, day: string) {
  return startOfDayInZone(nextDay(day), ctx.company.timezone);
}

function today(ctx: CompanyContext) {
  return localDay(new Date(), ctx.company.timezone);
}

// =============================================================================
// Profit & loss
// =============================================================================

/** Automatic profit and loss for a period (this month by default), optionally month by month. */
export async function getProfitAndLoss(ctx: CompanyContext, raw: unknown = {}) {
  const q = profitAndLossSchema.parse(raw);
  const period = resolvePeriod(q, ctx.company);
  const companyId = ctx.company.id;
  const accounts = await loadAccounts(companyId);
  const totals = await accountTotals(companyId, { start: period.start, end: period.end });
  const f = profitFigures(accounts, totals);

  let months;
  if (q.byMonth) {
    const byMonth = await monthlyTotals(
      companyId,
      { start: period.start, end: period.end },
      ctx.company.timezone,
    );
    months = monthsBetween(period.from, period.to).map((month) => {
      const m = profitFigures(accounts, byMonth.get(month) ?? new Map());
      return {
        month,
        revenue: m.revenue.total.toFixed(2),
        costOfSales: m.costOfSales.total.toFixed(2),
        grossProfit: m.grossProfit.toFixed(2),
        otherIncome: m.otherIncome.total.toFixed(2),
        expenses: m.expenses.toFixed(2),
        netProfit: m.netProfit.toFixed(2),
      };
    });
  }

  return {
    company: companyHeader(ctx),
    period: { period: period.period, from: period.from, to: period.to },
    revenue: { lines: f.revenue.lines, total: f.revenue.total.toFixed(2) },
    costOfSales: { lines: f.costOfSales.lines, total: f.costOfSales.total.toFixed(2) },
    grossProfit: f.grossProfit.toFixed(2),
    grossMarginPct: pct(f.grossProfit, f.revenue.total),
    otherIncome: { lines: f.otherIncome.lines, total: f.otherIncome.total.toFixed(2) },
    expenses: {
      groups: f.expenseGroups.map((g) => ({
        key: g.key,
        label: g.label,
        lines: g.lines,
        total: g.total.toFixed(2),
      })),
      total: f.expenses.toFixed(2),
    },
    netProfit: f.netProfit.toFixed(2),
    netMarginPct: pct(f.netProfit, f.revenue.total),
    ...(months ? { months } : {}),
  };
}

// =============================================================================
// Balance sheet and trial balance
// =============================================================================

const CURRENT_LIABILITIES: AccountSubType[] = [
  "ACCOUNTS_PAYABLE",
  "CUSTOMER_ADVANCE",
  "OTHER_LIABILITY",
];

/** Assets, liabilities and equity at the end of a day (default: today). */
export async function getBalanceSheet(ctx: CompanyContext, raw: unknown = {}) {
  const q = asOfSchema.parse(raw);
  const asOf = q.asOf ?? today(ctx);
  const companyId = ctx.company.id;
  const end = endOfDay(ctx, asOf);
  const accounts = await loadAccounts(companyId);
  const totals = await accountTotals(companyId, { end });

  const fixedSubTypes: AccountSubType[] = ["FIXED_ASSET", "ACCUMULATED_DEPRECIATION"];
  const currentAssets = section(
    accounts,
    totals,
    (a) => a.type === "ASSET" && !fixedSubTypes.includes(a.subType),
  );
  const fixedCost = section(accounts, totals, (a) => a.subType === "FIXED_ASSET");
  // Accumulated depreciation is a credit balance on an asset account: shown as a positive deduction.
  const depreciation = section(
    accounts,
    totals,
    (a) => a.subType === "ACCUMULATED_DEPRECIATION",
    -1,
  );
  const fixedNet = fixedCost.total.minus(depreciation.total);
  const totalAssets = currentAssets.total.plus(fixedNet);

  const currentLiabilities = section(
    accounts,
    totals,
    (a) => a.type === "LIABILITY" && CURRENT_LIABILITIES.includes(a.subType),
  );
  const loans = section(
    accounts,
    totals,
    (a) => a.type === "LIABILITY" && !CURRENT_LIABILITIES.includes(a.subType),
  );
  const totalLiabilities = currentLiabilities.total.plus(loans.total);

  // Profit kept in the business: before this financial year, and this year so far.
  const fyStart = financialYearStart(asOf, ctx.company.fiscalYearStartMonth);
  const fyStartInstant = startOfDayInZone(fyStart, ctx.company.timezone);
  const earlierProfit = await netProfitFor(companyId, { end: fyStartInstant });
  const yearProfit = await netProfitFor(companyId, { start: fyStartInstant, end });
  const equityAccounts = section(accounts, totals, (a) => a.type === "EQUITY");
  const equityLines = [
    ...equityAccounts.lines,
    ...(earlierProfit.isZero()
      ? []
      : [
          {
            accountId: null,
            code: null,
            name: "Retained earnings (earlier years)",
            amount: earlierProfit.toFixed(2),
          },
        ]),
    {
      accountId: null,
      code: null,
      name: `Profit this financial year (from ${fyStart})`,
      amount: yearProfit.toFixed(2),
    },
  ];
  const totalEquity = equityAccounts.total.plus(earlierProfit).plus(yearProfit);
  const difference = totalAssets.minus(totalLiabilities).minus(totalEquity);

  return {
    company: companyHeader(ctx),
    asOf,
    assets: {
      current: { lines: currentAssets.lines, total: currentAssets.total.toFixed(2) },
      fixed: {
        lines: fixedCost.lines,
        cost: fixedCost.total.toFixed(2),
        accumulatedDepreciation: depreciation.total.toFixed(2),
        netBookValue: fixedNet.toFixed(2),
      },
      total: totalAssets.toFixed(2),
    },
    liabilities: {
      current: { lines: currentLiabilities.lines, total: currentLiabilities.total.toFixed(2) },
      loansAndInvestors: { lines: loans.lines, total: loans.total.toFixed(2) },
      total: totalLiabilities.toFixed(2),
    },
    equity: { lines: equityLines, total: totalEquity.toFixed(2) },
    totalLiabilitiesAndEquity: totalLiabilities.plus(totalEquity).toFixed(2),
    balanced: difference.isZero(),
    difference: difference.toFixed(2),
  };
}

/** Every account's balance at the end of a day, on its debit or credit side. */
export async function getTrialBalance(ctx: CompanyContext, raw: unknown = {}) {
  const q = asOfSchema.parse(raw);
  const asOf = q.asOf ?? today(ctx);
  const companyId = ctx.company.id;
  const accounts = await loadAccounts(companyId);
  const totals = await accountTotals(companyId, { end: endOfDay(ctx, asOf) });
  let debit = ZERO;
  let credit = ZERO;
  const lines = accounts.flatMap((a) => {
    const t = totals.get(a.id);
    if (!t) return [];
    const balance = t.debit.minus(t.credit);
    if (balance.isZero()) return [];
    if (balance.gt(0)) debit = debit.plus(balance);
    else credit = credit.plus(balance.neg());
    return [
      {
        accountId: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        debit: balance.gt(0) ? balance.toFixed(2) : "0.00",
        credit: balance.lt(0) ? balance.neg().toFixed(2) : "0.00",
      },
    ];
  });
  return {
    company: companyHeader(ctx),
    asOf,
    lines,
    totals: { debit: debit.toFixed(2), credit: credit.toFixed(2) },
    balanced: debit.equals(credit),
  };
}

// =============================================================================
// Overview (dashboard money cards)
// =============================================================================

/** Stock on hand valued at each SKU's average cost (A and B grade). */
async function stockValuation(companyId: string) {
  const [row] = await prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
    SELECT SUM(sb.quantity * pv."avgCost") AS value
    FROM "StockBalance" sb
    JOIN "ProductVariant" pv ON pv.id = sb."variantId"
    WHERE sb."companyId" = ${companyId}`;
  return money(row?.value ?? 0);
}

/**
 * The blueprint's money cards and Accounts' to-do counts: cash position, stock
 * value, fixed assets, loans and investors, today's sales, profit, overdue
 * installments and claims waiting to be paid.
 */
export async function getAccountsOverview(ctx: CompanyContext) {
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const day = today(ctx);
  const dayStart = startOfDayInZone(day, tz);
  const dayEnd = endOfDay(ctx, day);
  const accounts = await loadAccounts(companyId);
  const totals = await accountTotals(companyId);
  const sum = (pick: (a: AccountInfo) => boolean) =>
    accounts.filter(pick).reduce((t, a) => t.plus(natural(a, totals)), ZERO);

  // Every active cash, bank and wallet account, plus archived ones still holding money.
  const cashAccounts = accounts
    .filter((a) => (CASH_SUBTYPES as readonly AccountSubType[]).includes(a.subType))
    .map((a) => ({
      accountId: a.id,
      code: a.code,
      name: a.name,
      subType: a.subType,
      isActive: a.isActive,
      balance: natural(a, totals),
    }))
    .filter((a) => a.isActive || !a.balance.isZero());
  const cash = cashAccounts.reduce((t, a) => t.plus(a.balance), ZERO);

  const todayTotals = await accountTotals(companyId, { start: dayStart, end: dayEnd });
  const todaySales = accounts
    .filter((a) => a.subType === "SALES")
    .reduce((t, a) => t.plus(natural(a, todayTotals)), ZERO);

  const monthFrom = monthStart(day);
  const fyFrom = financialYearStart(day, ctx.company.fiscalYearStartMonth);
  const [monthProfit, yearProfit, stockValue] = await Promise.all([
    netProfitFor(companyId, { start: startOfDayInZone(monthFrom, tz), end: dayEnd }),
    netProfitFor(companyId, { start: startOfDayInZone(fyFrom, tz), end: dayEnd }),
    stockValuation(companyId),
  ]);

  const weekAhead = startOfDayInZone(addDays(day, 8), tz);
  const unpaid = await prisma.capitalInstallment.findMany({
    where: {
      capitalSource: { companyId },
      status: { in: ["SCHEDULED", "OVERDUE"] },
      dueDate: { lt: weekAhead },
    },
    select: { dueDate: true, amount: true },
  });
  const overdue = unpaid.filter((i) => i.dueDate < dayStart);
  const upcoming = unpaid.filter((i) => i.dueDate >= dayStart);
  const claims = await ctx.db.expense.aggregate({
    where: { projectId: null, journalEntryId: null, voidedAt: null },
    _count: { _all: true },
    _sum: { amount: true },
  });
  const [draftPayrolls, unpaidSalaries] = await Promise.all([
    ctx.db.payrollRun.count({ where: { status: "DRAFT" } }),
    prisma.payrollItem.findMany({
      where: { paymentId: null, netPay: { gt: 0 }, run: { companyId, status: "APPROVED" } },
      select: { runId: true, netPay: true },
    }),
  ]);

  const loans = sum((a) => a.subType === "LOAN");
  const investors = sum((a) => a.subType === "INVESTOR");
  return {
    asOf: day,
    cash: {
      total: cash.toFixed(2),
      accounts: cashAccounts.map((a) => ({ ...a, balance: a.balance.toFixed(2) })),
    },
    /** "Total Active Stock Value": pieces on hand at average cost. */
    stockValue: stockValue.toFixed(2),
    /** Fixed assets at book value (cost less depreciation). */
    fixedAssets: sum(
      (a) => a.subType === "FIXED_ASSET" || a.subType === "ACCUMULATED_DEPRECIATION",
    ).toFixed(2),
    /** "Liabilities (Loans / Investors)". */
    liabilities: {
      loans: loans.toFixed(2),
      investors: investors.toFixed(2),
      total: loans.plus(investors).toFixed(2),
    },
    receivables: sum((a) => a.subType === "ACCOUNTS_RECEIVABLE").toFixed(2),
    payables: sum((a) => a.subType === "ACCOUNTS_PAYABLE").toFixed(2),
    customerAdvances: sum((a) => a.subType === "CUSTOMER_ADVANCE").toFixed(2),
    todaySales: todaySales.toFixed(2),
    netProfit: {
      thisMonth: monthProfit.toFixed(2),
      thisFinancialYear: yearProfit.toFixed(2),
      financialYearFrom: fyFrom,
    },
    installments: {
      overdue: {
        count: overdue.length,
        amount: overdue.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
      },
      dueNext7Days: {
        count: upcoming.length,
        amount: upcoming.reduce((t, i) => t.plus(i.amount), ZERO).toFixed(2),
      },
    },
    pendingClaims: {
      count: claims._count._all,
      amount: (claims._sum.amount ?? ZERO).toFixed(2),
    },
    payroll: {
      /** Advances employees still owe (recovered from salary or expenses). */
      employeeAdvances: sum((a) => a.subType === "ADVANCE_TO_EMPLOYEE").toFixed(2),
      /** Approved net salaries not yet paid. */
      salariesPayable: sum((a) => a.code === CONTROL_ACCOUNTS.SALARIES_PAYABLE.code).toFixed(2),
      draftsAwaitingApproval: draftPayrolls,
      awaitingPayment: {
        payrolls: new Set(unpaidSalaries.map((i) => i.runId)).size,
        employees: unpaidSalaries.length,
        amount: unpaidSalaries.reduce((t, i) => t.plus(i.netPay), ZERO).toFixed(2),
      },
    },
  };
}

// =============================================================================
// Books check
// =============================================================================

type Check = {
  key: string;
  label: string;
  ok: boolean;
  books: string;
  register: string;
  difference: string;
  note?: string;
};

/** Each employee's debit-minus-credit on one account (null: lines naming nobody). */
async function employeeBalances(companyId: string, accountId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ employeeId: string | null; balance: Prisma.Decimal }>
  >`
    SELECT jl."employeeId", SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${accountId}
    GROUP BY jl."employeeId"`;
  return new Map(rows.map((r) => [r.employeeId, new Prisma.Decimal(r.balance)]));
}

/** A ledger kept per employee against its HR register, employee by employee. */
async function employeeRegisterCheck(
  key: string,
  label: string,
  ledger: Map<string | null, Prisma.Decimal>,
  register: Map<string, Prisma.Decimal>,
): Promise<Check> {
  const total = (m: Map<string | null, Prisma.Decimal>) =>
    [...m.values()].reduce((t, v) => t.plus(v), ZERO);
  const ids = new Set<string | null>([...ledger.keys(), ...register.keys()]);
  const off = [...ids].filter(
    (id) => !(ledger.get(id) ?? ZERO).equals((id && register.get(id)) || ZERO),
  );
  const check = compare(key, label, total(ledger), total(register));
  if (off.length === 0) return check;
  const named = await prisma.employee.findMany({
    where: { id: { in: off.filter((id): id is string => id !== null) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(named.map((e) => [e.id, e.name]));
  return {
    ...check,
    ok: false,
    note: `Out of step: ${off
      .slice(0, 20)
      .map((id) => (id ? (nameOf.get(id) ?? id) : "lines naming no employee"))
      .join(", ")}`,
  };
}

function compare(
  key: string,
  label: string,
  books: Prisma.Decimal,
  register: Prisma.Decimal,
  tolerance: Prisma.Decimal.Value = 0,
  note?: string,
): Check {
  const difference = books.minus(register);
  return {
    key,
    label,
    ok: difference.abs().lte(tolerance),
    books: books.toFixed(2),
    register: register.toFixed(2),
    difference: difference.toFixed(2),
    ...(note ? { note } : {}),
  };
}

/**
 * Checks that the books hold together: the journal balances, and the stock,
 * fixed asset, loan and investor registers agree with their ledger accounts.
 */
export async function getBooksCheck(ctx: CompanyContext) {
  const companyId = ctx.company.id;
  const accounts = await loadAccounts(companyId);
  const totals = await accountTotals(companyId);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const balanceOf = (code: string) => {
    const a = byCode.get(code);
    return a ? natural(a, totals) : ZERO;
  };
  const checks: Check[] = [];

  // 1. Debits equal credits, overall and entry by entry.
  const all = [...totals.values()].reduce(
    (t, v) => ({ debit: t.debit.plus(v.debit), credit: t.credit.plus(v.credit) }),
    { debit: ZERO, credit: ZERO },
  );
  checks.push(compare("JOURNAL", "Total debits equal total credits", all.debit, all.credit));
  const unbalanced = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number
    FROM "JournalEntry" je
    JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id, je.number
    HAVING SUM(jl.debit) <> SUM(jl.credit)
    LIMIT 20`;
  checks.push({
    key: "ENTRIES",
    label: "Every journal entry balances",
    ok: unbalanced.length === 0,
    books: String(unbalanced.length),
    register: "0",
    difference: String(unbalanced.length),
    ...(unbalanced.length > 0
      ? { note: `Unbalanced: ${unbalanced.map((u) => u.number).join(", ")}` }
      : {}),
  });

  // 2. Lines on buyer / supplier accounts always name the buyer or supplier.
  const [untagged] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE je."companyId" = ${companyId} AND jl."partyId" IS NULL
      AND la."subType" IN ('ACCOUNTS_RECEIVABLE'::"AccountSubType", 'ACCOUNTS_PAYABLE'::"AccountSubType",
                           'CUSTOMER_ADVANCE'::"AccountSubType")`;
  const untaggedCount = Number(untagged?.count ?? 0);
  checks.push({
    key: "PARTY_LINES",
    label: "Receivable / payable lines name a buyer or supplier",
    ok: untaggedCount === 0,
    books: String(untaggedCount),
    register: "0",
    difference: String(untaggedCount),
  });

  // 3. Finished goods: inventory account vs pieces on hand at average cost.
  const stockValue = await stockValuation(companyId);
  checks.push(
    compare(
      "INVENTORY",
      "Finished goods inventory matches stock on hand",
      balanceOf(CONTROL_ACCOUNTS.INVENTORY.code),
      stockValue,
      Prisma.Decimal.max(1, stockValue.abs().times(0.001)),
      "Small differences come from rounding average costs to 4 decimals.",
    ),
  );

  // 4. Fixed assets: cost and depreciation vs the register.
  const assets = await prisma.fixedAsset.findMany({
    where: { companyId, status: { not: "DISPOSED" } },
    select: { purchaseCost: true, currentValue: true },
  });
  const cost = assets.reduce((t, a) => t.plus(a.purchaseCost), ZERO);
  const bookValue = assets.reduce((t, a) => t.plus(a.currentValue), ZERO);
  checks.push(
    compare(
      "FIXED_ASSETS",
      "Fixed assets at cost match the register",
      balanceOf(CONTROL_ACCOUNTS.FIXED_ASSETS.code),
      cost,
    ),
  );
  checks.push(
    compare(
      "DEPRECIATION",
      "Accumulated depreciation matches the register",
      balanceOf(CONTROL_ACCOUNTS.ACCUMULATED_DEPRECIATION.code).neg(),
      cost.minus(bookValue),
    ),
  );

  // 5. Each loan, investor and owner's capital vs its own ledger account.
  const sources = await prisma.capitalSource.findMany({
    where: { companyId },
    select: { name: true, outstanding: true, ledgerAccountId: true },
  });
  const sourceBooks = sources.reduce((t, s) => {
    const a = accounts.find((x) => x.id === s.ledgerAccountId);
    return a ? t.plus(natural(a, totals)) : t;
  }, ZERO);
  const sourceRegister = sources.reduce((t, s) => t.plus(s.outstanding), ZERO);
  const mismatched = sources.filter((s) => {
    const a = accounts.find((x) => x.id === s.ledgerAccountId);
    return !a || !natural(a, totals).equals(s.outstanding);
  });
  checks.push({
    ...compare(
      "CAPITAL",
      "Capital, investors and loans match their ledgers",
      sourceBooks,
      sourceRegister,
    ),
    ...(mismatched.length > 0
      ? { ok: false, note: `Check ${mismatched.map((s) => s.name).join(", ")}` }
      : {}),
  });

  // 6. Supplier bills: paid / due agree with each supplier's ledger (oldest dues settled first).
  const dueOnBills = await prisma.supplierBill.aggregate({
    where: { companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    _sum: { dueAmount: true },
  });
  const payable = balanceOf(CONTROL_ACCOUNTS.PAYABLE.code);
  const billsDue = dueOnBills._sum.dueAmount ?? ZERO;
  const outOfStep = await billsOutOfStep(companyId);
  checks.push({
    ...compare(
      "SUPPLIER_BILLS",
      "Supplier bills agree with the suppliers' ledgers",
      payable,
      billsDue,
    ),
    ok: outOfStep.length === 0,
    note:
      outOfStep.length > 0
        ? `Out of step: ${outOfStep
            .slice(0, 20)
            .map((b) => `${b.number} shows ${b.due} due, the ledger ${b.ledgerDue}`)
            .join("; ")}`
        : "Payables also include Due expenses, assets bought on credit and opening balances.",
  });

  // 7. Employee advances and salaries payable: every line names the employee, and each
  //    employee's balance matches the HR registers (open advances, approved unpaid pay).
  const advanceAccount = byCode.get(CONTROL_ACCOUNTS.EMPLOYEE_ADVANCES.code)!;
  const payableAccount = byCode.get(CONTROL_ACCOUNTS.SALARIES_PAYABLE.code)!;
  const [noEmployee] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."employeeId" IS NULL
      AND jl."accountId" IN (${advanceAccount.id}, ${payableAccount.id})`;
  const noEmployeeCount = Number(noEmployee?.count ?? 0);
  checks.push({
    key: "EMPLOYEE_LINES",
    label: "Advance and salary payable lines name the employee",
    ok: noEmployeeCount === 0,
    books: String(noEmployeeCount),
    register: "0",
    difference: String(noEmployeeCount),
  });
  const [advanceLedger, payableLedger, openAdvances, unpaidPay] = await Promise.all([
    employeeBalances(companyId, advanceAccount.id),
    employeeBalances(companyId, payableAccount.id),
    prisma.salaryAdvance.groupBy({
      by: ["employeeId"],
      where: { companyId, status: "OPEN" },
      _sum: { outstanding: true },
    }),
    prisma.payrollItem.groupBy({
      by: ["employeeId"],
      where: { paymentId: null, run: { companyId, status: { in: ["APPROVED", "PAID"] } } },
      _sum: { netPay: true },
    }),
  ]);
  checks.push(
    await employeeRegisterCheck(
      "EMPLOYEE_ADVANCES",
      "Advances to employees match what is owed on open advances",
      advanceLedger,
      new Map(openAdvances.map((a) => [a.employeeId, a._sum.outstanding ?? ZERO])),
    ),
  );
  checks.push(
    await employeeRegisterCheck(
      "SALARIES_PAYABLE",
      "Salaries payable match approved net pay not yet paid",
      // A liability: its balance is credit minus debit.
      new Map([...payableLedger].map(([id, v]) => [id, v.neg()])),
      new Map(unpaidPay.map((i) => [i.employeeId, i._sum.netPay ?? ZERO])),
    ),
  );

  return {
    asOf: today(ctx),
    ok: checks.every((c) => c.ok),
    checks,
  };
}
