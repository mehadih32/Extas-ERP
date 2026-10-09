import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExpenseForm } from "@/components/accounts/expense-form";
import { accountsHref } from "@/components/accounts/labels";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { BackLink } from "@/components/settings/back-link";
import { getExpenseFormAction } from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Change an expense" };

/**
 * Changing an expense: expense managers change any; others their own claims
 * while they wait (expenses/rules.ts, as updateExpenseAction checks).
 */
export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ expenseId: string }>;
}) {
  const ctx = await requireCompanyPage();
  const { expenseId } = await params;
  const result = await getExpenseFormAction(expenseId);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="You cannot change this expense">
          {result.error.message}
        </AccountsNoAccess>
      );
    }
    if (result.error.code === "CONFLICT") {
      return (
        <div className="grid gap-6">
          <BackLink href={accountsHref.expense(expenseId)}>Back to the expense</BackLink>
          <FormAlert tone="note">{result.error.message}</FormAlert>
        </div>
      );
    }
    return <SectionError title="Expense" heading="The form could not load" error={result.error} />;
  }
  const expense = result.data.expense!;

  return (
    <div className="grid gap-6">
      <BackLink href={accountsHref.expense(expense.id)}>{expense.number}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Change {expense.number}</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {expense.status === "PENDING"
            ? "Everything can change while it waits for Accounts."
            : "Who and what it was for, its details and its receipt."}
        </p>
      </div>
      <ExpenseForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
