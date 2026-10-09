import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import {
  isSalesFiltered,
  proformaListQuery,
  proformaViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { ProformaList } from "@/components/sales/quotation-list";
import { SalesFilters } from "@/components/sales/sales-filters";
import { listProformaRowsAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Proforma invoices" };

/**
 * Proforma invoices, newest first, for sales.view like GET /api/sales/proformas.
 * They are made from quotations, so this tab only lists them.
 */
export default async function ProformasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = proformaViewFrom(await searchParams);
  const result = await listProformaRowsAction(proformaListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Proforma invoices"
        heading="The proforma invoices could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor } = result.data;

  return (
    <section aria-labelledby="proformas-heading" className="grid gap-6">
      <div>
        <h2 id="proformas-heading" className="font-serif text-2xl text-primary">
          Proforma invoices
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          B2B pre-orders: each asks for an advance, starts production once it is paid, and becomes
          an order when the goods are ready. Make one from an accepted quotation.
        </p>
      </div>

      <SalesFilters view={view}>
        {items.length === 0 ? (
          isSalesFiltered(view) ? (
            <EmptyState title="No proforma invoices match">
              Clear the filter to see them all.
            </EmptyState>
          ) : (
            <EmptyState title="No proforma invoices yet">
              Open a quotation and choose &ldquo;Make a proforma invoice&rdquo; to ask the buyer for
              the advance.
            </EmptyState>
          )
        ) : (
          <ProformaList
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
