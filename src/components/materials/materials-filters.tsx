"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { BILL_STATUS_LABELS } from "@/components/production/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { KIND_LABELS, KINDS, ORDER_STATUS_LABELS, ORDER_STATUSES } from "./labels";
import {
  BILL_STATUSES,
  clearedMaterialsView,
  ISSUE_KINDS,
  isMaterialsFiltered,
  materialsListSearch,
  type MaterialsListView,
} from "./list-view";

type Select = {
  key: string;
  label: string;
  all: string;
  options: ReadonlyArray<readonly [string, string]>;
};

type Check = { key: string; label: string };

/**
 * A Raw materials list's filters: a search, choices (kind and store; status;
 * issue or return) and ticks (low stock, archived, late). A change reloads the
 * list from the server; the old list stays, dimmed, until the new one arrives.
 * A list opened for one supplier, material or project names it, with a way back
 * to all of them.
 */
export function MaterialsFilters({
  view,
  stores = [],
  named = null,
  children,
}: {
  view: MaterialsListView;
  /** Stock: the stores to filter by. */
  stores?: ReadonlyArray<{ id: string; name: string }>;
  /** The supplier, material or project the list is narrowed to: "Orders for FAB-0001". */
  named?: { text: string; clear: string } | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  function show(next: MaterialsListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${materialsListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    if (shown.list !== "stock" && shown.list !== "orders") return;
    show({ ...shown, q: typeof value === "string" ? value : "" });
  }

  const selects: Select[] =
    shown.list === "stock"
      ? [
          {
            key: "kind",
            label: "Kind",
            all: "All kinds",
            options: KINDS.map((k) => [k, KIND_LABELS[k]] as const),
          },
          ...(stores.length > 1
            ? [
                {
                  key: "store",
                  label: "Store",
                  all: "Every store",
                  options: stores.map((s) => [s.id, s.name] as const),
                },
              ]
            : []),
        ]
      : shown.list === "orders"
        ? [
            {
              key: "status",
              label: "Status",
              all: "Any status",
              options: ORDER_STATUSES.map((s) => [s, ORDER_STATUS_LABELS[s]] as const),
            },
          ]
        : shown.list === "purchases"
          ? [
              {
                key: "status",
                label: "Status",
                all: "Any status",
                options: BILL_STATUSES.map((s) => [s, BILL_STATUS_LABELS[s]] as const),
              },
            ]
          : shown.list === "issues"
            ? [
                {
                  key: "kind",
                  label: "Kind",
                  all: "Issued and taken back",
                  options: ISSUE_KINDS.map(
                    (k) => [k, k === "ISSUE" ? "Issued to production" : "Taken back"] as const,
                  ),
                },
              ]
            : [];

  const checks: Check[] =
    shown.list === "stock"
      ? [
          { key: "low", label: "Running low" },
          { key: "archived", label: "Show archived" },
        ]
      : shown.list === "orders"
        ? [{ key: "overdue", label: "Late only" }]
        : [];

  const searchable = shown.list === "stock" || shown.list === "orders";

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        {searchable && (
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
              placeholder={
                shown.list === "stock" ? "Code, name or colour" : "Order or their number"
              }
              aria-label={shown.list === "stock" ? "Search materials" : "Search purchase orders"}
              className="pl-9"
            />
          </form>
        )}
        {selects.length > 0 && (
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
                <div key={select.key} className="min-w-0">
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
                      } as MaterialsListView)
                    }
                  >
                    <option value="">{select.all}</option>
                    {select.options.map(([optionValue, text]) => (
                      <option key={optionValue} value={optionValue}>
                        {text}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              );
            })}
          </div>
        )}
        {checks.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {checks.map((check) => (
              <label
                key={check.key}
                className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9"
              >
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-primary"
                  checked={Boolean((shown as Record<string, unknown>)[check.key])}
                  onChange={(e) =>
                    show({
                      ...shown,
                      [check.key]: e.target.checked || undefined,
                    } as MaterialsListView)
                  }
                />
                {check.label}
              </label>
            ))}
          </div>
        )}
        {named && <p className="min-w-0 text-sm break-words text-muted-foreground">{named.text}</p>}
        {isMaterialsFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show(clearedMaterialsView(shown))}
          >
            <XIcon aria-hidden />
            {named && !searchable && selects.length === 0 ? named.clear : "Clear filters"}
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
