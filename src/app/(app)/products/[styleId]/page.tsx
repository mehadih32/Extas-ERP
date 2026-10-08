import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { categoryPath, money } from "@/components/products/labels";
import { StockHistory } from "@/components/products/stock-history";
import { HISTORY_PAGE_SIZE } from "@/components/products/stock-history-view";
import { StockMatrix } from "@/components/products/stock-matrix";
import { StyleActions } from "@/components/products/style-actions";
import { BackLink } from "@/components/settings/back-link";
import { NoAccess } from "@/components/settings/no-access";
import { Badge } from "@/components/ui/badge";
import { getStyleScreenAction, listStockMovementsAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Style" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * One style: its details, its stock matrix (all warehouses or one) and its stock
 * history, for inventory.view. What may be changed comes with the screen from the
 * same checks the inventory actions make (screen.can).
 */
export default async function StylePage({
  params,
  searchParams,
}: {
  params: Promise<{ styleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const [{ styleId }, query] = await Promise.all([params, searchParams]);
  const result = await getStyleScreenAction(styleId, one(query.warehouse));
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Products are not part of your role">
          Your administrator can give your role the permission to see the stock and the product
          matrix.
        </NoAccess>
      );
    }
    return <SectionError title="Style" heading="The style could not load" error={result.error} />;
  }
  const screen = result.data;
  const { style } = screen;
  const currency = ctx.company.currency;
  const history = await listStockMovementsAction({
    styleId: style.id,
    warehouseId: screen.warehouseId ?? undefined,
    take: HISTORY_PAGE_SIZE,
  });
  const notice =
    query.created === "1"
      ? screen.can.manage && style.variantCount === 0
        ? "The style was added. Next, add its colours and sizes to make its SKUs."
        : "The style was added."
      : query.saved === "1"
        ? "The style was saved."
        : undefined;
  const facts: Array<[string, string]> = [
    ["Category", categoryPath(style.category.path)],
    ["Brand", style.brand?.name ?? "No brand"],
    ["Wholesale", money(style.wholesalePrice, currency)],
    ["Retail", money(style.retailPrice, currency)],
  ];
  if (style.fabric) facts.push(["Fabric", style.fabric]);

  return (
    <div className="grid gap-8 md:gap-10">
      <div className="grid gap-6">
        <BackLink href="/products">All styles</BackLink>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{style.code}</span>
            {!style.isActive && (
              <Badge variant="outline" className="text-muted-foreground">
                Archived
              </Badge>
            )}
          </div>
          <h2 className="mt-2 font-serif text-[1.75rem] leading-tight text-primary">
            {style.name}
          </h2>
          {style.description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {style.description}
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-1 truncate text-sm tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {!style.isActive && (
          <FormAlert tone="note">
            This style is archived: it cannot be sold or received from production until it is
            restored.
          </FormAlert>
        )}
        <StyleActions key={style.id} screen={screen} notice={notice} />
      </div>

      <StockMatrix screen={screen} currency={currency} openSku={one(query.sku)} />

      {history.ok ? (
        <StockHistory
          // A new movement (a correction made here) starts the list afresh.
          key={`${screen.warehouseId ?? "all"}:${history.data.items[0]?.id ?? "none"}`}
          initial={history.data}
          styleId={style.id}
          warehouseId={screen.warehouseId}
          showsCosts={screen.showsCosts}
          currency={currency}
          timeZone={ctx.company.timezone}
        />
      ) : (
        <SectionError
          title="Stock history"
          heading="The stock history could not load"
          error={history.error}
        />
      )}
    </div>
  );
}
