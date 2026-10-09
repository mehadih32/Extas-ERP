import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { IntakeList } from "@/components/production/intake-list";
import {
  deliveryListQuery,
  deliveryViewFrom,
  isProductionFiltered,
  productionListSearch,
} from "@/components/production/list-view";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ProductionFilters } from "@/components/production/production-filters";
import { Button } from "@/components/ui/button";
import { getIntakeListAction } from "@/server/actions/production.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Factory deliveries" };

/**
 * Factory deliveries (Move to Stock), newest first, for production.view or
 * production.stock_intake like GET /api/production/intakes. Receiving goods is
 * offered to production.stock_intake, the permission createIntakeAction checks.
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = deliveryViewFrom(await searchParams);
  const result = await getIntakeListAction(deliveryListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <ProductionNoAccess />;
    return (
      <SectionError
        title="Deliveries"
        heading="The deliveries could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="deliveries-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="deliveries-heading" className="font-serif text-2xl text-primary">
            Factory deliveries
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Finished pieces coming in from the factories, counted by colour and size, A-grade and
            B-grade apart, and moved into stock.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/production/deliveries/new">
              <PlusIcon aria-hidden />
              Receive goods
            </Link>
          </Button>
        )}
      </div>

      <ProductionFilters view={view}>
        {items.length === 0 ? (
          isProductionFiltered(view) ? (
            <EmptyState title="No deliveries match">Clear the filter to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No deliveries yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href="/production/deliveries/new">Receive the first delivery</Link>
                  </Button>
                ) : undefined
              }
            >
              When a factory sends finished pieces, count them in here to put them into stock.
            </EmptyState>
          )
        ) : (
          <IntakeList
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
