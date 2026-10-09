import type { Metadata } from "next";

import { ExpenseHeads } from "@/components/accounts/expense-heads";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getExpenseHeadsScreenAction } from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Expense heads" };

/**
 * The heads expenses are filed under (like GET /api/expense-heads). Everyone
 * who records expenses may read them; adding and changing them is for
 * expenses.manage, as the head actions check.
 */
export default async function ExpenseHeadsPage() {
  await requireCompanyPage();
  const result = await getExpenseHeadsScreenAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Expenses are not part of your role">
          {result.error.message}
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Expense heads"
        heading="The expense heads could not load"
        error={result.error}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/expenses">All expenses</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">Expense heads</h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Each expense is filed under a head, and each head posts to an expense account in the
          books, so the profit and loss shows where the money went.
        </p>
      </div>
      <ExpenseHeads screen={result.data} />
    </div>
  );
}
