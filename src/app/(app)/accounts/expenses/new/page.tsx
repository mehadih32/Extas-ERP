import type { Metadata } from "next";

import { ExpenseForm } from "@/components/accounts/expense-form";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { BackLink } from "@/components/settings/back-link";
import { getExpenseFormAction } from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Record an expense" };

/**
 * A new expense (expenses.create, as createExpenseAction checks). Accounts'
 * expenses go into the books, and so does a cost paid from a petty cash box by
 * its holder ("?box=" chooses the box); anyone else's are claims for Accounts
 * to pay back.
 */
export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const { box } = await searchParams;
  const result = await getExpenseFormAction(undefined, typeof box === "string" ? box : undefined);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Recording expenses is not part of your role">
          Your administrator can give your role the permission to record expenses.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError
        title="Record an expense"
        heading="The form could not load"
        error={result.error}
      />
    );
  }
  const claim = !result.data.can.payNow;
  const pettyCash = claim && result.data.boxes.length > 0;

  return (
    <div className="grid gap-6">
      <BackLink href="/accounts/expenses">{claim ? "My expenses" : "All expenses"}</BackLink>
      <div>
        <h2 className="font-serif text-2xl text-primary">
          {claim && !pettyCash ? "Claim an expense" : "Record an expense"}
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {pettyCash
            ? "A cost paid from your petty cash box goes into the books now. Money you spent yourself is a claim Accounts pays back."
            : claim
              ? "What you spent for the company. Add a photo of the receipt so Accounts can approve it quickly."
              : "A running cost paid now or owed to a supplier. Production costs go on their project instead."}
        </p>
      </div>
      <ExpenseForm form={result.data} currency={ctx.company.currency} />
    </div>
  );
}
