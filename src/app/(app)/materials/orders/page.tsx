import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { materialsHref } from "@/components/materials/labels";
import {
  isMaterialsFiltered,
  materialsListSearch,
  orderListQuery,
  orderViewFrom,
} from "@/components/materials/list-view";
import { MaterialsFilters } from "@/components/materials/materials-filters";
import { MaterialsNoAccess } from "@/components/materials/no-access";
import { OrderList } from "@/components/materials/order-list";
import { EmptyState } from "@/components/products/bits";
import { Button } from "@/components/ui/button";
import { getOrderListAction } from "@/server/actions/materials.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Purchase orders" };

/**
 * Purchase orders for raw materials, newest first, like GET
 * /api/materials/purchase-orders (materials.view): by status, late ones, one
 * supplier's or one material's. Amounts show to people who see material
 * prices; raising an order is for buyers (materials.purchase).
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = orderViewFrom(await searchParams);
  const result = await getOrderListAction(orderListQuery(view));
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <MaterialsNoAccess />;
    return (
      <SectionError
        title="Orders"
        heading="The purchase orders could not load"
        error={result.error}
      />
    );
  }
  const { items, nextCursor, supplier, material, seeCosts, canCreate } = result.data;
  const named = material
    ? { text: `Orders for ${material.code} · ${material.name}`, clear: "All orders" }
    : supplier
      ? { text: `Orders from ${supplier.name}`, clear: "All orders" }
      : null;
  const newHref = materialsHref.newOrder({ material: material?.id, supplier: supplier?.id });

  return (
    <section aria-labelledby="orders-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="orders-heading" className="font-serif text-2xl text-primary">
            Purchase orders
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            What has been ordered from suppliers and what is still to arrive. Goods are received
            against the order when they come in.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={newHref}>
              <PlusIcon aria-hidden />
              New purchase order
            </Link>
          </Button>
        )}
      </div>

      <MaterialsFilters view={view} named={named}>
        {items.length === 0 ? (
          isMaterialsFiltered(view) ? (
            <EmptyState title="No orders match">Clear the filters to see them all.</EmptyState>
          ) : (
            <EmptyState
              title="No purchase orders yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href={newHref}>Raise the first order</Link>
                  </Button>
                ) : undefined
              }
            >
              An order tells the supplier what to send and at what price, and keeps track of what
              has arrived.
            </EmptyState>
          )
        ) : (
          <OrderList
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
