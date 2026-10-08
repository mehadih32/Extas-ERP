import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { FormAlert } from "@/components/forms/field";
import { EmptyState } from "@/components/products/bits";
import { SkuMatchCard } from "@/components/products/sku-match";
import { StockSheetButton } from "@/components/products/stock-sheet-button";
import { StyleCards } from "@/components/products/style-cards";
import { StyleFilters } from "@/components/products/style-filters";
import {
  looksLikeCode,
  styleListQuery,
  styleListSearch,
  styleListViewFrom,
} from "@/components/products/style-list-view";
import { NoAccess } from "@/components/settings/no-access";
import { Button } from "@/components/ui/button";
import { getStyleListAction, lookupVariantAction } from "@/server/actions/inventory.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "Products" };

/**
 * The styles (inventory.view, like GET /api/inventory/styles), browsed by
 * category and brand or found by name, code, SKU or barcode. Adding styles is
 * offered to inventory.manage, the permission the style actions check.
 */
export default async function StylesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireCompanyPage();
  const params = await searchParams;
  const view = styleListViewFrom(params);
  const [result, match] = await Promise.all([
    getStyleListAction(styleListQuery(view)),
    looksLikeCode(view.q) ? lookupVariantAction(view.q) : null,
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
  const { items, nextCursor, categories, brands, canManage } = result.data;
  const currency = ctx.company.currency;
  const sku = match?.ok ? match.data : null;
  const filtered = Boolean(view.q || view.category || view.brand || view.archived);
  const categoryPaths = Object.fromEntries(categories.map((c) => [c.id, c.path]));
  const brandName = brands.find((b) => b.id === view.brand)?.name;

  return (
    <section aria-labelledby="styles-heading" className="grid gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="styles-heading" className="font-serif text-2xl text-primary">
            Styles
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Each style with the pieces ready to sell. Open a style for its stock matrix by colour
            and size.
          </p>
        </div>
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
      </div>

      {params.deleted === "1" && <FormAlert tone="success">The style was deleted.</FormAlert>}

      <StyleFilters view={view} categories={categories} brands={brands}>
        {sku && <SkuMatchCard sku={sku} currency={currency} />}
        {items.length === 0 ? (
          filtered ? (
            sku ? null : (
              <EmptyState title="No styles match">
                Try part of a style&apos;s name or code, another category or brand, or archived
                styles.
              </EmptyState>
            )
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
            categoryPaths={categoryPaths}
            currency={currency}
          />
        )}
      </StyleFilters>
    </section>
  );
}
