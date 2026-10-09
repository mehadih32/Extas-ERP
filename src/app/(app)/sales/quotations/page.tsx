import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import {
  isSalesFiltered,
  quotationListQuery,
  quotationViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { QuotationList } from "@/components/sales/quotation-list";
import { SalesFilters } from "@/components/sales/sales-filters";
import { Button } from "@/components/ui/button";
import { getQuotationListAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Quotations" };

/**
 * Quotations, newest first, for sales.view like GET /api/sales/quotations.
 * Writing one is offered to sales.quotation.manage, the permission
 * createQuotationAction checks.
 */
export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = quotationViewFrom(await searchParams);
  const result = await getQuotationListAction(quotationListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Quotations"
        heading="The quotations could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="quotations-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="quotations-heading" className="font-serif text-2xl text-primary">
            Quotations
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Prices offered to buyers, with sizes and styling notes. An accepted quotation becomes a
            proforma invoice asking for the advance.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/sales/quotations/new">
              <PlusIcon aria-hidden />
              New quotation
            </Link>
          </Button>
        )}
      </div>

      <SalesFilters view={view}>
        {items.length === 0 ? (
          isSalesFiltered(view) ? (
            <EmptyState title="No quotations match">
              Try a quotation number or part of a buyer&apos;s name, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              title="No quotations yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href="/sales/quotations/new">Write the first quotation</Link>
                  </Button>
                ) : undefined
              }
            >
              Quotations show here once they are written.
            </EmptyState>
          )
        ) : (
          <QuotationList
            key={salesListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </SalesFilters>
    </section>
  );
}
