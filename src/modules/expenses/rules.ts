import type { PaymentType } from "@prisma/client";

import { ALLOWED, refuse, type Verdict } from "@/lib/verdict";
import type { ExpenseStatus } from "@/modules/expenses/schemas";
import type { PermissionKey } from "@/modules/rbac/permissions";

/*
 * What may be done with an expense or a claim from where it stands, given the
 * person's keys and whether they recorded it. The expense service refuses with
 * these answers and the Expenses screens read the same answers to decide what
 * to offer.
 */

type Can = { can: (permission: PermissionKey) => boolean };

type ExpenseState = {
  number: string;
  status: ExpenseStatus;
  paymentType: PaymentType;
  /** Recorded by the person asking. */
  own: boolean;
};

/** Accounts pays a waiting claim back, or puts a Due one on the supplier's account. */
export function canApproveExpense(ctx: Can, expense: ExpenseState): Verdict {
  if (!ctx.can("accounts.payments.record")) {
    return refuse("FORBIDDEN", "Only Accounts can approve expense claims.");
  }
  if (expense.status !== "PENDING") {
    return refuse("CONFLICT", `${expense.number} is not a waiting claim.`);
  }
  return ALLOWED;
}

/** Accounts and expense managers turn a waiting claim down; its author can withdraw it. */
export function canRejectExpense(ctx: Can, expense: ExpenseState): Verdict {
  if (!expense.own && !ctx.can("accounts.payments.record") && !ctx.can("expenses.manage")) {
    return refuse("FORBIDDEN", "Only Accounts can turn down someone else's claim.");
  }
  if (expense.status !== "PENDING") {
    return refuse("CONFLICT", `${expense.number} is not a waiting claim.`);
  }
  return ALLOWED;
}

/**
 * An expense in the books is voided (its entry reversed). Undoing a cash
 * payment puts money back into an account, so it needs both money keys.
 */
export function canVoidExpense(ctx: Can, expense: ExpenseState): Verdict {
  if (!ctx.can("expenses.manage")) {
    return refuse("FORBIDDEN", "Only Accounts can void expenses.");
  }
  if (expense.status === "PENDING") {
    return refuse("CONFLICT", `${expense.number} is a claim; reject it instead.`);
  }
  if (expense.status !== "POSTED") {
    return refuse("CONFLICT", `${expense.number} is already ${expense.status.toLowerCase()}.`);
  }
  if (expense.paymentType === "CASH_BANK") {
    if (!ctx.can("accounts.payments.record")) {
      return refuse("FORBIDDEN", "Only Accounts can record money paid out.");
    }
    if (!ctx.can("accounts.receipts.record")) {
      return refuse("FORBIDDEN", "Only Accounts can record money received.");
    }
  }
  return ALLOWED;
}

/**
 * Expense managers edit any expense; others their own claims while they wait.
 * The amount, head and date only change while it is a claim.
 */
export function canEditExpense(
  ctx: Can,
  expense: ExpenseState,
  change: { money: boolean } = { money: false },
): Verdict {
  if (!ctx.can("expenses.manage") && !(expense.own && expense.status === "PENDING")) {
    return refuse("FORBIDDEN", "You can only change your own claims while they wait.");
  }
  if (expense.status === "REJECTED" || expense.status === "VOID") {
    return refuse("CONFLICT", `${expense.number} is ${expense.status.toLowerCase()}.`);
  }
  if (expense.status === "POSTED" && change.money) {
    return refuse(
      "CONFLICT",
      `${expense.number} is in the books; void it and record it again to change the amount, head or date.`,
    );
  }
  return ALLOWED;
}
