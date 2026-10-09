import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccountsFilters } from "@/components/accounts/accounts-filters";
import { JournalList } from "@/components/accounts/journal-list";
import {
  accountsListSearch,
  isAccountsFiltered,
  journalListQuery,
  journalViewFrom,
} from "@/components/accounts/list-view";
import { AccountsNoAccess } from "@/components/accounts/no-access";
import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getJournalListAction } from "@/server/actions/accounts.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Journal" };

/**
 * Every journal entry, newest first (accounts.view, like GET
 * /api/accounts/journal): sales, payments, bills, expenses and vouchers
 * written by hand. Writing a voucher is offered with accounts.manage.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = journalViewFrom(await searchParams);
  const result = await getJournalListAction(journalListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <AccountsNoAccess />;
    return (
      <SectionError title="Journal" heading="The journal could not load" error={result.error} />
    );
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="journal-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="journal-heading" className="font-serif text-2xl text-primary">
            Journal
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every entry in the books, each with equal debits and credits. Sales, payments, bills and
            expenses make their own; a journal voucher is written by hand.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/accounts/journal/new">
              <PlusIcon aria-hidden />
              New journal voucher
            </Link>
          </Button>
        )}
      </div>

      <AccountsFilters view={view}>
        {items.length === 0 ? (
          isAccountsFiltered(view) ? (
            <EmptyState title="No entries match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState title="No journal entries yet">
              Entries appear as sales, payments, bills and expenses are recorded.
            </EmptyState>
          )
        ) : (
          <JournalList
            key={accountsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </AccountsFilters>
    </section>
  );
}
