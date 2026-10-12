import {
  type BackgroundJob,
  type Employee,
  type PaymentMethod,
  type PayrollItem,
  type PayrollStatus,
  Prisma,
} from "@prisma/client";

import { METHOD_LABELS } from "@/components/sales/labels";
import { amountInWords } from "@/lib/amount-words";
import { dateColumn, dateOnly, localDay, startOfDayInZone, toInstant } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { nextDocumentNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/request-meta";
import { lockRow } from "@/lib/row-lock";
import { assertAllowed } from "@/lib/verdict";
import { money, ZERO } from "@/modules/accounts/balances";
import { cashAccountFor } from "@/modules/accounts/cash-accounts";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import {
  type JournalLineInput,
  postJournalEntry,
  reverseJournalEntry,
} from "@/modules/accounts/journal.service";
import { assertCanPayMoney, assertCanReceiveMoney } from "@/modules/accounts/money-guards";
import { auditInCompany, recordAudit } from "@/modules/audit/audit.service";
import type { CompanyContext } from "@/modules/auth/context";
import { letterhead } from "@/modules/companies/letterhead";
import {
  assertCanApprovePayroll,
  assertCanRunPayroll,
  assertCanSeeSalaries,
  canSeeSalaries,
  requireLinkedEmployee,
} from "@/modules/hr/access";
import {
  applySettlementTx,
  lockOpenAdvances,
  recoverable,
  reverseSettlementsTx,
} from "@/modules/hr/advance.service";
import { monthKey, monthLabel, monthRange } from "@/modules/hr/calendar";
import { claimWhat } from "@/modules/hr/claims";
import { employeesInPeriod, loadEmploymentInputs, loadRules } from "@/modules/hr/month-data";
import {
  allocateRecovery,
  balanceOf,
  evaluateMonth,
  grossPay,
  maxRecovery,
  minutesToHours,
  netPay,
  overtimePay,
  salaryPaymentParts,
  scheduledRecovery,
} from "@/modules/hr/payroll-calc";
import { lockPayrollMonths } from "@/modules/hr/period-lock";
import { payoutGateway, type PayoutWallet, sendPayout } from "@/modules/integrations/payouts";
import { enqueueJob } from "@/modules/jobs/queue";
import { kickJobWorker } from "@/modules/jobs/worker";
import { sendInApp } from "@/modules/reminders/notification.service";
import {
  canChangePayroll,
  canPayPayroll,
  canReopenPayroll,
  canVoidSalaryPayment,
} from "@/modules/hr/rules";
import {
  approvePayrollSchema,
  createPayrollSchema,
  listPayrollSchema,
  payPayrollSchema,
  payrollBonusSchema,
  reopenPayrollSchema,
  retryPayoutsSchema,
  updatePayrollItemSchema,
  voidSchema,
} from "@/modules/hr/schemas";

/*
 * Monthly payroll, tied to the books:
 *   Draft      worked out from salaries, attendance, leave, advances and the
 *              staff claims approved and still owed (dated by the month's end,
 *              not paid back on their own); payroll adds allowances, bonus, tax
 *              and other deductions and can override overtime hours and the
 *              advance recovery; "recalculate" picks up later changes and keeps
 *              those edits. Take-home = basic + approved overtime (+ allowances,
 *              bonus) + claims - (unpaid days + advance EMI + tax + other).
 *   Approve    (a second person by default) posts one entry dated the month's
 *              last day, a line per employee:
 *                Dr Salaries & Wages             gross pay
 *                Dr Payable to Staff (Claims)    claims paid with the salary
 *                  Cr Advances to Employees      advance recovered
 *                  Cr Tax Deducted from Salaries tax (TDS)
 *                  Cr Other Income               other deductions (fines...)
 *                  Cr Salaries Payable           net pay
 *              settles the advances recovered (oldest first) and ties the
 *              claims to the line. Approval is refused while the draft is out of
 *              date, so what was checked is what gets posted. The month's
 *              attendance, leave, holidays and salaries are then frozen.
 *   Pay        Accounts pays everyone, chosen employees or parts of salaries in
 *              batches, each a payment voucher: Dr Salaries Payable (employee),
 *              Cr Cash / Bank / Wallet, with a line per employee. A line is paid
 *              once its parts add up to the net pay (its claims then count as
 *              paid back); the run is PAID when every line is. Paid by bKash,
 *              Nagad or Rocket with the payout plug on, the money is also sent
 *              to each wallet in the background ("salary.payout" jobs).
 *   Reopen     only with no live payments: the entry, the advance recoveries and
 *              the claims' link are undone and the run is a draft again.
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
  "reimbursements",
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
  paymentLines: {
    where: { payment: { voidedAt: null } },
    orderBy: { payment: { date: "asc" } },
    select: {
      id: true,
      amount: true,
      payout: true,
      payoutError: true,
      payment: { select: { id: true, number: true, date: true, method: true } },
    },
  },
  claims: {
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: { id: true, number: true, kind: true, amount: true, approvedAmount: true },
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
      lines: {
        orderBy: { item: { employee: { code: "asc" } } },
        select: {
          id: true,
          amount: true,
          payout: true,
          payoutError: true,
          payoutReference: true,
          item: { select: { netPay: true, employee: { select: { id: true, name: true } } } },
        },
      },
    },
  },
  journalEntry: { select: { id: true, number: true, date: true, isReversed: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.PayrollRunInclude;

type ItemRow = Prisma.PayrollItemGetPayload<{ include: typeof itemInclude }>;
type RunRow = Prisma.PayrollRunGetPayload<{ include: typeof runInclude }>;

const runMonth = (run: { year: number; month: number }) => monthKey(run.year, run.month);

/** "Rina", "Rina and Sumon", "Rina, Sumon and Jamal". */
const listText = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

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
      /** A bKash, Nagad or Rocket number is on file (salary can go to the wallet). */
      hasWallet: Boolean(i.employee.walletNumber),
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
    /** Why the other deductions are taken; needed before the payroll is approved. */
    deductionReason: i.deductionReason,
    totalDeductions: deductions.toFixed(2),
    /** Approved staff claims paid back with this salary. */
    reimbursements: i.reimbursements.toFixed(2),
    /** The claim numbers paid back with it. */
    claims: i.claims.map((c) => c.number),
    netPay: i.netPay.toFixed(2),
    note: i.note,
    paid: i.paymentId !== null,
    /** Paid so far (a salary can be paid in parts) and what is left. */
    paidAmount: i.paidAmount.toFixed(2),
    balance: balanceOf(i).toFixed(2),
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
        paid: t.paid.plus(i.paidAmount),
        reimbursements: t.reimbursements.plus(i.reimbursements),
      };
    },
    { gross: ZERO, deductions: ZERO, net: ZERO, paid: ZERO, reimbursements: ZERO },
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
      reimbursements: totals.reimbursements.toFixed(2),
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
      lines: p.lines.map((l) => ({
        id: l.id,
        employee: l.item.employee,
        amount: l.amount.toFixed(2),
        payout: l.payout,
        payoutError: l.payoutError,
        payoutReference: l.payoutReference,
      })),
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
      items: { select: { netPay: true, paidAmount: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  return runs.map((r) => {
    const unpaid = r.items.reduce((t, i) => t.plus(balanceOf(i)), ZERO);
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
  deductionReason: string | null;
  reimbursements: Prisma.Decimal;
  netPay: Prisma.Decimal;
  note: string | null;
};

type OwedClaim = Awaited<ReturnType<typeof claimsToPayBack>>[number];

type Computed = {
  month: string;
  figures: Map<string, ItemFigures>;
  employees: Map<string, Employee>;
  advances: Map<string, ReturnType<typeof recoverable>[]>;
  /** The claims each person's reimbursements pay back. */
  claims: Map<string, OwedClaim[]>;
};

/**
 * Approved staff claims a month's salaries pay back: dated by the month's end,
 * not paid back on their own, not on another approved payroll, and their
 * expense not voided.
 */
const owedClaimsWhere = (companyId: string, employeeIds: string[], monthEnd: string) =>
  ({
    companyId,
    employeeId: { in: employeeIds },
    status: "APPROVED",
    paidAt: null,
    payrollItemId: null,
    date: { lte: dateColumn(monthEnd) },
    OR: [{ expenseId: null }, { expense: { voidedAt: null } }],
  }) satisfies Prisma.StaffClaimWhereInput;

/**
 * The claims a month's salaries pay back (see owedClaimsWhere). `lock` holds
 * them (approval) so Accounts cannot pay them back separately at the same moment.
 */
async function claimsToPayBack(
  tx: Tx,
  companyId: string,
  employeeIds: string[],
  monthEnd: string,
  lock = false,
) {
  if (employeeIds.length === 0) return [];
  if (lock) {
    await tx.$queryRaw`
      SELECT "id" FROM "StaffClaim"
      WHERE "companyId" = ${companyId} AND "employeeId" IN (${Prisma.join(employeeIds)})
        AND "status" = 'APPROVED' AND "paidAt" IS NULL AND "payrollItemId" IS NULL
      FOR UPDATE`;
  }
  return tx.staffClaim.findMany({
    where: owedClaimsWhere(companyId, employeeIds, monthEnd),
    select: { id: true, number: true, employeeId: true, amount: true, approvedAmount: true },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
}

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
  lockClaims = false,
): Promise<Computed> {
  const companyId = ctx.company.id;
  const tz = ctx.company.timezone;
  const month = runMonth(run);
  const { from, to } = monthRange(month);
  const employees = await employeesInPeriod(companyId, from, to, tx);
  const owedClaims = await claimsToPayBack(
    tx,
    companyId,
    employees.map((e) => e.id),
    to,
    lockClaims,
  );
  const [{ rules }, inputs] = await Promise.all([
    loadRules(companyId, from, to, tx),
    loadEmploymentInputs(companyId, employees, from, to, tx),
  ]);
  const claims = new Map<string, OwedClaim[]>();
  for (const c of owedClaims) claims.set(c.employeeId, [...(claims.get(c.employeeId) ?? []), c]);
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
    const reimbursements = (claims.get(e.id) ?? []).reduce(
      (t, c) => t.plus(c.approvedAmount ?? c.amount),
      ZERO,
    );
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
      // The reason goes with the amount: none once nothing else is deducted.
      deductionReason: otherDeductions.gt(0) ? (prev?.deductionReason ?? null) : null,
      reimbursements,
      netPay: netPay({ ...pay, advanceDeduction, taxDeduction, otherDeductions, reimbursements }),
      note: prev?.note ?? null,
    });
  }
  return {
    month,
    figures,
    employees: new Map(employees.map((e) => [e.id, e])),
    advances,
    claims,
  };
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

function assertDraft(run: { status: PayrollStatus; year: number; month: number }) {
  assertAllowed(canChangePayroll(run));
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

/** Money in the audit trail as everywhere else ("1500.00"), so the Home screen's eye hides it. */
const PAYROLL_MONEY_FIELDS = new Set([
  "allowances",
  "bonus",
  "taxDeduction",
  "otherDeductions",
  "advanceDeduction",
]);

const payrollEditValue = (field: string, value: unknown) =>
  PAYROLL_MONEY_FIELDS.has(field) && typeof value === "number"
    ? money(value).toFixed(2)
    : String(value);

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
      ...(input.deductionReason !== undefined
        ? { deductionReason: input.deductionReason || null }
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
    // A new reason needs an amount; taking the amount off drops the old one.
    if (input.deductionReason && edited.otherDeductions.lte(0)) {
      throw new AppError("VALIDATION", "Give the amount deducted along with the reason.", {
        otherDeductions: ["Give the amount deducted along with the reason."],
      });
    }
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
          .map(([k, v]) => `${k} ${v === null ? "back to automatic" : payrollEditValue(k, v)}`)
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
      accountId: acc.EMPLOYEE_PAYABLE,
      employeeId: i.employeeId,
      debit: i.reimbursements,
      memo: "Claims paid back with the salary",
    },
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
 * date (attendance, leave, salaries or advances changed since it was worked out),
 * and until every line with other deductions says why (`reasons`, by line id,
 * fills in the ones that do not; the payslip prints them).
 */
export async function approvePayrollRun(
  ctx: CompanyContext,
  runId: string,
  meta?: RequestMeta,
  raw: unknown = {},
) {
  assertCanApprovePayroll(ctx);
  const input = approvePayrollSchema.parse(raw ?? {});
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
    const computed = await computeRun(tx, ctx, run, run.items, locked, true);
    const stale = outOfDate(run.items, computed);
    if (stale.length > 0) {
      throw new AppError(
        "CONFLICT",
        `Attendance, leave, salaries, advances or staff claims changed since this payroll was worked out (${stale.join(
          ", ",
        )}). Recalculate it, check it, then approve.`,
      );
    }
    const issues = problems(computed);
    if (issues.length > 0) throw new AppError("VALIDATION", `${issues.join("; ")}.`);

    // Nothing is taken from a salary without a reason on the payslip.
    const missing: string[] = [];
    for (const item of run.items) {
      if (item.otherDeductions.lte(0)) continue;
      const given = input.reasons?.[item.id] || null;
      if (given && given !== item.deductionReason) {
        await tx.payrollItem.update({ where: { id: item.id }, data: { deductionReason: given } });
      } else if (!given && !item.deductionReason) {
        missing.push(computed.employees.get(item.employeeId)?.name ?? "someone");
      }
    }
    if (missing.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Say why the other deductions are taken from ${listText(missing)} before approving.`,
      );
    }

    const acc = await ensureControlAccounts(companyId, tx);
    const lines = [...computed.figures.values()];
    const totalGross = lines.reduce((t, i) => t.plus(grossPay(i)), ZERO);
    const totalClaims = lines.reduce((t, i) => t.plus(i.reimbursements), ZERO);
    const accrualDate = startOfDayInZone(monthRange(month).to, tz);
    const entry =
      totalGross.gt(0) || totalClaims.gt(0)
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

    // The claims each line pays back now belong to it: Accounts can no longer
    // pay them back on their own, and they count as paid with the salary.
    let claimsLinked = 0;
    for (const item of run.items) {
      const ids = (computed.claims.get(item.employeeId) ?? []).map((c) => c.id);
      if (ids.length === 0) continue;
      const linked = await tx.staffClaim.updateMany({
        where: { id: { in: ids }, paidAt: null, payrollItemId: null },
        data: { payrollItemId: item.id },
      });
      if (linked.count !== ids.length) {
        throw new AppError(
          "CONFLICT",
          "Some staff claims were paid back meanwhile. Recalculate the payroll, check it, then approve.",
        );
      }
      claimsLinked += ids.length;
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
        )}, net ${run.totalNet.toFixed(2)}${
          claimsLinked > 0
            ? `, ${claimsLinked} staff claim(s) paid back with it (${totalClaims.toFixed(2)})`
            : ""
        }${entry ? `, ${entry.number}` : ""}`,
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
    const live = await tx.payrollPayment.count({ where: { runId: run.id, voidedAt: null } });
    assertAllowed(canReopenPayroll(run, live));
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
    // Its claims are owed on their own again (the reversal put them back in Payable to Staff).
    const unlinked = await tx.staffClaim.updateMany({
      where: { payrollItemId: { in: run.items.map((i) => i.id) } },
      data: { payrollItemId: null },
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
        }${unlinked.count > 0 ? ` (${unlinked.count} staff claim(s) owed on their own again)` : ""}: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, runId);
}

// =============================================================================
// Paying salaries
// =============================================================================

/** Methods whose payments the payout plug can also send to the employee's wallet. */
const PAYOUT_METHODS = new Set<PaymentMethod>(["BKASH", "NAGAD", "ROCKET"]);

const isPayoutMethod = (method: PaymentMethod): method is PayoutWallet & PaymentMethod =>
  PAYOUT_METHODS.has(method);

/**
 * Accounts pays net salaries in one voucher: everyone not yet paid, chosen
 * lines, or parts of salaries (a line is paid once its parts add up to its net
 * pay). Paid by bKash, Nagad or Rocket with `sendToWallets`, each amount is
 * also sent to the employee's wallet through the payout plug, in the
 * background.
 */
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
  if (input.sendToWallets) {
    if (!isPayoutMethod(input.method)) {
      throw new AppError("VALIDATION", "Only bKash, Nagad or Rocket payments go to wallets.", {
        sendToWallets: ["Pay by bKash, Nagad or Rocket to send it to their wallets."],
      });
    }
    if (!payoutGateway()) {
      throw new AppError(
        "UNAVAILABLE",
        "Wallet payouts are not connected yet. Send the money yourself, then record it here.",
      );
    }
  }
  const paymentId = await prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, ctx, runId);
    const label = monthLabel(runMonth(run));
    const open = run.items.filter((i) => balanceOf(i).gt(0));
    assertAllowed(canPayPayroll(run, open.length));
    const plan = salaryPaymentParts(run.items, { itemIds: input.itemIds, parts: input.parts });
    if (!plan.ok) {
      throw new AppError(
        plan.message === "Nothing is left to pay." ? "CONFLICT" : "VALIDATION",
        plan.message,
      );
    }
    const itemOf = new Map(run.items.map((i) => [i.id, i]));
    const parts = plan.parts.map((p) => ({ ...p, item: itemOf.get(p.itemId)! }));
    const employees = await tx.employee.findMany({
      where: { id: { in: parts.map((p) => p.item.employeeId) } },
      select: { id: true, name: true, walletNumber: true, userId: true },
    });
    const employeeOf = new Map(employees.map((e) => [e.id, e]));
    if (input.sendToWallets) {
      const missing = employees.filter((e) => !e.walletNumber).map((e) => e.name);
      if (missing.length > 0) {
        throw new AppError(
          "VALIDATION",
          `${listText(missing)} ${missing.length === 1 ? "has" : "have"} no wallet number. Add it on their page, or pay them another way.`,
        );
      }
    }
    const total = parts.reduce((t, p) => t.plus(p.amount), ZERO);
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
        employeeCount: parts.length,
        reference: input.reference ?? null,
        paidById: ctx.user.id,
      },
    });
    const isPart = (p: (typeof parts)[number]) => !p.amount.equals(balanceOf(p.item));
    const entry = await postJournalEntry(tx, {
      companyId,
      date,
      description: `${payment.number} — salaries for ${label} (${parts.length} employee(s))`,
      sourceType: "PAYROLL",
      sourceId: payment.id,
      postedById: ctx.user.id,
      lines: [
        ...parts.map((p) => ({
          accountId: acc.SALARIES_PAYABLE,
          employeeId: p.item.employeeId,
          debit: p.amount,
          memo: `${employeeOf.get(p.item.employeeId)?.name} — ${label}${isPart(p) ? " (part)" : ""}`,
        })),
        { accountId: paidFrom, credit: total, memo: input.reference ?? payment.number },
      ],
    });
    await tx.payrollPayment.update({
      where: { id: payment.id },
      data: { journalEntryId: entry.id },
    });
    await tx.payrollPaymentLine.createMany({
      data: parts.map((p) => ({
        companyId,
        paymentId: payment.id,
        itemId: p.item.id,
        amount: p.amount,
        payout: input.sendToWallets ? ("QUEUED" as const) : null,
      })),
    });
    let finished = 0;
    for (const p of parts) {
      const paid = p.item.paidAmount.plus(p.amount);
      const done = paid.gte(p.item.netPay);
      await tx.payrollItem.update({
        where: { id: p.item.id },
        data: { paidAmount: paid, ...(done ? { paymentId: payment.id } : {}) },
      });
      const person = employeeOf.get(p.item.employeeId);
      if (person?.userId) {
        const how = `${p.amount.toFixed(2)} paid by ${METHOD_LABELS[input.method]}${
          input.sendToWallets ? " to your wallet" : ""
        }`;
        await sendInApp(tx, companyId, [{ userId: person.userId, employeeId: person.id }], {
          subject: done ? `Salary for ${label} paid` : `Part of your ${label} salary paid`,
          body: done
            ? `${how}. Your ${label} salary is paid in full.`
            : `${how}. ${p.item.netPay.minus(paid).toFixed(2)} is still to come.`,
          entityType: "MySalary",
          entityId: p.item.id,
        });
      }
      if (!done) continue;
      finished += 1;
      // Its claims are paid back with the last part of the salary.
      await tx.staffClaim.updateMany({
        where: { payrollItemId: p.item.id, paidAt: null },
        data: { paidAt: date, paidById: ctx.user.id, paymentEntryId: entry.id },
      });
    }
    const allPaid = finished === open.length;
    if (allPaid) {
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: date } });
    }
    if (input.sendToWallets) {
      await enqueueJob(tx, {
        kind: "salary.payout",
        companyId,
        payload: { paymentId: payment.id },
        maxAttempts: 1,
      });
    }
    const partly = parts.length - parts.filter((p) => !isPart(p)).length;
    await auditInCompany(
      ctx,
      meta,
      {
        action: "CREATE",
        entityType: "PayrollPayment",
        entityId: payment.id,
        summary: `Paid salaries for ${label}: ${total.toFixed(2)} to ${parts.length} employee(s) (${
          input.method
        }${input.sendToWallets ? ", sent to their wallets" : ""})${
          partly > 0 ? `, ${partly} in part` : ""
        }, ${payment.number}, ${entry.number}${allPaid ? "; payroll fully paid" : ""}`,
      },
      tx,
    );
    return payment.id;
  }, TX_OPTIONS);
  if (input.sendToWallets) kickJobWorker();
  const payment = await ctx.db.payrollPayment.findUniqueOrThrow({ where: { id: paymentId } });
  return { paymentId, number: payment.number, run: await getPayrollRun(ctx, runId) };
}

/**
 * Voids a salary payment made by mistake: its entry is reversed, what it paid
 * comes off each line (those people are owed it again, and the claims paid
 * with a salary it finished are owed again), and wallet payouts not sent yet
 * are stopped. Money a wallet already sent is not taken back.
 */
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
    const payment = await tx.payrollPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { lines: true },
    });
    assertAllowed(
      canVoidSalaryPayment({ number: payment.number, voided: payment.voidedAt !== null }),
    );
    if (payment.journalEntryId) {
      await reverseJournalEntry(tx, payment.journalEntryId, {
        description: `Void ${payment.number}: ${reason}`,
        postedById: ctx.user.id,
      });
    }
    const itemIds = payment.lines.map((l) => l.itemId);
    for (const line of payment.lines) {
      await tx.payrollItem.update({
        where: { id: line.itemId },
        data: { paidAmount: { decrement: line.amount }, paymentId: null },
      });
    }
    await tx.payrollItem.updateMany({
      where: { paymentId: payment.id },
      data: { paymentId: null },
    });
    await tx.staffClaim.updateMany({
      where: { payrollItemId: { in: itemIds }, paidAt: { not: null } },
      data: { paidAt: null, paidById: null, paymentEntryId: null },
    });
    const stopped = await tx.payrollPaymentLine.updateMany({
      where: { paymentId: payment.id, payout: "QUEUED" },
      data: { payout: "CANCELLED" },
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
        } employee(s), payroll ${monthLabel(runMonth(run))})${
          stopped.count > 0 ? `, ${stopped.count} wallet payout(s) stopped` : ""
        }: ${reason}`,
      },
      tx,
    );
  }, TX_OPTIONS);
  return getPayrollRun(ctx, found.runId);
}

/** Sends the failed wallet payouts of a salary payment again (all, or chosen lines). */
export async function retrySalaryPayouts(
  ctx: CompanyContext,
  paymentId: string,
  raw: unknown = {},
  meta?: RequestMeta,
) {
  assertCanPayMoney(ctx, "Only Accounts can send salaries.");
  const input = retryPayoutsSchema.parse(raw);
  if (!payoutGateway()) {
    throw new AppError("UNAVAILABLE", "Wallet payouts are not connected yet.");
  }
  const payment = await ctx.db.payrollPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError("NOT_FOUND", "Salary payment not found.");
  if (payment.voidedAt) throw new AppError("CONFLICT", `${payment.number} is void.`);
  const count = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "PayrollPayment", paymentId);
    const again = await tx.payrollPaymentLine.updateMany({
      where: {
        paymentId,
        payout: "FAILED",
        ...(input.lineIds ? { id: { in: input.lineIds } } : {}),
      },
      data: { payout: "QUEUED", payoutError: null },
    });
    if (again.count === 0) throw new AppError("CONFLICT", "No failed payouts to send again.");
    await enqueueJob(tx, {
      kind: "salary.payout",
      companyId: ctx.company.id,
      payload: { paymentId },
      maxAttempts: 1,
    });
    await auditInCompany(
      ctx,
      meta,
      {
        action: "UPDATE",
        entityType: "PayrollPayment",
        entityId: paymentId,
        summary: `Sending ${again.count} failed wallet payout(s) of ${payment.number} again`,
      },
      tx,
    );
    return again.count;
  }, TX_OPTIONS);
  kickJobWorker();
  return { paymentId, queued: count, run: await getPayrollRun(ctx, payment.runId) };
}

/**
 * The "salary.payout" job: sends each waiting line of a salary payment to the
 * employee's wallet through the payout plug and keeps what came back. A
 * refusal marks the line FAILED for Accounts to send again or void; nothing is
 * retried on its own, so money never goes twice.
 */
export async function runSalaryPayoutJob(job: Pick<BackgroundJob, "payload">): Promise<void> {
  const paymentId = (job.payload as { paymentId?: unknown } | null)?.paymentId;
  if (typeof paymentId !== "string") throw new Error("The job does not name a salary payment.");
  const payment = await prisma.payrollPayment.findUnique({
    where: { id: paymentId },
    include: {
      run: { select: { year: true, month: true } },
      lines: {
        where: { payout: "QUEUED" },
        include: {
          item: { select: { employee: { select: { code: true, walletNumber: true } } } },
        },
      },
    },
  });
  if (!payment || payment.lines.length === 0) return;
  if (payment.voidedAt) {
    await prisma.payrollPaymentLine.updateMany({
      where: { paymentId, payout: "QUEUED" },
      data: { payout: "CANCELLED" },
    });
    return;
  }
  const gateway = payoutGateway();
  const month = runMonth(payment.run);
  let sent = 0;
  for (const line of payment.lines) {
    // Taken first, so a second run of the job never sends the same line again.
    const taken = await prisma.payrollPaymentLine.updateMany({
      where: { id: line.id, payout: "QUEUED" },
      data: {
        payout: "FAILED",
        payoutError: "Stopped while sending: check the wallet statement before sending it again.",
        payoutAt: new Date(),
      },
    });
    if (taken.count === 0) continue;
    const employee = line.item.employee;
    let result: Awaited<ReturnType<typeof sendPayout>>;
    try {
      result = await sendPayout(
        {
          wallet: payment.method as PayoutWallet,
          to: employee.walletNumber ?? "",
          amount: line.amount.toFixed(2),
          reference: `SAL-${month} ${employee.code}`,
        },
        gateway,
      );
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) sent += 1;
    await prisma.payrollPaymentLine.update({
      where: { id: line.id },
      data: result.ok
        ? {
            payout: "SENT",
            payoutReference: result.providerReference,
            payoutError: null,
            payoutAt: new Date(),
          }
        : { payout: "FAILED", payoutError: result.error, payoutAt: new Date() },
    });
  }
  await recordAudit({
    companyId: payment.companyId,
    userId: null,
    action: "UPDATE",
    entityType: "PayrollPayment",
    entityId: payment.id,
    summary: `Wallet payouts for ${payment.number}: ${sent} sent${
      payment.lines.length > sent ? `, ${payment.lines.length - sent} failed` : ""
    }`,
  });
}

// =============================================================================
// Payslips
// =============================================================================

/** "1 day", "2.5 days". */
const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** "2 days absent, 1 day on unpaid leave, 1 day for 3 lates". */
function unpaidDaysText(i: PayrollItem) {
  const absent = i.absentDays.toNumber();
  const unpaidLeave = i.unpaidLeaveDays.toNumber();
  const forLates = i.unpaidDays.minus(i.absentDays).minus(i.unpaidLeaveDays).toNumber();
  return [
    absent > 0 && `${daysText(absent)} absent`,
    unpaidLeave > 0 && `${daysText(unpaidLeave)} on unpaid leave`,
    forLates > 0 &&
      `${daysText(forLates)} for ${i.lateDays} ${i.lateDays === 1 ? "late" : "lates"}`,
  ]
    .filter(Boolean)
    .join(", ");
}

const payslipClaimSelect = {
  id: true,
  number: true,
  kind: true,
  date: true,
  amount: true,
  approvedAmount: true,
  purpose: true,
  fromPlace: true,
  toPlace: true,
  item: true,
  quantity: true,
  project: { select: { code: true } },
} satisfies Prisma.StaffClaimSelect;

/**
 * What a payslip explains beyond the figures: the claims paid back with it
 * (on a draft, the ones it is going to pay back) and the advances it recovers.
 */
async function payslipExtras(
  companyId: string,
  run: { status: string },
  i: ItemRow,
  monthEnd: string,
) {
  const draft = run.status === "DRAFT";
  const [claims, advances] = await Promise.all([
    i.reimbursements.gt(0) || i.claims.length > 0
      ? prisma.staffClaim.findMany({
          where: draft
            ? owedClaimsWhere(companyId, [i.employeeId], monthEnd)
            : { payrollItemId: i.id },
          select: payslipClaimSelect,
          orderBy: [{ date: "asc" }, { number: "asc" }],
        })
      : [],
    i.advanceDeduction.lte(0)
      ? []
      : draft
        ? prisma.salaryAdvance.findMany({
            where: { companyId, employeeId: i.employeeId, status: "OPEN" },
            select: { number: true },
            orderBy: [{ givenAt: "asc" }, { id: "asc" }],
          })
        : prisma.advanceSettlement
            .findMany({
              where: { payrollItemId: i.id, reversedAt: null },
              select: { advance: { select: { number: true } } },
              orderBy: { advance: { givenAt: "asc" } },
            })
            .then((rows) => rows.map((r) => r.advance)),
  ]);
  return { claims, advances: [...new Set(advances.map((a) => a.number))] };
}

async function payslip(
  ctx: CompanyContext,
  run: { year: number; month: number; status: string },
  i: ItemRow,
) {
  const month = runMonth(run);
  const { days, to } = monthRange(month);
  const rate = money(i.monthlySalary.dividedBy(days));
  const extras = await payslipExtras(ctx.company.id, run, i, to);
  const claims = extras.claims.map((c) => ({
    id: c.id,
    number: c.number,
    kind: c.kind,
    date: dateOnly(c.date)!,
    /** "Office to Bank" or "Yarn (5 kg) for PRD-2026-00003". */
    what: claimWhat(c),
    purpose: c.purpose,
    amount: (c.approvedAmount ?? c.amount).toFixed(2),
  }));
  const claimsTotal = extras.claims.reduce((t, c) => t.plus(c.approvedAmount ?? c.amount), ZERO);
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
    {
      label: i.claims.length
        ? `Claims paid back (${i.claims.map((c) => c.number).join(", ")})`
        : "Claims paid back",
      amount: i.reimbursements,
    },
  ].filter((e, index) => index === 0 || e.amount.gt(0));
  const deductions = [
    {
      label: `Unpaid days (${i.unpaidDays.toNumber()} x ${rate.toFixed(2)})`,
      amount: i.unpaidLeaveDeduction,
      reason: unpaidDaysText(i) || null,
    },
    {
      label: "Advance recovery",
      amount: i.advanceDeduction,
      reason: extras.advances.length
        ? `${run.status === "DRAFT" ? "Towards" : "Taken back on"} ${listText(extras.advances)}`
        : null,
    },
    { label: "Tax deducted (TDS)", amount: i.taxDeduction, reason: null },
    { label: "Other deductions", amount: i.otherDeductions, reason: i.deductionReason },
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
    deductions: deductions.map((d) => ({
      label: d.label,
      amount: d.amount.toFixed(2),
      /** Why it is taken: the days, the advance numbers or the reason typed in. */
      reason: d.reason,
    })),
    /** Each staff claim paid back with the salary: the day, what it was for and how much. */
    claims,
    claimsTotal: claimsTotal.toFixed(2),
    /**
     * A draft only: the claims waiting to be paid back no longer add up to the
     * line (one was approved or paid meanwhile); recalculating catches up.
     */
    claimsChanged: run.status === "DRAFT" && !claimsTotal.equals(i.reimbursements),
    totalEarnings: totalEarnings.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netPay: i.netPay.toFixed(2),
    netPayInWords: amountInWords(i.netPay, ctx.company.currency),
    payment: paymentOf(run, i),
    note: i.note,
  };
}

/** How a line stands: paid (when, how), paid in part so far, or not paid; with each part. */
function paymentOf(run: { status: string }, i: ItemRow) {
  const parts = i.paymentLines.map((l) => ({
    number: l.payment.number,
    date: l.payment.date,
    method: l.payment.method,
    amount: l.amount.toFixed(2),
    payout: l.payout,
  }));
  const common = { paid: i.paidAmount.toFixed(2), balance: balanceOf(i).toFixed(2), parts };
  if (i.payment) {
    return {
      status: "PAID" as const,
      number: i.payment.number,
      date: i.payment.date,
      method: i.payment.method,
      ...common,
    };
  }
  if (i.paidAmount.gt(0)) return { status: "PART_PAID" as const, ...common };
  return {
    status: run.status === "DRAFT" ? ("DRAFT" as const) : ("UNPAID" as const),
    ...common,
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

/**
 * A payslip by its payroll line alone (printing): any line for the people who see
 * salaries, otherwise only the signed-in employee's own from an approved payroll.
 */
export async function getPayslipByItem(ctx: CompanyContext, itemId: string) {
  if (!canSeeSalaries(ctx)) return myPayslip(ctx, itemId);
  const item = await prisma.payrollItem.findFirst({
    where: { id: itemId, run: { companyId: ctx.company.id } },
    select: { runId: true },
  });
  if (!item) throw new AppError("NOT_FOUND", "Payslip not found.");
  return getPayslip(ctx, item.runId, itemId);
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
    paidAmount: i.paidAmount.toFixed(2),
    balance: balanceOf(i).toFixed(2),
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
