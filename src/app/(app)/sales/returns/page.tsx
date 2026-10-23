import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import {
  isSalesFiltered,
  returnListQuery,
  returnViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { ReturnList } from "@/components/sales/return-list";
import { SalesFilters } from "@/components/sales/sales-filters";
import { Button } from "@/components/ui/button";
import { getSalesReturnListAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Sales returns" };

/**
 * Sales returns (credit notes), newest first, for sales.view like GET
 * /api/sales/returns. Recording one is offered only to Accounts
 * (accounts.receipts.record), the permission the action checks.
 */
export default async function SalesReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = returnViewFrom(await searchParams);
  const result = await getSalesReturnListAction(returnListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Sales returns"
        heading="The sales returns could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor, canRecord } = result.data;
  const filtered = isSalesFiltered(view);

  return (
    <section aria-labelledby="returns-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="returns-heading" className="font-serif text-2xl text-primary">
            Sales returns
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Goods buyers sent back, each on a credit note made from its invoice. The value goes to
            the buyer&apos;s credit and the pieces to Damage &amp; QC Rejects, or back into stock
            when the website shop&apos;s check found them good.
          </p>
        </div>
        {canRecord && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/sales/returns/new">
              <PlusIcon aria-hidden />
              New sales return
            </Link>
          </Button>
        )}
      </div>

      <SalesFilters view={view}>
        {items.length === 0 ? (
          <EmptyState title={filtered ? "No returns match" : "No sales returns yet"}>
            {filtered
              ? "Try another search or other days, or clear the filters."
              : "A return shows here once Accounts records goods coming back on an invoice."}
          </EmptyState>
        ) : (
          <ReturnList
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
