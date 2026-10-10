import { PlusIcon } from "lucide-react";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { NoAccess } from "@/components/settings/no-access";
import { Button } from "@/components/ui/button";
import { getStyleListAction, lookupVariantAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

import { EmptyState } from "./bits";
import { SkuMatchCard } from "./sku-match";
import { StaleStylesHint } from "./stale-styles-hint";
import { StockSheetButton } from "./stock-sheet-button";
import { StyleCards } from "./style-cards";
import { StyleFilters } from "./style-filters";
import {
  looksLikeCode,
  styleListQuery,
  styleListSearch,
  styleListViewFrom,
} from "./style-list-view";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The Styles tab (active styles) and the Archived styles tab (inventory.view, like
 * GET /api/inventory/styles), browsed by category and brand or found by name,
 * code, SKU or barcode. Adding, archiving and unarchiving styles is offered to
 * inventory.manage, the permission the style actions check.
 */
export async function StyleListPage({
  searchParams,
  archived,
}: {
  searchParams: Promise<SearchParams>;
  archived: boolean;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const view = styleListViewFrom(params, archived);
  const [result, match] = await Promise.all([
    getStyleListAction(styleListQuery(view)),
    !archived && looksLikeCode(view.q) ? lookupVariantAction(view.q) : null,
  ]);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <NoAccess title="Products are not part of your role">
          Your administrator can give your role the permission to see the stock and the product
          matrix.
        </NoAccess>
      );
    }
    return <SectionError title="Styles" heading="The styles could not load" error={result.error} />;
  }
  const { items, nextCursor, categories, counts, brands, canManage, stale } = result.data;
  const currency = ctx.company.currency;
  const sku = match?.ok ? match.data : null;
  const filtered = Boolean(view.q || view.category || view.brand);
  const brandName = brands.find((b) => b.id === view.brand)?.name;

  return (
    <section aria-labelledby="styles-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="styles-heading" className="font-serif text-2xl text-primary">
            {archived ? "Archived styles" : "Styles"}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {archived
              ? "Styles put away: they stay out of sales and production, but their history stays in every report. Unarchive one to sell it again."
              : "Each style with the pieces ready to sell. Open a style for its stock matrix by colour and size."}
          </p>
        </div>
        {!archived && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {brandName && (
              <StockSheetButton
                request={{ type: "STOCK_AVAILABILITY", brandId: view.brand }}
                label={`${brandName} stock sheet`}
              />
            )}
            {canManage && (
              <Button asChild className="w-full sm:w-auto">
                <Link href="/products/new">
                  <PlusIcon aria-hidden />
                  New style
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {params.deleted === "1" && <FormAlert tone="success">The style was deleted.</FormAlert>}
      {stale.length > 0 && <StaleStylesHint styles={stale} />}

      <StyleFilters view={view} categories={categories} counts={counts} brands={brands}>
        {sku && <SkuMatchCard sku={sku} currency={currency} />}
        {items.length === 0 ? (
          filtered ? (
            sku ? null : (
              <EmptyState title="No styles match">
                Try part of a style&apos;s name or code, or another category or brand.
              </EmptyState>
            )
          ) : archived ? (
            <EmptyState title="No archived styles">
              Styles you archive show here, ready to unarchive.
            </EmptyState>
          ) : (
            <EmptyState
              title="No styles yet"
              action={
                canManage ? (
                  <Button asChild>
                    <Link href={categories.length > 0 ? "/products/new" : "/products/setup"}>
                      {categories.length > 0 ? "Add the first style" : "Set up categories first"}
                    </Link>
                  </Button>
                ) : undefined
              }
            >
              {canManage
                ? categories.length > 0
                  ? "Add a style, then its colours and sizes, to start keeping its stock."
                  : "A style needs a category. Add categories, colours and sizes on the Setup tab."
                : "Styles show here once they are added to the catalogue."}
            </EmptyState>
          )
        ) : (
          <StyleCards
            key={styleListSearch(view)}
            initial={{ items, nextCursor }}
            view={view}
            categoryPaths={Object.fromEntries(categories.map((c) => [c.id, c.path]))}
            currency={currency}
            canManage={canManage}
          />
        )}
      </StyleFilters>
    </section>
  );
}
