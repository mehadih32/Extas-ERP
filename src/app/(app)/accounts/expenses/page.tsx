import { CoinsIcon, PlusIcon, TagsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccountsFilters } from "@/components/accounts/accounts-filters";
import { ExpenseList } from "@/components/accounts/expense-list";
import { pettyCashHref } from "@/components/accounts/labels";
import {
  accountsListSearch,
  expenseListQuery,
  expenseViewFrom,
  isAccountsFiltered,
} from "@/components/accounts/list-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { money } from "@/components/sales/labels";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/display";
import { getExpenseListAction } from "@/server/actions/expenses.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Expenses" };

/**
 * Expenses and claims, newest first (like GET /api/expenses). Accounts and
 * expense managers see everyone's; anyone else who records expenses sees their
 * own claims. Recording one is offered with expenses.create.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = expenseViewFrom(await searchParams);
  const result = await getExpenseListAction(expenseListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <AccountsNoAccess title="Expenses are not part of your role">
          Your administrator can give your role the permission to record expenses.
        </AccountsNoAccess>
      );
    }
    return (
      <SectionError title="Expenses" heading="The expenses could not load" error={result.error} />
    );
  }
  const { items, nextCursor, heads, waiting, seesAll, boxes, can } = result.data;

  return (
    <section aria-labelledby="expenses-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="expenses-heading" className="font-serif text-2xl text-primary">
            {seesAll ? "Expenses and claims" : "My expenses"}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {seesAll
              ? "Rent, utilities, conveyance and every other running cost, with the claims waiting to be paid back."
              : boxes.length > 0
                ? "What you spent for the company: costs from your petty cash box, and claims Accounts pays back."
                : "What you spent for the company. Accounts pays each claim back once they approve it."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {can.manageHeads && (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/accounts/expenses/heads">
                <TagsIcon aria-hidden />
                Expense heads
              </Link>
            </Button>
          )}
          {can.create && (
            <Button asChild className="w-full sm:w-auto">
              <Link href="/accounts/expenses/new">
                <PlusIcon aria-hidden />
                {can.payClaims || boxes.length > 0 ? "Record an expense" : "New claim"}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {boxes.length > 0 && (
        <ul aria-label="Your petty cash" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {boxes.map((b) => (
            <li
              key={b.id}
              className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CoinsIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="eyebrow">Your petty cash</p>
                  <Link
                    href={pettyCashHref.box(b.id)}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {b.name}
                  </Link>
                  <p className="mt-1 font-serif text-xl leading-tight text-primary tabular-nums">
                    {money(b.balance, ctx.company.currency)}
                  </p>
                </div>
              </div>
              <Button asChild className="w-full sm:w-auto">
                <Link href={pettyCashHref.spend(b.id)}>Record a cost</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {waiting > 0 && view.status !== "PENDING" && (
        <FormAlert tone="note">
          {formatCount(waiting, ctx.company.currency)} {waiting === 1 ? "claim is" : "claims are"}{" "}
          waiting for Accounts.{" "}
          <Link
            href="/accounts/expenses?status=PENDING"
            className="font-medium underline underline-offset-4"
          >
            Show {waiting === 1 ? "it" : "them"}
          </Link>
        </FormAlert>
      )}

      <AccountsFilters view={view} heads={heads} seesAll={seesAll}>
        {items.length === 0 ? (
          isAccountsFiltered(view) ? (
            <EmptyState title="No expenses match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No expenses yet"
              action={
                can.create ? (
                  <Button asChild>
                    <Link href="/accounts/expenses/new">
                      {can.payClaims ? "Record the first expense" : "Send your first claim"}
                    </Link>
                  </Button>
                ) : undefined
              }
            >
              Office rent, a rickshaw to the factory, tea for a buyer visit: each expense is
              recorded once, with its receipt.
            </EmptyState>
          )
        ) : (
          <ExpenseList
            key={accountsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
            seesAll={seesAll}
          />
        )}
      </AccountsFilters>
    </section>
  );
}
