import type { Db } from "@/lib/db-types";
import { AppError } from "@/lib/errors";

/**
 * Refuses to void the expense of a staff claim that was already paid back:
 * voiding it would leave the employee owing what Accounts paid them. Used by
 * the Accounts expense void and the production cost void.
 */
export async function assertClaimNotPaidBack(
  db: Db,
  expense: { id: string; number: string },
): Promise<void> {
  const claim = await db.staffClaim.findUnique({
    where: { expenseId: expense.id },
    select: { number: true, paidAt: true },
  });
  if (claim?.paidAt) {
    throw new AppError(
      "CONFLICT",
      `${expense.number} is staff claim ${claim.number}, already paid back, so it can't be voided.`,
    );
  }
}
