"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  BILL_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  STAGE_LABELS,
} from "./labels";
import {
  BILL_FILTERS,
  clearedProductionView,
  DELIVERY_FILTERS,
  isProductionFiltered,
  type ProductionListView,
  productionListSearch,
  PROJECT_FILTERS,
  STAGE_FILTERS,
} from "./list-view";

type Select = {
  key: "status" | "stage";
  label: string;
  all: string;
  options: ReadonlyArray<readonly [string, string]>;
};

const SELECTS: Record<ProductionListView["list"], Select[]> = {
  projects: [
    {
      key: "status",
      label: "Status",
      all: "All projects",
      options: PROJECT_FILTERS.map(
        (s) => [s, s === "OVERDUE" ? "Late" : PROJECT_STATUS_LABELS[s]] as const,
      ),
    },
    {
      key: "stage",
      label: "Stage",
      all: "All stages",
      options: STAGE_FILTERS.map((s) => [s, STAGE_LABELS[s]] as const),
    },
  ],
  deliveries: [
    {
      key: "status",
      label: "Status",
      all: "All deliveries",
      options: DELIVERY_FILTERS.map((s) => [s, DELIVERY_STATUS_LABELS[s]] as const),
    },
  ],
  bills: [
    {
      key: "status",
      label: "Status",
      all: "All bills",
      options: BILL_FILTERS.map((s) => [s, BILL_STATUS_LABELS[s]] as const),
    },
  ],
};

/**
 * A Production list's filters: a search (projects) and status or stage
 * choices. A change reloads the list from the server; the old list stays,
 * dimmed, until the new one arrives, while the filters already show the choice.
 */
export function ProductionFilters({
  view,
  children,
}: {
  view: ProductionListView;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);
  const selects = SELECTS[shown.list];

  function show(next: ProductionListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${productionListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    if (shown.list !== "projects") return;
    show({ ...shown, q: typeof value === "string" ? value : "" });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        {shown.list === "projects" && (
          <form role="search" onSubmit={search} className="relative w-full lg:max-w-xs">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              key={shown.q}
              type="search"
              name="q"
              defaultValue={shown.q}
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Project, factory or buyer"
              aria-label="Search projects"
              className="pl-9"
            />
          </form>
        )}
        <div
          className={cn(
            "grid gap-2 md:flex md:items-center md:gap-3",
            selects.length > 1 ? "grid-cols-2" : "grid-cols-1 sm:w-60",
          )}
        >
          {selects.map((select) => {
            const id = `${shown.list}-${select.key}`;
            const value = (shown as Record<string, unknown>)[select.key];
            return (
              <div key={select.key}>
                <label className="sr-only" htmlFor={id}>
                  {select.label}
                </label>
                <NativeSelect
                  id={id}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) =>
                    show({
                      ...shown,
                      [select.key]: e.target.value || undefined,
                    } as ProductionListView)
                  }
                >
                  <option value="">{select.all}</option>
                  {select.options.map(([optionValue, label]) => (
                    <option key={optionValue} value={optionValue}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            );
          })}
        </div>
        {isProductionFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show(clearedProductionView(shown))}
          >
            <XIcon aria-hidden />
            Clear filters
          </Button>
        )}
      </div>
      <div
        aria-busy={pending}
        className={cn(
          "grid grid-cols-1 gap-5 transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
