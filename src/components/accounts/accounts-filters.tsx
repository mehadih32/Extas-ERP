"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { EXPENSE_STATUS_LABELS, EXPENSE_STATUSES, SOURCE_FILTERS, SOURCE_LABELS } from "./labels";
import {
  accountsListSearch,
  type AccountsListView,
  clearedAccountsView,
  isAccountsFiltered,
} from "./list-view";

type Select = {
  key: string;
  label: string;
  all: string;
  options: ReadonlyArray<readonly [string, string]>;
};

/**
 * An Accounts list's filters: a search and choices (what made a journal entry;
 * an expense's status and head, and "only mine"). A change reloads the list
 * from the server; the old list stays, dimmed, until the new one arrives.
 */
export function AccountsFilters({
  view,
  heads = [],
  seesAll = false,
  label = null,
  children,
}: {
  view: AccountsListView;
  /** Expenses: the heads to filter by. */
  heads?: ReadonlyArray<{ id: string; name: string }>;
  /** Expenses: whether this person sees everyone's (and may narrow to their own). */
  seesAll?: boolean;
  /** Supplier payments: the supplier filtered on. */
  label?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  function show(next: AccountsListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${accountsListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    if (shown.list === "payments") return;
    show({ ...shown, q: typeof value === "string" ? value : "" });
  }

  const selects: Select[] =
    shown.list === "journal"
      ? [
          {
            key: "source",
            label: "Made by",
            all: "All entries",
            options: SOURCE_FILTERS.map((s) => [s, SOURCE_LABELS[s]] as const),
          },
        ]
      : shown.list === "expenses"
        ? [
            {
              key: "status",
              label: "Status",
              all: "Any status",
              options: EXPENSE_STATUSES.map((s) => [s, EXPENSE_STATUS_LABELS[s]] as const),
            },
            {
              key: "head",
              label: "Head",
              all: "All heads",
              options: heads.map((h) => [h.id, h.name] as const),
            },
          ]
        : [];

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        {shown.list !== "payments" && (
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
                shown.list === "journal" ? "Voucher number or description" : "Number or details"
              }
              aria-label={shown.list === "journal" ? "Search the journal" : "Search expenses"}
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
                      } as AccountsListView)
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
        {shown.list === "expenses" && seesAll && (
          <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              className="size-4 cursor-pointer accent-primary"
              checked={Boolean(shown.mine)}
              onChange={(e) => show({ ...shown, mine: e.target.checked || undefined })}
            />
            Only the ones I recorded
          </label>
        )}
        {shown.list === "payments" && shown.supplier && (
          <p className="text-sm text-muted-foreground">
            Payments to{" "}
            <span className="font-medium text-foreground">{label ?? "one supplier"}</span>
          </p>
        )}
        {isAccountsFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show(clearedAccountsView(shown))}
          >
            <XIcon aria-hidden />
            {shown.list === "payments" ? "All suppliers" : "Clear filters"}
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
