import { SearchIcon } from "lucide-react";
import type { Metadata } from "next";

import { SectionError } from "@/components/dashboard/section-error";
import { EmptyState } from "@/components/products/bits";
import { DecisionBadge } from "@/components/production/costing/badges";
import { NewCostingButton, QuotesPanel } from "@/components/production/costing/quotes-panel";
import { productionHref } from "@/components/production/labels";
import { ProductionNoAccess } from "@/components/production/no-access";
import { RowCard } from "@/components/sales/load-more";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDay } from "@/lib/dates";
import { formatDay } from "@/lib/display";
import { profitBothWays } from "@/modules/costing/costing-labels";
import { fabricPricesAction, listCostingsAction } from "@/server/actions/costing.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Costing" };

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Order costing sheets, newest first (costing.view): each order's styles
 * costed per dozen, the owner's profit % for it, the Order check card and the
 * decision; below them the supplier fabric quotes per kg.
 */
export default async function CostingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const search = typeof params.search === "string" ? params.search.slice(0, 80) : "";
  const [result, prices] = await Promise.all([
    listCostingsAction({ search }),
    fabricPricesAction({}),
  ]);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="Costing is not part of your role">
          Your administrator can give your role the permission to see costing sheets.
        </ProductionNoAccess>
      );
    }
    return (
      <SectionError
        title="Costing"
        heading="The costing sheets could not load"
        error={result.error}
      />
    );
  }
  const rows = result.data;
  const canManage = ctx.permissions.has("costing.manage");

  return (
    <section aria-labelledby="costing-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="costing-heading" className="font-serif text-2xl text-primary">
            Costing
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Cost an order before you take it: fabric at the supplier&apos;s price per kg, the CM
            fixed with the factory, your profit % for this order, and the Order check card.
          </p>
        </div>
        {canManage && <NewCostingButton companyCurrency={ctx.company.currency} />}
      </div>

      <form action="/production/costing" className="flex gap-2" role="search">
        <label htmlFor="costing-search" className="sr-only">
          Find a costing sheet
        </label>
        <Input
          id="costing-search"
          name="search"
          defaultValue={search}
          placeholder="Sheet no., order or buyer"
          autoComplete="off"
          className="min-w-0"
        />
        <Button type="submit" variant="outline">
          <SearchIcon aria-hidden />
          Find
        </Button>
      </form>

      {rows.length === 0 ? (
        search ? (
          <EmptyState title="No costing sheet matches">
            Try the sheet number, the order&apos;s name or the buyer.
          </EmptyState>
        ) : (
          <EmptyState title="No costing sheet yet">
            Make one for the next order a buyer asks about: add its styles, your profit % and the
            ship date, then read the Order check card.
          </EmptyState>
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((c) => (
            <RowCard
              key={c.id}
              href={productionHref.costing(c.id)}
              eyebrow={`${c.number} · ${formatDay(c.createdOn)}`}
              badges={<DecisionBadge decision={c.decision} />}
              title={c.title}
              details={[
                c.buyer ?? "No buyer yet",
                `${c.styles} ${c.styles === 1 ? "style" : "styles"}, ${c.pieces.toLocaleString("en-US")} pieces`,
                c.shipDate ? `Ship ${formatDay(c.shipDate)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              footer={
                <span className="tabular-nums">
                  Cost {c.currency} {fmt(c.cost)}
                  {c.value !== null ? ` · Buyer ${c.currency} ${fmt(c.value)}` : ""}
                  {c.profitPercent !== null
                    ? ` · Profit ${profitBothWays(c.profitPercent)}`
                    : " · Profit % not set"}
                </span>
              }
            />
          ))}
        </ul>
      )}

      {prices.ok && (
        <QuotesPanel
          quotes={prices.data.quotes}
          canManage={canManage}
          companyCurrency={ctx.company.currency}
          today={localDay(new Date(), ctx.company.timezone)}
        />
      )}
    </section>
  );
}
