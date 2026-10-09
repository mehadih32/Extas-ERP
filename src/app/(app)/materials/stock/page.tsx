import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import {
  isMaterialsFiltered,
  materialsListSearch,
  stockListQuery,
  stockViewFrom,
} from "@/components/materials/list-view";
import { MaterialList } from "@/components/materials/material-list";
import { MaterialsFilters } from "@/components/materials/materials-filters";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getMaterialListAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Stock" };

/**
 * Every raw material with what is on hand, like GET /api/materials
 * (materials.view): by kind, by store, running low or archived too. Average
 * costs and values show to people who see material prices. Adding a material
 * is for the store and buyers (materials.manage or materials.purchase).
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = stockViewFrom(await searchParams);
  const result = await getMaterialListAction(stockListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return <SectionError title="Stock" heading="The stock could not load" error={result.error} />;
  }
  const { items, nextCursor, stores, seeCosts, canCreate } = result.data;

  return (
    <section aria-labelledby="stock-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="stock-heading" className="font-serif text-2xl text-primary">
            Stock
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every material the store keeps, with what is on hand and on order. Open one for its
            stock card.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={materialsHref.newMaterial}>
              <PlusIcon aria-hidden />
              Add a material
            </Link>
          </Button>
        )}
      </div>

      <MaterialsFilters view={view} stores={stores}>
        {items.length === 0 ? (
          isMaterialsFiltered(view) ? (
            <EmptyState title="No materials match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No materials yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href={materialsHref.newMaterial}>Add the first material</Link>
                  </Button>
                ) : undefined
              }
            >
              Fabric, trims, accessories and packaging are added once, then bought, counted and
              issued to production.
            </EmptyState>
          )
        ) : (
          <MaterialList
            key={materialsListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            currency={ctx.company.currency}
            seeCosts={seeCosts}
          />
        )}
      </MaterialsFilters>
    </section>
  );
}
