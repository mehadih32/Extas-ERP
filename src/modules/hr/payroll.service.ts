import { type Employee, type PayrollItem, Prisma } from "@prisma/client";

import { amountInWords } from "@/lib/amount-words";
import { dateOnly, localDay, startOfDayInZone, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  type JournalLineInput,
  postJournalEntry,
  reverseJournalEntry,
} from "@/modules/accounts/journal.service";
import { assertCanPayMoney, assertCanReceiveMoney } from "@/modules/accounts/money-guards";
import { auditInCompany } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import {
  assertCanApprovePayroll,
  assertCanRunPayroll,
  assertCanSeeSalaries,
  requireLinkedEmployee,
} from "@/modules/hr/access";
import {
  applySettlementTx,
  lockOpenAdvances,
  recoverable,
  reverseSettlementsTx,
} from "@/modules/hr/advance.service";
import { monthKey, monthLabel, monthRange } from "@/modules/hr/calendar";
import { employeesInPeriod, loadEmploymentInputs, loadRules } from "@/modules/hr/month-data";
import {
  allocateRecovery,
  evaluateMonth,
  grossPay,
  maxRecovery,
  minutesToHours,
  netPay,
  overtimePay,
  scheduledRecovery,
} from "@/modules/hr/payroll-calc";
import { lockPayrollMonths } from "@/modules/hr/period-lock";
import {
  createPayrollSchema,
  listPayrollSchema,
  payPayrollSchema,
  payrollBonusSchema,
  reopenPayrollSchema,
  updatePayrollItemSchema,
  voidSchema,
} from "@/modules/hr/schemas";

/*
 * Monthly payroll, tied to the books:
 *   Draft      worked out from salaries, attendance, leave and advances; payroll
 *              adds allowances, bonus, tax and other deductions and can override
 *              overtime hours and the advance recovery; "recalculate" picks up
 *              later changes and keeps those edits.
 *   Approve    (a second person by default) posts one entry dated the month's
 *              last day, a line per employee:
 *                Dr Salaries & Wages             gross pay
 *                  Cr Advances to Employees      advance recovered
 *                  Cr Tax Deducted from Salaries tax (TDS)
 *                  Cr Other Income               other deductions (fines...)
 *                  Cr Salaries Payable           net pay
 *              and settles the advances recovered (oldest first). Approval is
 *              refused while the draft is out of date, so what was checked is
 *              what gets posted. The month's attendance, leave, holidays and
 *              salaries are then frozen.
 *   Pay        Accounts pays everyone or chosen employees in batches, each a
 *              payment voucher: Dr Salaries Payable (employee), Cr Cash / Bank.
 *              The run is PAID when every net pay is paid.
 *   Reopen     only with no live payments: the entry and the advance recoveries
 *              are reversed and the run is a draft again.
 */

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 120_000 };

const DAY_FIELDS = [
  "presentDays",
  "paidLeaveDays",
  "unpaidLeaveDays",
  "absentDays",
  "unpaidDays",
] as const;
const MONEY_FIELDS = [
  "monthlySalary",
  "overtimeHours",
  "basic",
  "overtime",
  "unpaidLeaveDeduction",
  "advanceDeduction",
  "netPay",
] as const;

const itemInclude = {
  employee: {
    select: {
      id: true,
      code: true,
      name: true,
      designation: true,
      department: true,
      joinDate: true,
      exitDate: true,
      overtimeRate: true,
      salaryMethod: true,
      bankName: true,
      bankAccountNumber: true,
      walletNumber: true,
      userId: true,
    },
  },
  payment: {
    select: { id: true, number: true, date: true, method: true, voidedAt: true },
  },
} satisfies Prisma.PayrollItemInclude;

const runInclude = {
  items: { include: itemInclude, orderBy: { employee: { code: "asc" } } },
  payments: {
    orderBy: { createdAt: "asc" },
    include: {
      account: { select: { id: true, code: true, name: true } },
      paidBy: { select: { id: true, name: true } },
      journalEntry: { select: { id: true, number: true, isReversed: true } },
    },
  },
  journalEntry: { select: { id: true, number: true, date: true, isReversed: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.PayrollRunInclude;

type ItemRow = Prisma.PayrollItemGetPayload<{ include: typeof itemInclude }>;
type RunRow = Prisma.PayrollRunGetPayload<{ include: typeof runInclude }>;

const runMonth = (run: { year: number; month: number }) => monthKey(run.year, run.month);

/** Gross pay and total deductions of a stored line. */
function itemTotals(i: PayrollItem) {
  const gross = grossPay(i);
  const deductions = i.advanceDeduction.plus(i.taxDeduction).plus(i.otherDeductions);
  return { gross, deductions };
}

function presentItem(i: ItemRow, daysInMonth: number) {
  const { gross, deductions } = itemTotals(i);
  return {
    id: i.id,
    employee: {
      id: i.employee.id,
      code: i.employee.code,
      name: i.employee.name,
      designation: i.employee.designation,
      department: i.employee.department,
      salaryMethod: i.employee.salaryMethod,
    },
    monthlySalary: i.monthlySalary.toFixed(2),
    dayRate: money(i.monthlySalary.dividedBy(daysInMonth)).toFixed(2),
    days: {
      working: i.workingDays,
      present: i.presentDays.toNumber(),
      paidLeave: i.paidLeaveDays.toNumber(),
      unpaidLeave: i.unpaidLeaveDays.toNumber(),
      absent: i.absentDays.toNumber(),
      late: i.lateDays,
      /** Absent + unpaid leave + days lost to lates. */
      unpaid: i.unpaidDays.toNumber(),
    },
    overtimeHours: i.overtimeHours.toFixed(2),
    overtimeEdited: i.overtimeEdited,
    /** Salary for the days employed this month. */
    salary: i.basic.toFixed(2),
    allowances: i.allowances.toFixed(2),
    overtime: i.overtime.toFixed(2),
    bonus: i.bonus.toFixed(2),
    unpaidLeaveDeduction: i.unpaidLeaveDeduction.toFixed(2),
    grossPay: gross.toFixed(2),
    advanceDeduction: i.advanceDeduction.toFixed(2),
    advanceEdited: i.advanceEdited,
    taxDeduction: i.taxDeduction.toFixed(2),
    otherDeductions: i.otherDeductions.toFixed(2),
    totalDeductions: deductions.toFixed(2),
    netPay: i.netPay.toFixed(2),
    note: i.note,
    paid: i.paymentId !== null,
    payment: i.payment,
  };
}

function presentRun(run: RunRow) {
  const month = runMonth(run);
  const { days } = monthRange(month);
  const totals = run.items.reduce(
    (t, i) => {
      const { gross, deductions } = itemTotals(i);
      return {
        gross: t.gross.plus(gross),
        deductions: t.deductions.plus(deductions),
        net: t.net.plus(i.netPay),
        paid: i.paymentId ? t.paid.plus(i.netPay) : t.paid,
      };
    },
    { gross: ZERO, deductions: ZERO, net: ZERO, paid: ZERO },
  );
  return {
    id: run.id,
    month,
    label: monthLabel(month),
    year: run.year,
    status: run.status,
    notes: run.notes,
    employees: run.items.length,
    totals: {
      gross: totals.gross.toFixed(2),
      deductions: totals.deductions.toFixed(2),
      net: totals.net.toFixed(2),
      paid: totals.paid.toFixed(2),
      unpaid: totals.net.minus(totals.paid).toFixed(2),
    },
    journalEntry: run.journalEntry,
    createdBy: run.createdBy,
    approvedBy: run.approvedBy,
    approvedAt: run.approvedAt,
    paidAt: run.paidAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    items: run.items.map((i) => presentItem(i, days)),
    payments: run.payments.map((p) => ({
      id: p.id,
      number: p.number,
      date: p.date,
      method: p.method,
      account: p.account,
      amount: p.amount.toFixed(2),
      employeeCount: p.employeeCount,
      reference: p.reference,
      paidBy: p.paidBy,
      journalEntry: p.journalEntry,
      voidedAt: p.voidedAt,
      voidReason: p.voidReason,
    })),
  };
}

async function loadRun(ctx: CompanyContext, runId: string, db: Tx | typeof prisma = prisma) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, companyId: ctx.company.id },
    include: runInclude,
  });
  if (!run) throw new AppError("NOT_FOUND", "Payroll not found.");
  return run;
}

export async function getPayrollRun(ctx: CompanyContext, runId: string) {
  assertCanSeeSalaries(ctx);
  return presentRun(await loadRun(ctx, runId));
}

export async function listPayrollRuns(ctx: CompanyContext, raw: unknown = {}) {
  assertCanSeeSalaries(ctx);
  const q = listPayrollSchema.parse(raw);
  const runs = await ctx.db.payrollRun.findMany({
    where: q.year ? { year: q.year } : {},
    include: {
      items: { select: { netPay: true, paymentId: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  return runs.map((r) => {
    const unpaid = r.items.filter((i) => !i.paymentId).reduce((t, i) => t.plus(i.netPay), ZERO);
    return {
      id: r.id,
      month: runMonth(r),
      label: monthLabel(runMonth(r)),
      status: r.status,
      employees: r.items.length,
      totalGross: r.totalGross.toFixed(2),
      totalNet: r.totalNet.toFixed(2),
      unpaid: r.status === "DRAFT" ? null : unpaid.toFixed(2),
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      paidAt: r.paidAt,
    };
  });
}

// =============================================================================
// Working out the figures
// =============================================================================

type ItemFigures = {
  employeeId: string;
  monthlySalary: Prisma.Decimal;
  workingDays: number;
  presentDays: Prisma.Decimal;
  paidLeaveDays: Prisma.Decimal;
  unpaidLeaveDays: Prisma.Decimal;
  absentDays: Prisma.Decimal;
  lateDays: number;
  unpaidDays: Prisma.Decimal;
  overtimeHours: Prisma.Decimal;
  overtimeEdited: boolean;
  basic: Prisma.Decimal;
  allowances: Prisma.Decimal;
  overtime: Prisma.Decimal;
  bonus: Prisma.Decimal;
  unpaidLeaveDeduction: Prisma.Decimal;
  advanceDeduction: Prisma.Decimal;
  advanceEdited: boolean;
  taxDeduction: Prisma.Decimal;
  otherDeductions: Prisma.Decimal;
  netPay: Prisma.Decimal;
  note: string | null;
};

type Computed = {
  month: string;
  figures: Map<string, ItemFigures>;
  employees: Map<string, Employee>;
  advances: Map<string, ReturnType<typeof recoverable>[]>;
};

/** True when the person's last working day falls in (or before the end of) the month. */
function leavingIn(employee: Employee, month: string) {
  return Boolean(employee.exitDate && dateOnly(employee.exitDate) <= monthRange(month).to);
}

/**
 * The month's figures for everyone employed in it, keeping the edits made on
 * the existing lines (allowances, bonus, tax, other deductions, notes, and
 * overtime hours / advance recovery when they were typed in).
 */
async function computeRun(
  tx: Tx,
  ctx: CompanyContext,
  run: { year: number; month: number },
  existing: PayrollItem[],
  advanceRows?: Awaited<ReturnType<typeof lockOpenAdvances>>,
): Promise<Computed> {
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const month = runMonth(run);
  const { from, to } = monthRange(month);
  const employees = await employeesInPeriod(companyId, from, to, tx);
  const [{ rules }, inputs] = await Promise.all([
    loadRules(companyId, from, to, tx),
    loadEmploymentInputs(companyId, employees, from, to, tx),
  ]);
  const open =
    advanceRows ??
    (await tx.salaryAdvance.findMany({
      where: { companyId, status: "OPEN", employeeId: { in: employees.map((e) => e.id) } },
      orderBy: [{ givenAt: "asc" }, { id: "asc" }],
    }));
  const advances = new Map<string, ReturnType<typeof recoverable>[]>();
  for (const a of open) {
    advances.set(a.employeeId, [...(advances.get(a.employeeId) ?? []), recoverable(a, tz)]);
  }
  const prevOf = new Map(existing.map((i) => [i.employeeId, i]));
  const figures = new Map<string, ItemFigures>();
  for (const e of employees) {
    const f = evaluateMonth(month, rules, inputs.get(e.id)!);
    if (!f) continue;
    const prev = prevOf.get(e.id);
    const overtimeHours = prev?.overtimeEdited
      ? prev.overtimeHours
      : minutesToHours(f.overtimeMinutes);
    const pay = {
      basic: f.basic,
      allowances: prev?.allowances ?? ZERO,
      overtime: overtimePay(overtimeHours, e.overtimeRate),
      bonus: prev?.bonus ?? ZERO,
      unpaidLeaveDeduction: f.unpaidDeduction,
    };
    const taxDeduction = prev?.taxDeduction ?? ZERO;
    const otherDeductions = prev?.otherDeductions ?? ZERO;
    const room = Prisma.Decimal.max(0, grossPay(pay).minus(taxDeduction).minus(otherDeductions));
    const advanceDeduction = prev?.advanceEdited
      ? prev.advanceDeduction
      : Prisma.Decimal.min(
          scheduledRecovery(advances.get(e.id) ?? [], month, leavingIn(e, month)),
          room,
        );
    figures.set(e.id, {
      employeeId: e.id,
      monthlySalary: f.monthlySalary,
      workingDays: f.workingDays,
      presentDays: new Prisma.Decimal(f.presentDays),
      paidLeaveDays: new Prisma.Decimal(f.paidLeaveDays),
      unpaidLeaveDays: new Prisma.Decimal(f.unpaidLeaveDays),
      absentDays: new Prisma.Decimal(f.absentDays),
      lateDays: f.lateDays,
      unpaidDays: new Prisma.Decimal(f.unpaidDays),
      overtimeHours,
      overtimeEdited: prev?.overtimeEdited ?? false,
      ...pay,
      advanceDeduction,
      advanceEdited: prev?.advanceEdited ?? false,
      taxDeduction,
      otherDeductions,
      netPay: netPay({ ...pay, advanceDeduction, taxDeduction, otherDeductions }),
      note: prev?.note ?? null,
    });
  }
  return { month, figures, employees: new Map(employees.map((e) => [e.id, e])), advances };
}

/** Lines whose deductions are more than the pay, or that recover more than is owed. */
function problems(computed: Computed) {
  const issues: string[] = [];
  for (const f of computed.figures.values()) {
    const name = computed.employees.get(f.employeeId)!.name;
    if (f.netPay.isNegative()) {
      issues.push(`${name}: deductions are ${f.netPay.neg().toFixed(2)} more than the pay`);
    }
    const max = maxRecovery(computed.advances.get(f.employeeId) ?? [], computed.month);
    if (f.advanceDeduction.gt(max)) {
      issues.push(
        `${name}: recovers ${f.advanceDeduction.toFixed(2)} but only ${max.toFixed(2)} is owed on advances`,
      );
    }
  }
  return issues;
}

/** Writes the figures to the run's lines (adds joiners, drops people no longer in the month). */
async function saveFigures(tx: Tx, runId: string, existing: PayrollItem[], computed: Computed) {
  const gone = existing.filter((i) => !computed.figures.has(i.employeeId)).map((i) => i.id);
  if (gone.length > 0) await tx.payrollItem.deleteMany({ where: { id: { in: gone } } });
  const byEmployee = new Map(existing.map((i) => [i.employeeId, i]));
  for (const f of computed.figures.values()) {
    const prev = byEmployee.get(f.employeeId);
    if (prev) {
      await tx.payrollItem.update({ where: { id: prev.id }, data: f });
    } else {
      await tx.payrollItem.create({ data: { ...f, runId } });
    }
  }
  const totals = [...computed.figures.values()].reduce(
    (t, f) => ({ gross: t.gross.plus(grossPay(f)), net: t.net.plus(f.netPay) }),
    { gross: ZERO, net: ZERO },
  );
  await tx.payrollRun.update({
    where: { id: runId },
    data: { totalGross: totals.gross, totalNet: totals.net },
  });
  return totals;
}

/** Names of the people whose stored line differs from a fresh calculation. */
function outOfDate(existing: PayrollItem[], computed: Computed): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const i of existing) {
    seen.add(i.employeeId);
    const f = computed.figures.get(i.employeeId);
    const name = computed.employees.get(i.employeeId)?.name ?? "someone who left the month";
    if (!f) {
      names.push(name);
      continue;
    }
    const same =
      i.workingDays === f.workingDays &&
      i.lateDays === f.lateDays &&
      DAY_FIELDS.every((k) => i[k].equals(f[k])) &&
      MONEY_FIELDS.every((k) => i[k].equals(f[k]));
    if (!same) names.push(name);
  }
  for (const id of computed.figures.keys()) {
    if (!seen.has(id)) names.push(computed.employees.get(id)!.name);
  }
  return names;
}

async function lockRun(tx: Tx, ctx: CompanyContext, runId: string) {
  await lockRow(tx, "PayrollRun", runId);
  const run = await tx.payrollRun.findFirst({
    where: { id: runId, companyId: ctx.company.id },
    include: { items: true },
  });
  if (!run) throw new AppError("NOT_FOUND", "Payroll not found.");
  await lockPayrollMonths(tx, ctx.company.id, [runMonth(run)]);
  return run;
}

function assertDraft(run: { status: string; year: number; month: number }) {
  if (run.status !== "DRAFT") {
    throw new AppError(
      "CONFLICT",
      `The payroll for ${monthLabel(runMonth(run))} is ${run.status.toLowerCase()}; reopen it to change it.`,
    );
  }
}

// =============================================================================
// Drafts
// =============================================================================

/** Starts a month's payroll for everyone employed in it. */
export async function createPayrollRun(ctx: CompanyContext, raw: unknown, meta?: RequestMeta) {
  assertCanRunPayroll(ctx);
  const input = createPayrollSchema.parse(raw);
  const companyId = ctx.company.id;
  const current = localDay(new Date(), ctx.company.timezone).slice(0, 7);
  if (input.month > current) {
    throw new AppError("VALIDATION", `${monthLabel(input.month)} has not started yet.`);
  }
  const year = Number(input.month.slice(0, 4));
  const month = Number(input.month.slice(5, 7));
  const existing = await ctx.db.payrollRun.findFirst({ where: { year, month } });
  if (existing) {
    throw new AppError("CONFLICT", `There is already a payroll for ${monthLabel(input.month)}.`);
  }
  const runId = await prisma.$transaction(async (tx) => {
    await lockPayrollMonths(tx, companyId, [input.month]);
    const run = await tx.payrollRun.create({
      data: { companyId, year, month, notes: input.notes ?? null, createdById: ctx.user.id },
    });
    const computed = await computeRun(tx, ctx, run, []);
    if (computed.figures.size === 0) {
      throw new AppError("VALIDATION", `Nobody was employed in ${monthLabel(input.month)}.`);
    }
    const totals = await saveFigures(tx, run.id, [], computed);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Started payroll for ${monthLabel(input.month)}: ${computed.figures.size} employee(s), gross ${totals.gross.toFixed(
          2,
        )}, net ${totals.net.toFixed(2)}`,
      },
      tx,
    );
    return run.id;
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

/** Recalculates a draft from the latest attendance, leave, salaries and advances. */
export async function recalculatePayrollRun(
  ctx: CompanyContext,
  runId: string,
  meta?: RequestMeta,
) {
  assertCanRunPayroll(ctx);
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    assertDraft(run);
    const computed = await computeRun(tx, ctx, run, run.items);
    const changed = outOfDate(run.items, computed);
    const totals = await saveFigures(tx, run.id, run.items, computed);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Recalculated payroll for ${monthLabel(computed.month)}: ${
          changed.length ? `changed for ${changed.join(", ")}` : "no changes"
        }; net ${totals.net.toFixed(2)}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

/** Edits one employee's line on a draft; the run is recalculated around it. */
export async function updatePayrollItem(
  ctx: CompanyContext,
  runId: string,
  itemId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRunPayroll(ctx);
  const input = updatePayrollItemSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    assertDraft(run);
    const item = run.items.find((i) => i.id === itemId);
    if (!item) throw new AppError("NOT_FOUND", "Payroll line not found.");
    const edited: PayrollItem = {
      ...item,
      ...(input.allowances !== undefined ? { allowances: money(input.allowances) } : {}),
      ...(input.bonus !== undefined ? { bonus: money(input.bonus) } : {}),
      ...(input.taxDeduction !== undefined ? { taxDeduction: money(input.taxDeduction) } : {}),
      ...(input.otherDeductions !== undefined
        ? { otherDeductions: money(input.otherDeductions) }
        : {}),
      ...(input.note !== undefined ? { note: input.note ?? null } : {}),
      ...(input.overtimeHours !== undefined
        ? input.overtimeHours === null
          ? { overtimeEdited: false }
          : {
              overtimeEdited: true,
              overtimeHours: new Prisma.Decimal(input.overtimeHours),
            }
        : {}),
      ...(input.advanceDeduction !== undefined
        ? input.advanceDeduction === null
          ? { advanceEdited: false }
          : { advanceEdited: true, advanceDeduction: money(input.advanceDeduction) }
        : {}),
    };
    const items = run.items.map((i) => (i.id === item.id ? edited : i));
    const computed = await computeRun(tx, ctx, run, items);
    const issues = problems(computed).filter((p) =>
      p.startsWith(`${computed.employees.get(item.employeeId)?.name}:`),
    );
    if (issues.length > 0) throw new AppError("VALIDATION", `${issues.join("; ")}.`);
    await saveFigures(tx, run.id, run.items, computed);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PayrollItem",
        entityId: item.id,
        summary: `Payroll ${monthLabel(computed.month)}, ${
          computed.employees.get(item.employeeId)?.name
        }: ${Object.entries(input)
          .map(([k, v]) => `${k} ${v === null ? "back to automatic" : String(v)}`)
          .join(", ")}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

/** Bonus (e.g. Eid) for everyone or listed employees: a % of monthly salary or a fixed amount. */
export async function setPayrollBonus(
  ctx: CompanyContext,
  runId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanRunPayroll(ctx);
  const input = payrollBonusSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    assertDraft(run);
    const chosen = input.employeeIds ? new Set(input.employeeIds) : null;
    if (chosen && run.items.filter((i) => chosen.has(i.employeeId)).length !== chosen.size) {
      throw new AppError("VALIDATION", "Some of those employees are not on this payroll.");
    }
    const items = run.items.map((i) =>
      !chosen || chosen.has(i.employeeId)
        ? {
            ...i,
            bonus:
              input.amount !== undefined
                ? money(input.amount)
                : money(i.monthlySalary.times(input.percentOfSalary!).dividedBy(100)),
          }
        : i,
    );
    const computed = await computeRun(tx, ctx, run, items);
    const issues = problems(computed);
    if (issues.length > 0) throw new AppError("VALIDATION", `${issues.join("; ")}.`);
    await saveFigures(tx, run.id, run.items, computed);
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Bonus on payroll ${monthLabel(computed.month)} for ${
          chosen ? `${chosen.size} employee(s)` : "everyone"
        }: ${
          input.amount !== undefined
            ? money(input.amount).toFixed(2)
            : `${input.percentOfSalary}% of monthly salary`
        }`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

/** Deletes a draft (nothing is in the books yet). */
export async function deletePayrollRun(ctx: CompanyContext, runId: string, meta?: RequestMeta) {
  assertCanRunPayroll(ctx);
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    assertDraft(run);
    await tx.payrollRun.delete({ where: { id: run.id } });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "DELETE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Deleted the draft payroll for ${monthLabel(runMonth(run))}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return { deleted: true };
}

// =============================================================================
// Approve and reopen
// =============================================================================

/** The accrual entry's lines: one set per employee. */
function accrualLines(
  items: ItemFigures[],
  acc: Awaited<ReturnType<typeof ensureControlAccounts>>,
  label: string,
): JournalLineInput[] {
  return items.flatMap((i) => [
    { accountId: acc.SALARIES, employeeId: i.employeeId, debit: grossPay(i), memo: label },
    {
      accountId: acc.EMPLOYEE_ADVANCES,
      employeeId: i.employeeId,
      credit: i.advanceDeduction,
      memo: "Advance recovered from salary",
    },
    {
      accountId: acc.SALARY_TAX,
      employeeId: i.employeeId,
      credit: i.taxDeduction,
      memo: "Tax deducted (TDS)",
    },
    {
      accountId: acc.OTHER_INCOME,
      employeeId: i.employeeId,
      credit: i.otherDeductions,
      memo: "Deducted from salary",
    },
    {
      accountId: acc.SALARIES_PAYABLE,
      employeeId: i.employeeId,
      credit: i.netPay,
      memo: "Net pay",
    },
  ]);
}

/**
 * Approves a draft: posts the month's salaries to the books, settles the
 * advances recovered and freezes the month. Refused while the draft is out of
 * date (attendance, leave, salaries or advances changed since it was worked out).
 */
export async function approvePayrollRun(ctx: CompanyContext, runId: string, meta?: RequestMeta) {
  assertCanApprovePayroll(ctx);
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    assertDraft(run);
    const month = runMonth(run);
    const label = `Salaries ${monthLabel(month)}`;
    const locked = await lockOpenAdvances(
      tx,
      companyId,
      run.items.map((i) => i.employeeId),
    );
    const computed = await computeRun(tx, ctx, run, run.items, locked);
    const stale = outOfDate(run.items, computed);
    if (stale.length > 0) {
      throw new AppError(
        "CONFLICT",
        `Attendance, leave, salaries or advances changed since this payroll was worked out (${stale.join(
          ", ",
        )}). Recalculate it, check it, then approve.`,
      );
    }
    const issues = problems(computed);
    if (issues.length > 0) throw new AppError("VALIDATION", `${issues.join("; ")}.`);

    const acc = await ensureControlAccounts(companyId, tx);
    const lines = [...computed.figures.values()];
    const totalGross = lines.reduce((t, i) => t.plus(grossPay(i)), ZERO);
    const accrualDate = startOfDayInZone(monthRange(month).to, tz);
    const entry = totalGross.gt(0)
      ? await postJournalEntry(tx, {
          companyId,
          date: accrualDate,
          description: `${label} — ${lines.length} employee(s)`,
          sourceType: "PAYROLL",
          sourceId: run.id,
          postedById: ctx.user.id,
          lines: accrualLines(lines, acc, label),
        })
      : null;

    for (const item of run.items) {
      if (item.advanceDeduction.lte(0)) continue;
      const employee = computed.employees.get(item.employeeId)!;
      const parts = allocateRecovery(
        computed.advances.get(item.employeeId) ?? [],
        month,
        item.advanceDeduction,
        leavingIn(employee, month),
      );
      for (const part of parts) {
        await applySettlementTx(tx, part.advanceId, part.amount, {
          kind: "PAYROLL",
          payrollItemId: item.id,
          settledAt: accrualDate,
          note: label,
        });
      }
    }

    const toPay = lines.some((i) => i.netPay.gt(0));
    const now = new Date();
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: toPay ? "APPROVED" : "PAID",
        journalEntryId: entry?.id ?? null,
        approvedById: ctx.user.id,
        approvedAt: now,
        paidAt: toPay ? null : now,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Approved payroll for ${monthLabel(month)}: ${lines.length} employee(s), gross ${totalGross.toFixed(
          2,
        )}, net ${run.totalNet.toFixed(2)}${entry ? `, ${entry.number}` : ""}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

/**
 * Reopens an approved payroll with no live payments: its entry is reversed (on
 * the same date), the advance recoveries are undone and it is a draft again.
 */
export async function reopenPayrollRun(
  ctx: CompanyContext,
  runId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanApprovePayroll(ctx);
  const { reason } = reopenPayrollSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    if (run.status === "DRAFT") throw new AppError("CONFLICT", "This payroll is still a draft.");
    const live = await tx.payrollPayment.count({ where: { runId: run.id, voidedAt: null } });
    if (live > 0) {
      throw new AppError(
        "CONFLICT",
        "Salaries from this payroll were paid; void those payments first.",
      );
    }
    const label = monthLabel(runMonth(run));
    if (run.journalEntryId) {
      const original = await tx.journalEntry.findUniqueOrThrow({
        where: { id: run.journalEntryId },
      });
      await reverseJournalEntry(tx, original.id, {
        description: `Reopened payroll ${label}: ${reason}`,
        postedById: ctx.user.id,
        date: original.date,
      });
    }
    const restored = await reverseSettlementsTx(tx, ctx.company.id, {
      payrollItemIds: run.items.map((i) => i.id),
    });
    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: "DRAFT",
        journalEntryId: null,
        approvedById: null,
        approvedAt: null,
        paidAt: null,
      },
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `Reopened payroll for ${label}${
          restored.gt(0) ? ` (advance recoveries of ${restored.toFixed(2)} undone)` : ""
        }: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

// =============================================================================
// Paying salaries
// =============================================================================

/** Accounts pays net salaries (everyone not yet paid, or chosen lines) in one voucher. */
export async function payPayrollRun(
  ctx: CompanyContext,
  runId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanPayMoney(ctx, "Only Accounts can pay salaries.");
  const input = payPayrollSchema.parse(raw);
  const companyId = ctx.company.id;
  const date = input.date ? toInstant(input.date, ctx.company.timezone) : new Date();
  const paymentId = await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    const label = monthLabel(runMonth(run));
    if (run.status === "DRAFT") {
      throw new AppError("CONFLICT", `Approve the payroll for ${label} before paying it.`);
    }
    if (run.status === "PAID") {
      throw new AppError("CONFLICT", `The payroll for ${label} is already fully paid.`);
    }
    const unpaid = run.items.filter((i) => !i.paymentId && i.netPay.gt(0));
    let items = unpaid;
    if (input.itemIds) {
      const wanted = new Set(input.itemIds);
      items = unpaid.filter((i) => wanted.has(i.id));
      if (items.length !== wanted.size) {
        throw new AppError(
          "VALIDATION",
          "Some chosen lines are not on this payroll, are already paid or have nothing to pay.",
        );
      }
    }
    if (items.length === 0) throw new AppError("CONFLICT", "Nothing is left to pay.");
    const employees = await tx.employee.findMany({
      where: { id: { in: items.map((i) => i.employeeId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(employees.map((e) => [e.id, e.name]));
    const total = items.reduce((t, i) => t.plus(i.netPay), ZERO);
    const acc = await ensureControlAccounts(companyId, tx);
    const paidFrom = await cashAccountFor(tx, companyId, input.method, input.accountId);
    const payment = await tx.payrollPayment.create({
      data: {
        companyId,
        runId: run.id,
        number: await nextDocumentNumber(tx, companyId, "PAYMENT_VOUCHER", date),
        date,
        method: input.method,
        accountId: paidFrom,
        amount: total,
        employeeCount: items.length,
        reference: input.reference ?? null,
        paidById: ctx.user.id,
      },
    });
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `${payment.number} — salaries for ${label} (${items.length} employee(s))`,
      sourceType: "PAYROLL",
      sourceId: payment.id,
      postedById: ctx.user.id,
      lines: [
        ...items.map((i) => ({
          accountId: acc.SALARIES_PAYABLE,
          employeeId: i.employeeId,
          debit: i.netPay,
          memo: `${nameOf.get(i.employeeId)} — ${label}`,
        })),
        { accountId: paidFrom, credit: total, memo: input.reference ?? payment.number },
      ],
    });
    await tx.payrollPayment.update({
      where: { id: payment.id },
      data: { journalEntryId: entry.id },
    });
    await tx.payrollItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { paymentId: payment.id },
    });
    const allPaid = unpaid.length === items.length;
    if (allPaid) {
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: date } });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PayrollPayment",
        entityId: payment.id,
        summary: `Paid salaries for ${label}: ${total.toFixed(2)} to ${items.length} employee(s) (${
          input.method
        }), ${payment.number}, ${entry.number}${allPaid ? "; payroll fully paid" : ""}`,
      },
      tx,
    );
    return payment.id;
  }, TX_OPTIONS);
  const payment = await ctx.db.payrollPayment.findUniqueOrThrow({ where: { id: paymentId } });
  return { paymentId, number: payment.number, run: await getPayrollRun(ctx, runId) };
}

/** Voids a salary payment made by mistake: its entry is reversed and those people are unpaid again. */
export async function voidPayrollPayment(
  ctx: CompanyContext,
  paymentId: string,
  raw: unknown,
  meta?: RequestMeta,
) {
  assertCanPayMoney(ctx, "Only Accounts can void salary payments.");
  assertCanReceiveMoney(ctx, "Only Accounts can void salary payments.");
  const { reason } = voidSchema.parse(raw);
  const found = await ctx.db.payrollPayment.findUnique({ where: { id: paymentId } });
  if (!found) throw new AppError("NOT_FOUND", "Salary payment not found.");
  await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, found.runId);
    await lockRow(tx, "PayrollPayment", paymentId);
    const payment = await tx.payrollPayment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.voidedAt) throw new AppError("CONFLICT", `${payment.number} is already void.`);
    if (payment.journalEntryId) {
      await reverseJournalEntry(tx, payment.journalEntryId, {
        description: `Void ${payment.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    await tx.payrollItem.updateMany({
      where: { paymentId: payment.id },
      data: { paymentId: null },
    });
    await tx.payrollPayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    if (run.status === "PAID") {
      await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "APPROVED", paidAt: null },
      });
    }
    await auditInCompany(
      ctx,
      meta,
      {
        action: "STATUS_CHANGE",
        entityType: "PayrollPayment",
        entityId: payment.id,
        summary: `Voided ${payment.number} (${payment.amount.toFixed(2)}, ${
          payment.employeeCount
        } employee(s), payroll ${monthLabel(runMonth(run))}): ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, found.runId);
}

// =============================================================================
// Payslips
// =============================================================================

async function payslip(
  ctx: CompanyContext,
  run: { year: number; month: number; status: string },
  i: ItemRow,
) {
  const month = runMonth(run);
  const { days } = monthRange(month);
  const rate = money(i.monthlySalary.dividedBy(days));
  const earnings = [
    {
      label: i.basic.equals(i.monthlySalary) ? "Salary" : `Salary for days employed`,
      amount: i.basic,
    },
    { label: "Allowances", amount: i.allowances },
    {
      label: `Overtime (${i.overtimeHours.toFixed(2)} h x ${
        i.employee.overtimeRate?.toFixed(2) ?? "0.00"
      })`,
      amount: i.overtime,
    },
    { label: "Bonus", amount: i.bonus },
  ].filter((e, index) => index === 0 || e.amount.gt(0));
  const deductions = [
    {
      label: `Unpaid days (${i.unpaidDays.toNumber()} x ${rate.toFixed(2)})`,
      amount: i.unpaidLeaveDeduction,
    },
    { label: "Advance recovery", amount: i.advanceDeduction },
    { label: "Tax deducted (TDS)", amount: i.taxDeduction },
    { label: "Other deductions", amount: i.otherDeductions },
  ].filter((d) => d.amount.gt(0));
  const totalEarnings = earnings.reduce((t, e) => t.plus(e.amount), ZERO);
  const totalDeductions = deductions.reduce((t, d) => t.plus(d.amount), ZERO);
  return {
    company: await letterhead(ctx),
    month,
    label: monthLabel(month),
    status: run.status,
    employee: {
      id: i.employee.id,
      code: i.employee.code,
      name: i.employee.name,
      designation: i.employee.designation,
      department: i.employee.department,
      joinDate: dateOnly(i.employee.joinDate),
      exitDate: dateOnly(i.employee.exitDate),
      salaryMethod: i.employee.salaryMethod,
      bankName: i.employee.bankName,
      bankAccountNumber: i.employee.bankAccountNumber,
      walletNumber: i.employee.walletNumber,
    },
    monthlySalary: i.monthlySalary.toFixed(2),
    attendance: {
      daysInMonth: days,
      workingDays: i.workingDays,
      presentDays: i.presentDays.toNumber(),
      paidLeaveDays: i.paidLeaveDays.toNumber(),
      unpaidLeaveDays: i.unpaidLeaveDays.toNumber(),
      absentDays: i.absentDays.toNumber(),
      lateDays: i.lateDays,
      unpaidDays: i.unpaidDays.toNumber(),
      overtimeHours: i.overtimeHours.toFixed(2),
    },
    earnings: earnings.map((e) => ({ label: e.label, amount: e.amount.toFixed(2) })),
    deductions: deductions.map((d) => ({ label: d.label, amount: d.amount.toFixed(2) })),
    totalEarnings: totalEarnings.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netPay: i.netPay.toFixed(2),
    netPayInWords: amountInWords(i.netPay, ctx.company.currency),
    payment: i.payment
      ? {
          status: "PAID" as const,
          number: i.payment.number,
          date: i.payment.date,
          method: i.payment.method,
        }
      : { status: run.status === "DRAFT" ? ("DRAFT" as const) : ("UNPAID" as const) },
    note: i.note,
  };
}

/** A payslip (printable data) for one line; drafts are marked as drafts. */
export async function getPayslip(ctx: CompanyContext, runId: string, itemId: string) {
  assertCanSeeSalaries(ctx);
  const run = await loadRun(ctx, runId);
  const item = run.items.find((i) => i.id === itemId);
  if (!item) throw new AppError("NOT_FOUND", "Payslip not found.");
  return payslip(ctx, run, item);
}

/** The signed-in employee's payslips from approved payrolls, newest first. */
export async function myPayslips(ctx: CompanyContext) {
  const employee = await requireLinkedEmployee(ctx);
  const items = await prisma.payrollItem.findMany({
    where: {
      employeeId: employee.id,
      run: { companyId: ctx.company.id, status: { in: ["APPROVED", "PAID"] } },
    },
    include: { run: { select: { id: true, year: true, month: true, status: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
  });
  return items.map((i) => ({
    itemId: i.id,
    month: runMonth(i.run),
    label: monthLabel(runMonth(i.run)),
    netPay: i.netPay.toFixed(2),
    paid: i.paymentId !== null,
  }));
}

export async function myPayslip(ctx: CompanyContext, itemId: string) {
  const employee = await requireLinkedEmployee(ctx);
  const item = await prisma.payrollItem.findFirst({
    where: {
      id: itemId,
      employeeId: employee.id,
      run: { companyId: ctx.company.id, status: { in: ["APPROVED", "PAID"] } },
    },
    include: { ...itemInclude, run: { select: { year: true, month: true, status: true } } },
  });
  if (!item) throw new AppError("NOT_FOUND", "Payslip not found.");
  return payslip(ctx, item.run, item);
}
