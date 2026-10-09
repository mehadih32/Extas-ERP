"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { PERIOD_CHOICES, PERIOD_LABELS } from "./labels";
import { periodSearch, type PeriodView } from "./report-view";

/** The report below, dimmed while the next one loads. */
function Loading({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-busy={pending}
      className={cn(
        "grid grid-cols-1 gap-6 transition-opacity",
        pending && "pointer-events-none opacity-50",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Chooses the period a report covers: quick choices, two dates, and (for the
 * profit and loss) a column per month. A change reloads the report from the
 * server; the old one stays, dimmed, until the new one arrives.
 */
export function ReportPeriod({
  view,
  resolved,
  today,
  monthToggle = false,
  children,
}: {
  view: PeriodView;
  /** The days the report on screen covers. */
  resolved: { from: string; to: string } | null;
  today: string;
  monthToggle?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(view);
  const custom = Boolean(shown.from || shown.to);
  const preset = custom ? null : (shown.period ?? "THIS_MONTH");

  function show(next: PeriodView) {
    startTransition(() => {
      setShown(next);
      router.replace(`${pathname}${periodSearch(next)}`, { scroll: false });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const day = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value ? value : undefined;
    };
    show({ byMonth: shown.byMonth, from: day("from"), to: day("to") });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
          {PERIOD_CHOICES.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={preset === p ? "default" : "outline"}
              aria-pressed={preset === p}
              onClick={() => show({ period: p, byMonth: shown.byMonth })}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
        <form
          key={`${shown.from}:${shown.to}:${resolved?.from}:${resolved?.to}`}
          onSubmit={submit}
          className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
        >
          <label className="grid gap-1.5 text-sm">
            <span className="eyebrow">From</span>
            <Input
              type="date"
              name="from"
              defaultValue={shown.from ?? resolved?.from ?? ""}
              max={today}
              className="sm:w-44"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="eyebrow">To</span>
            <Input
              type="date"
              name="to"
              defaultValue={shown.to ?? resolved?.to ?? ""}
              className="sm:w-44"
            />
          </label>
          <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1">
            Show these days
          </Button>
        </form>
        {monthToggle && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shown.byMonth}
              onChange={(event) => show({ ...shown, byMonth: event.target.checked })}
              className="size-4 shrink-0 cursor-pointer accent-primary"
            />
            Show month by month
          </label>
        )}
      </div>
      <Loading pending={pending}>{children}</Loading>
    </div>
  );
}

/** Chooses the day a balance is taken at ("?asOf="), today by default. */
export function ReportAsOf({
  asOf,
  today,
  children,
}: {
  asOf: string | undefined;
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(asOf ?? today);

  function show(day: string) {
    startTransition(() => {
      setShown(day);
      router.replace(day === today ? pathname : `${pathname}?asOf=${day}`, { scroll: false });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("asOf");
    show(typeof value === "string" && value ? value : today);
  }

  return (
    <div className="grid gap-6">
      <form key={shown} onSubmit={submit} className="grid grid-cols-2 items-end gap-3 sm:flex">
        <label className="col-span-2 grid gap-1.5 text-sm sm:col-span-1">
          <span className="eyebrow">At the end of</span>
          <Input type="date" name="asOf" defaultValue={shown} max={today} className="sm:w-44" />
        </label>
        <Button type="submit" variant="outline">
          Show
        </Button>
        <Button
          type="button"
          variant={shown === today ? "default" : "outline"}
          aria-pressed={shown === today}
          onClick={() => show(today)}
        >
          Today
        </Button>
      </form>
      <Loading pending={pending}>{children}</Loading>
    </div>
  );
}
