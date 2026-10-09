import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { InvoiceList } from "@/components/sales/invoice-list";
import {
  invoiceListQuery,
  invoiceViewFrom,
  isSalesFiltered,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { SalesFilters } from "@/components/sales/sales-filters";
import { listInvoiceRowsAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Invoices" };

/**
 * Commercial invoices, newest first, with what is paid and due, for sales.view
 * like GET /api/sales/invoices. They are issued from orders.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = invoiceViewFrom(await searchParams);
  const result = await listInvoiceRowsAction(invoiceListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError title="Invoices" heading="The invoices could not load" error={result.error} />
    );
  }
  const { items, nextCursor } = result.data;

  return (
    <section aria-labelledby="invoices-heading" className="grid gap-6">
      <div>
        <h2 id="invoices-heading" className="font-serif text-2xl text-primary">
          Invoices
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Every commercial invoice with what is paid and still due. Overdue ones are past their due
          day with money owing.
        </p>
      </div>

      <SalesFilters view={view}>
        {items.length === 0 ? (
          isSalesFiltered(view) ? (
            <EmptyState title="No invoices match">
              Try an invoice or order number, or part of a buyer&apos;s name, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState title="No invoices yet">
              Orders are invoiced when they are taken, and their invoices show here.
            </EmptyState>
          )
        ) : (
          <InvoiceList
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
