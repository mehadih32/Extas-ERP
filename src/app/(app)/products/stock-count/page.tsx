import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { CountScreen } from "@/components/products/count-screen";
import { countSearch, countViewFrom } from "@/components/products/count-sheet";
import { NoAccess } from "@/components/settings/no-access";
import { getStockCountSheetAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Stock count" };

/**
 * Stock counts and opening stock, a style at a time (inventory.manage, the
 * permission recordStockCountAction checks).
 */
export default async function StockCountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const view = countViewFrom(await searchParams);
  const result = await getStockCountSheetAction({
    styleId: view.style,
    warehouseId: view.warehouse,
    grade: view.grade,
  });
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Stock counts are not part of your role">
          Your administrator can give your role the permission to manage the catalogue and stock.
        </NoAccess>
      );
    }
    return (
      <SectionError
        title="Stock count"
        heading="The count sheet could not load"
        error={result.error}
      />
    );
  }

  return (
    <section aria-labelledby="count-heading" className="grid gap-6">
      <div>
        <h2 id="count-heading" className="font-serif text-2xl text-primary">
          Stock count
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Count a style&apos;s pieces on the shelf and save the differences, or enter the stock you
          held before starting.
        </p>
      </div>
      <CountScreen
        key={countSearch(view)}
        sheet={result.data}
        view={view}
        currency={ctx.company.currency}
      />
    </section>
  );
}
