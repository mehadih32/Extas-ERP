"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Range = { from: string | null; to: string | null };

/** "?from=2026-09-01&to=2026-09-30", or "" for the whole account. */
function rangeSearch(range: Range): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The days a statement covers: quick choices or two dates, kept in the address. */
function presets(today: string): Array<{ label: string; range: Range }> {
  const month = `${today.slice(0, 7)}-01`;
  const year = `${today.slice(0, 4)}-01-01`;
  return [
    { label: "Whole account", range: { from: null, to: null } },
    { label: "This month", range: { from: month, to: today } },
    { label: "Last 90 days", range: { from: addDays(today, -89), to: today } },
    { label: "This year", range: { from: year, to: today } },
  ];
}

/**
 * Chooses the days a statement covers. A change reloads the statement from the
 * server; the old one stays, dimmed, until the new one arrives.
 */
export function StatementRange({
  from,
  to,
  today,
  children,
}: {
  from: string | null;
  to: string | null;
  /** Today in company time ("2026-10-08"). */
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<Range>({ from, to });

  function show(range: Range) {
    startTransition(() => {
      setShown(range);
      router.replace(`${pathname}${rangeSearch(range)}`, { scroll: false });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const day = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value ? value : null;
    };
    show({ from: day("from"), to: day("to") });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div role="group" aria-label="Quick choices" className="flex flex-wrap gap-2">
          {presets(today).map((preset) => {
            const active = preset.range.from === shown.from && preset.range.to === shown.to;
            return (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => show(preset.range)}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
        <form
          key={`${shown.from}:${shown.to}`}
          onSubmit={submit}
          className="grid grid-cols-2 items-end gap-3 sm:flex"
        >
          <label className="grid gap-1.5 text-sm">
            <span className="eyebrow">From</span>
            <Input
              type="date"
              name="from"
              defaultValue={shown.from ?? ""}
              max={today}
              className="sm:w-44"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="eyebrow">To</span>
            <Input
              type="date"
              name="to"
              defaultValue={shown.to ?? ""}
              max={today}
              className="sm:w-44"
            />
          </label>
          <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1">
            Show these days
          </Button>
        </form>
      </div>
      <div
        aria-busy={pending}
        className={cn(
          "grid grid-cols-1 gap-6 transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </div>
    </div>
  );
}
