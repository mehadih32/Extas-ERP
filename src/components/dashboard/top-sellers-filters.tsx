"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { PERIOD_OPTIONS, type TopSellersView, topSellersSearch } from "./top-sellers-view";

/**
 * Period, SKUs or styles, and pieces or sales value for the top sellers. A
 * change reloads the list from the server; the old list stays, dimmed, until
 * the new one arrives.
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

  function show(change: Partial<TopSellersView>) {
    const search = topSellersSearch({ ...view, ...change });
    startTransition(() => router.replace(`${pathname}${search}`, { scroll: false }));
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <label className="sr-only" htmlFor="top-period">
          Period
        </label>
        <NativeSelect
          id="top-period"
          value={view.period}
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
            value={view.groupBy}
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
                value={view.sortBy}
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
