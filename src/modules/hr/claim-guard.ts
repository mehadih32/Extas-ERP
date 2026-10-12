import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";
import { monthKey, monthLabel } from "@/modules/hr/calendar";

/**
 * Refuses to void the expense of a staff claim that was already paid back, or
 * that an approved payroll pays back with a salary: voiding it would leave
 * the employee owing what Accounts paid them, or the salary paying a claim
 * that no longer exists. Used by the Accounts expense void and the production
 * cost void.
 */
export async function assertClaimNotPaidBack(
  db: Db,
  expense: { id: string; number: string },
): Promise<void> {
  const claim = await db.staffClaim.findUnique({
    where: { expenseId: expense.id },
    select: {
      number: true,
      paidAt: true,
      payrollItem: { select: { run: { select: { year: true, month: true } } } },
    },
  });
  if (claim?.paidAt) {
    throw new AppError(
      "CONFLICT",
      `${expense.number} is staff claim ${claim.number}, already paid back, so it can't be voided.`,
    );
  }
  if (claim?.payrollItem) {
    const month = monthLabel(monthKey(claim.payrollItem.run.year, claim.payrollItem.run.month));
    throw new AppError(
      "CONFLICT",
      `${expense.number} is staff claim ${claim.number}, paid back with the ${month} salary. Reopen that payroll first to void it.`,
    );
  }
}
