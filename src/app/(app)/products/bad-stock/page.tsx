import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { BadStockScreen } from "@/components/products/bad-stock-screen";
import {
  BAD_STOCK_PAGE_SIZE,
  badStockDays,
  badStockPeriodFrom,
} from "@/components/products/bad-stock-view";
import { NoAccess } from "@/components/settings/no-access";
import { localDay } from "@/lib/dates";
import { listBadStockAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Bad stock" };

/**
 * Bad stock (inventory.view, like GET /api/inventory/stock/bad-stock): the losses
 * in pieces for everyone, in money only for people who see the financials.
 * Recording it needs inventory.manage, as moveToBadStockAction checks.
 */
export default async function BadStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const period = badStockPeriodFrom(await searchParams);
  const range = badStockDays(
    period,
    localDay(new Date(), ctx.company.timezone),
    ctx.company.fiscalYearStartMonth,
  );
  const result = await listBadStockAction({ ...range, take: BAD_STOCK_PAGE_SIZE });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Products are not part of your role">
          Your administrator can give your role the permission to see the stock and the product
          matrix.
        </NoAccess>
      );
    }
    return (
      <SectionError title="Bad stock" heading="The bad stock could not load" error={result.error} />
    );
  }

  return (
    <section aria-labelledby="bad-heading" className="grid gap-6">
      <div>
        <h2 id="bad-heading" className="font-serif text-2xl text-primary">
          Bad stock
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Pieces taken out of the sellable stock: damaged, rejected or failed checks. Their cost is
          booked as an inventory loss.
        </p>
      </div>
      <BadStockScreen
        page={result.data}
        period={period}
        range={range}
        canManage={ctx.can("inventory.manage")}
        currency={ctx.company.currency}
        timeZone={ctx.company.timezone}
      />
    </section>
  );
}
