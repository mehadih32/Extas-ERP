import { TruckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import {
  isMaterialsFiltered,
  materialsListSearch,
  purchaseListQuery,
  purchaseViewFrom,
} from "@/components/materials/list-view";
import { MaterialsFilters } from "@/components/materials/materials-filters";
import { MaterialsNoAccess, PricesNoAccess } from "@/components/materials/no-access";
import { PurchaseList } from "@/components/materials/purchase-list";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getPurchaseListAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Purchases" };

/**
 * Raw material purchases (the suppliers' bills), newest first, like GET
 * /api/materials/purchases: materials.view with the prices (buyers,
 * Production Managers, Accounts). Receiving goods is for buyers and Accounts.
 */
export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  if (!ctx.can("materials.view")) return <MaterialsNoAccess />;
  const view = purchaseViewFrom(await searchParams);
  const result = await getPurchaseListAction(purchaseListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <PricesNoAccess />;
    return (
      <SectionError title="Purchases" heading="The purchases could not load" error={result.error} />
    );
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="purchases-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="purchases-heading" className="font-serif text-2xl text-primary">
            Purchases
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every supplier bill for materials that came into the store, with what is still owed on
            it.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={materialsHref.newPurchase()}>
              <TruckIcon aria-hidden />
              Receive goods
            </Link>
          </Button>
        )}
      </div>

      <MaterialsFilters view={view}>
        {items.length === 0 ? (
          isMaterialsFiltered(view) ? (
            <EmptyState title="No purchases match">Clear the filter to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No purchases yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href={materialsHref.newPurchase()}>Receive the first goods</Link>
                  </Button>
                ) : undefined
              }
            >
              Goods are received with the supplier&apos;s bill: they go into the store at its price,
              and the bill goes on the supplier&apos;s account.
            </EmptyState>
          )
        ) : (
          <PurchaseList
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
