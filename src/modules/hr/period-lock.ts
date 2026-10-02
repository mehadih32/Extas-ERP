import type { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { monthKey, monthLabel } from "@/modules/hr/calendar";

/*
 * Once a month's payroll is approved its figures are in the books, so the
 * attendance, leave, holidays and salaries it was worked out from are frozen
 * until the payroll is reopened. Changes and payroll approvals for the same
 * month take the same lock, so neither can slip past the other.
 */

type Tx = Prisma.TransactionClient;

const toYearMonth = (month: string) => ({
  year: Number(month.slice(0, 4)),
  month: Number(month.slice(5, 7)),
});

/** Holds a lock on each month ("2026-10") until the transaction ends. */
export async function lockPayrollMonths(tx: Tx, companyId: string, months: string[]) {
  for (const month of [...new Set(months)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payroll:${companyId}:${month}`}))`;
  }
}

/** Refuses a change touching months whose payroll is approved or paid. */
export async function assertMonthsOpen(tx: Tx, companyId: string, months: string[], what: string) {
  const unique = [...new Set(months)];
  if (unique.length === 0) return;
  await lockPayrollMonths(tx, companyId, unique);
  const closed = await tx.payrollRun.findFirst({
    where: { companyId, status: { not: "DRAFT" }, OR: unique.map(toYearMonth) },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  if (closed) {
    throw new AppError(
      "CONFLICT",
      `The payroll for ${monthLabel(monthKey(closed.year, closed.month))} is approved, so ${what} in that month cannot change. Reopen that payroll first.`,
    );
  }
}

/** Like assertMonthsOpen for `fromMonth` and every later month that has a payroll. */
export async function assertOpenFrom(tx: Tx, companyId: string, fromMonth: string, what: string) {
  const { year, month } = toYearMonth(fromMonth);
  const later = await tx.payrollRun.findMany({
    where: { companyId, OR: [{ year: { gt: year } }, { year, month: { gte: month } }] },
    select: { year: true, month: true },
  });
  await assertMonthsOpen(
    tx,
    companyId,
    [fromMonth, ...later.map((r) => monthKey(r.year, r.month))],
    what,
  );
}
