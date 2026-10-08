"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { PERIOD_OPTIONS, type TopSellersView, topSellersSearch } from "./top-sellers-view";

/**
 * Period, SKUs or styles, and pieces or sales value for the top sellers. A
 * change reloads the list from the server; the old list stays, dimmed, until
 * the new one arrives, while the filters already show the choice made.
 */
export function TopSellersFilters({
  view,
  canSortBySales,
  children,
}: {
  view: TopSellersView;
  canSortBySales: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The choice made, until the list for it arrives (a select bound to the address
  // alone would spring back while it loads).
  const [shown, setShown] = useOptimistic(view);

  function show(change: Partial<TopSellersView>) {
    const next = { ...shown, ...change };
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${topSellersSearch(next)}`, { scroll: false });
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <label className="sr-only" htmlFor="top-period">
          Period
        </label>
        <NativeSelect
          id="top-period"
          value={shown.period}
          onChange={(e) => show({ period: e.target.value as TopSellersView["period"] })}
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
          <label className="sr-only" htmlFor="top-group">
            Show
          </label>
          <NativeSelect
            id="top-group"
            value={shown.groupBy}
            onChange={(e) => show({ groupBy: e.target.value as TopSellersView["groupBy"] })}
          >
            <option value="SKU">By SKU</option>
            <option value="STYLE">By style</option>
          </NativeSelect>
          {canSortBySales && (
            <>
              <label className="sr-only" htmlFor="top-sort">
                Rank by
              </label>
              <NativeSelect
                id="top-sort"
                value={shown.sortBy}
                onChange={(e) => show({ sortBy: e.target.value as TopSellersView["sortBy"] })}
              >
                <option value="QUANTITY">By pieces</option>
                <option value="REVENUE">By sales value</option>
              </NativeSelect>
            </>
          )}
        </div>
      </div>
      <div
        aria-busy={pending}
        className={cn("transition-opacity", pending && "pointer-events-none opacity-50")}
      >
        {children}
      </div>
    </div>
  );
}
