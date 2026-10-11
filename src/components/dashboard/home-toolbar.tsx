"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { PrivacyToggle } from "@/components/accounts/privacy";
import { cn } from "@/lib/utils";
import type { HomeRange } from "@/modules/dashboard/schemas";

import { HOME_RANGE_OPTIONS, homeRangeParam } from "./home-range";
import { QuickActions, type QuickActionKeys } from "./quick-actions";

/**
 * Today / This week / This month. Choosing one keeps the screen in place and
 * swaps the figures in; the choice goes in the address bar with any others
 * (the Top sellers choices stay as they were).
 */
function RangeFilter({ range }: { range: HomeRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function choose(next: HomeRange) {
    if (next === range) return;
    const search = new URLSearchParams(params.toString());
    const param = homeRangeParam(next);
    if (param) search.set("range", param);
    else search.delete("range");
    const query = search.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  }

  return (
    <div
      role="group"
      aria-label="Period"
      aria-busy={pending}
      className={cn(
        "inline-flex min-w-0 flex-1 rounded-md border bg-card p-0.5 sm:flex-none",
        pending && "opacity-70",
      )}
    >
      {HOME_RANGE_OPTIONS.map((option) => {
        const on = option.value === range;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => choose(option.value)}
            className={cn(
              "h-9 min-w-0 flex-1 cursor-pointer rounded-[5px] px-2 text-[0.8125rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:flex-none sm:px-3.5",
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The bar pinned to the top of the Home screen while it scrolls: the period,
 * the eye that shows or hides every amount, and the (+) quick actions.
 */
export function HomeToolbar({
  range,
  actions,
  showRange,
  showEye,
  className,
}: {
  range: HomeRange;
  actions: QuickActionKeys;
  /** Only when something on the screen follows the period. */
  showRange: boolean;
  /** Only when the screen shows this person any amounts. */
  showEye: boolean;
  className?: string;
}) {
  // Sticky within its parent: the parent must run the whole height of the screen.
  return (
    <div
      className={cn(
        "sticky top-[var(--app-top,0px)] z-30 border-b bg-background/95 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {showRange ? <RangeFilter range={range} /> : <div className="flex-1" />}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showEye && <PrivacyToggle compact />}
          <QuickActions can={actions} />
        </div>
      </div>
    </div>
  );
}
