"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import {
  ADVANCE_STATUS_LABELS,
  ADVANCE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUSES,
} from "./labels";
import { clearedHrView, hrListSearch, type HrListView, isHrFiltered } from "./list-view";

type Select = {
  key: string;
  label: string;
  all: string;
  options: ReadonlyArray<readonly [string, string]>;
};

/**
 * An HR list's filters: a search (employees), choices (department and status;
 * status and leave type) and "People who left too". A change reloads the list
 * from the server; the old list stays, dimmed, until the new one arrives. A
 * list opened for one employee names them, with a way back to everyone.
 */
export function HrFilters({
  view,
  departments = [],
  leaveTypes = [],
  named = null,
  children,
}: {
  view: HrListView;
  departments?: readonly string[];
  leaveTypes?: ReadonlyArray<{ id: string; name: string }>;
  /** The employee the list is narrowed to: "Leave of Sabbir Ahmed". */
  named?: { text: string; clear: string } | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);

  function show(next: HrListView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${hrListSearch(next)}`, { scroll: false });
    });
  }

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    if (shown.list !== "employees") return;
    show({ ...shown, q: typeof value === "string" ? value : "" });
  }

  const selects: Select[] =
    shown.list === "employees"
      ? [
          ...(departments.length > 1
            ? [
                {
                  key: "department",
                  label: "Department",
                  all: "Every department",
                  options: departments.map((d) => [d, d] as const),
                },
              ]
            : []),
          {
            key: "status",
            label: "Status",
            all: "Any status",
            options: EMPLOYEE_STATUSES.map((s) => [s, EMPLOYEE_STATUS_LABELS[s]] as const),
          },
        ]
      : shown.list === "leave"
        ? [
            {
              key: "status",
              label: "Status",
              all: "Any status",
              options: LEAVE_STATUSES.map((s) => [s, LEAVE_STATUS_LABELS[s]] as const),
            },
            ...(leaveTypes.length > 1
              ? [
                  {
                    key: "type",
                    label: "Leave type",
                    all: "Every leave type",
                    options: leaveTypes.map((t) => [t.id, t.name] as const),
                  },
                ]
              : []),
          ]
        : [
            {
              key: "status",
              label: "Status",
              all: "Any status",
              options: ADVANCE_STATUSES.map((s) => [s, ADVANCE_STATUS_LABELS[s]] as const),
            },
          ];

  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-5">
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center">
        {shown.list === "employees" && (
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
              placeholder="Name, code, phone or post"
              aria-label="Search employees"
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
              <div key={select.key} className="min-w-0">
                <label className="sr-only" htmlFor={id}>
                  {select.label}
                </label>
                <NativeSelect
                  id={id}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) =>
                    show({ ...shown, [select.key]: e.target.value || undefined } as HrListView)
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
        {shown.list === "employees" && (
          <label className="flex h-11 cursor-pointer items-center gap-2 text-sm md:h-9">
            <input
              type="checkbox"
              className="size-4 cursor-pointer accent-primary"
              checked={Boolean(shown.former)}
              onChange={(e) => show({ ...shown, former: e.target.checked || undefined })}
            />
            People who left too
          </label>
        )}
        {named && <p className="min-w-0 text-sm break-words text-muted-foreground">{named.text}</p>}
        {isHrFiltered(shown) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start lg:ml-auto"
            onClick={() => show(clearedHrView(shown))}
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
