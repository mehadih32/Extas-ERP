"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  CHANNEL_LABELS,
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PROFORMA_STATUS_LABELS,
  QUOTATION_STATUS_LABELS,
} from "./labels";
import {
  clearedView,
  INVOICE_FILTERS,
  isSalesFiltered,
  ORDER_CHANNEL_FILTERS,
  ORDER_STATUSES,
  PROFORMA_STATUSES,
  QUOTATION_STATUSES,
  type SalesListView,
  salesListSearch,
} from "./list-view";

type Select = {
  key: "status" | "channel";
  label: string;
  all: string;
  options: ReadonlyArray<readonly [string, string]>;
};

const SEARCH: Partial<Record<SalesListView["list"], string>> = {
  orders: "Order number, buyer or phone",
  quotations: "Quotation number or buyer",
  invoices: "Invoice or order number, or buyer",
};

const SELECTS: Record<SalesListView["list"], Select[]> = {
  orders: [
    {
      key: "status",
      label: "Status",
      all: "All statuses",
      options: ORDER_STATUSES.map((s) => [s, ORDER_STATUS_LABELS[s]] as const),
    },
    {
      key: "channel",
      label: "Channel",
      all: "All channels",
      options: ORDER_CHANNEL_FILTERS.map((c) => [c, CHANNEL_LABELS[c]] as const),
    },
  ],
  quotations: [
    {
      key: "status",
      label: "Status",
      all: "All statuses",
      options: QUOTATION_STATUSES.map((s) => [s, QUOTATION_STATUS_LABELS[s]] as const),
    },
  ],
  proformas: [
    {
      key: "status",
      label: "Status",
      all: "All statuses",
      options: PROFORMA_STATUSES.map((s) => [s, PROFORMA_STATUS_LABELS[s]] as const),
    },
  ],
  invoices: [
    {
      key: "status",
      label: "Status",
      all: "All invoices",
      options: INVOICE_FILTERS.map(
        (s) => [s, s === "OVERDUE" ? "Overdue" : INVOICE_STATUS_LABELS[s]] as const,
      ),
    },
  ],
  payments: [],
};

/**
 * A Sales list's filters: a search and status (and channel) choices, or for
 * payments the received / refunds switch and a range of days. A change reloads
 * the list from the server; the old list stays, dimmed, until the new one
 * arrives, while the filters already show the choice made.
 */
export function SalesFilters({
  view,
  children,
}: {
  view: SalesListView;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The choice made, until the list for it arrives.
  const [shown, setShown] = useOptimistic(view);
  const placeholder = SEARCH[shown.list];
  const selects = SELECTS[shown.list];

  function show(next: SalesListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${salesListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ ...shown, q: typeof value === "string" ? value : "" } as SalesListView);
  }

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        {shown.list === "payments" && (
          <div
            role="group"
            aria-label="Show"
            className="inline-grid w-full grid-cols-2 rounded-md border bg-card p-1 sm:w-auto"
          >
            {(
              [
                ["received", "Money received"],
                ["refunds", "Refunds"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={shown.show === value}
                onClick={() => show({ ...shown, show: value })}
                className={cn(
                  "h-9 cursor-pointer rounded-sm px-4 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
                  shown.show === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {placeholder && "q" in shown && (
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
              placeholder={placeholder}
              aria-label={`Search ${shown.list}`}
              className="pl-9"
            />
          </form>
        )}
        {selects.length > 0 && (
          <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-3">
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
                      show({ ...shown, [select.key]: e.target.value || undefined } as SalesListView)
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
        )}
        {shown.list === "payments" && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <label className="grid gap-1 text-[0.8125rem] text-muted-foreground sm:flex sm:items-center sm:gap-2">
              From
              <Input
                type="date"
                value={shown.from ?? ""}
                max={shown.to}
                onChange={(e) => show({ ...shown, from: e.target.value || undefined })}
                className="sm:w-40"
              />
            </label>
            <label className="grid gap-1 text-[0.8125rem] text-muted-foreground sm:flex sm:items-center sm:gap-2">
              To
              <Input
                type="date"
                value={shown.to ?? ""}
                min={shown.from}
                onChange={(e) => show({ ...shown, to: e.target.value || undefined })}
                className="sm:w-40"
              />
            </label>
          </div>
        )}
        {isSalesFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show(clearedView(shown))}
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
