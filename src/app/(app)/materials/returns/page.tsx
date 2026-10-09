import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import {
  isMaterialsFiltered,
  materialsListSearch,
  returnListQuery,
  returnViewFrom,
} from "@/components/materials/list-view";
import { MaterialsFilters } from "@/components/materials/materials-filters";
import { MaterialsNoAccess, PricesNoAccess } from "@/components/materials/no-access";
import { ReturnList } from "@/components/materials/return-list";
import { EmptyState } from "@/components/products/bits";
import { getReturnListAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Supplier returns" };

/**
 * Goods sent back to suppliers (debit notes), newest first, void ones marked,
 * like GET /api/materials/supplier-returns: materials.view with the prices. A
 * return is made from its purchase.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.view")) return <MaterialsNoAccess />;
  const view = returnViewFrom(await searchParams);
  const result = await getReturnListAction(returnListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <PricesNoAccess />;
    return (
      <SectionError title="Returns" heading="The returns could not load" error={result.error} />
    );
  }
  const { items, nextCursor } = result.data;

  return (
    <section aria-labelledby="returns-heading" className="grid gap-6">
      <div>
        <h2 id="returns-heading" className="font-serif text-2xl text-primary">
          Supplier returns
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Goods sent back to suppliers, each credited to their account. To send something back, open
          the purchase it came on.
        </p>
      </div>

      <MaterialsFilters
        view={view}
        named={view.supplier ? { text: "One supplier's returns", clear: "All returns" } : null}
      >
        {items.length === 0 ? (
          isMaterialsFiltered(view) ? (
            <EmptyState title="No returns match">Clear the filter to see them all.</EmptyState>
          ) : (
            <EmptyState title="Nothing sent back yet">
              Faulty or wrong goods go back from the purchase they came on, at its price.
            </EmptyState>
          )
        ) : (
          <ReturnList
            key={materialsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
          />
        )}
      </MaterialsFilters>
    </section>
  );
}
