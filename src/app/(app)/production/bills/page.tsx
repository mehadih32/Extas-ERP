import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { BillList } from "@/components/production/bill-list";
import {
  billListQuery,
  billViewFrom,
  isProductionFiltered,
  productionListSearch,
} from "@/components/production/list-view";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProductionFilters } from "@/components/production/production-filters";
import { Button } from "@/components/ui/button";
import { getBillListAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Supplier bills" };

/**
 * Supplier bills for production, newest first, like GET /api/production/bills:
 * production.view with the costs (production.manage or accounts.view). Entering
 * one is offered to production.manage and accounts.payments.record, the
 * permissions createBillAction checks.
 */
export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = billViewFrom(await searchParams);
  const result = await getBillListAction(billListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Production costs are not part of your role">
          Supplier bills show to Production Managers and Accounts.
        </ProductionNoAccess>
      );
    }
    return <SectionError title="Bills" heading="The bills could not load" error={result.error} />;
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="bills-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="bills-heading" className="font-serif text-2xl text-primary">
            Supplier bills
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Bills from factories, mills and other suppliers, shared across the projects they are
            for, with what is still owed.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/production/bills/new">
              <PlusIcon aria-hidden />
              Enter a bill
            </Link>
          </Button>
        )}
      </div>

      <ProductionFilters view={view}>
        {items.length === 0 ? (
          isProductionFiltered(view) ? (
            <EmptyState title="No bills match">Clear the filter to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No bills yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href="/production/bills/new">Enter the first bill</Link>
                  </Button>
                ) : undefined
              }
            >
              A supplier&apos;s bill is entered once and shared across the projects it is for.
            </EmptyState>
          )
        ) : (
          <BillList
            key={productionListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </ProductionFilters>
    </section>
  );
}
