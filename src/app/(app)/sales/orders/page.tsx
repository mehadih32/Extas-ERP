import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import {
  isSalesFiltered,
  orderListQuery,
  orderViewFrom,
  salesListSearch,
} from "@/components/sales/list-view";
import { SalesNoAccess } from "@/components/sales/no-access";
import { OrderList } from "@/components/sales/order-list";
import { SalesFilters } from "@/components/sales/sales-filters";
import { Button } from "@/components/ui/button";
import { getOrderListAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Orders" };

/**
 * Orders from every channel, newest first, for sales.view like GET
 * /api/sales/orders. Taking one is offered to sales.order.create, the
 * permission createOrderAction checks.
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
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return <SectionError title="Orders" heading="The orders could not load" error={result.error} />;
  }
  const { items, nextCursor, canCreate } = result.data;

  return (
    <section aria-labelledby="orders-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="orders-heading" className="font-serif text-2xl text-primary">
            Orders
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Wholesale, counter and social orders, with their invoice and what is still due. Open one
            to deliver it, take payment or print its documents.
          </p>
        </div>
        {canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/sales/orders/new">
              <PlusIcon aria-hidden />
              New order
            </Link>
          </Button>
        )}
      </div>

      <SalesFilters view={view}>
        {items.length === 0 ? (
          isSalesFiltered(view) ? (
            <EmptyState title="No orders match">
              Try an order number, part of a buyer&apos;s name or a phone number, or clear the
              filters.
            </EmptyState>
          ) : (
            <EmptyState
              title="No orders yet"
              action={
                canCreate ? (
                  <Button asChild>
                    <Link href="/sales/orders/new">Take the first order</Link>
                  </Button>
                ) : undefined
              }
            >
              Orders show here once they are taken, with their invoice and what is still due.
            </EmptyState>
          )
        ) : (
          <OrderList
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
