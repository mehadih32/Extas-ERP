import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { AutoRefresh } from "@/components/sales/auto-refresh";
import { SalesNoAccess } from "@/components/sales/no-access";
import { OverviewFigures } from "@/components/sales/overview-figures";
import { OrderPeekList } from "@/components/sales/overview-lists";
import { Button } from "@/components/ui/button";
import { getSalesOverviewAction } from "@/server/actions/sales.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Sales overview" };

/**
 * The Sales front page for sales.view: today's figures (refreshed every
 * minute), the latest orders and the next ones due to ship, each with a
 * slide-out quick view. Taking an order is offered to sales.order.create.
 */
export default async function SalesOverviewPage() {
  await requireCompanyPage();
  const result = await getSalesOverviewAction();
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") return <SalesNoAccess />;
    return (
      <SectionError
        title="Overview"
        heading="The sales figures could not load"
        error={result.error}
      />
    );
  }
  const overview = result.data;

  return (
    <section aria-labelledby="overview-heading" className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="overview-heading" className="font-serif text-2xl text-primary">
            Today in sales
          </h2>
          <AutoRefresh updatedAt={overview.updatedAt} />
        </div>
        {overview.canCreate && (
          <Button asChild className="w-full sm:w-auto">
            <Link href="/sales/orders/new">
              <PlusIcon aria-hidden />
              New order
            </Link>
          </Button>
        )}
      </div>

      <OverviewFigures overview={overview} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrderPeekList
          id="recent-orders"
          title="Latest orders"
          kind="recent"
          orders={overview.recent}
          empty="No orders yet."
          currency={overview.currency}
          today={overview.today}
        />
        <OrderPeekList
          id="due-to-ship"
          title="Due to ship"
          kind="shipping"
          orders={overview.shipping}
          empty="No open order has a ship-by day."
          currency={overview.currency}
          today={overview.today}
        />
      </div>
    </section>
  );
}
