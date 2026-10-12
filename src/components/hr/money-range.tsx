"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MoneyPeriod, MoneyRange } from "@/modules/hr/money.service";

import { MONEY_RANGE_LABELS } from "./money-labels";

const PRESETS: readonly MoneyRange[] = ["week", "month", "6m", "year", "all"];

/** "/hr/money", "/hr/money?range=week" or "/hr/money?range=custom&from=…&to=…". */
function pathOf(range: MoneyRange, from?: string, to?: string) {
  if (range === "month") return "/hr/money";
  const params = new URLSearchParams({ range });
  if (range === "custom" && from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  return `/hr/money?${params}`;
}

/**
 * The period the money page counts: quick choices (last week to lifetime) or
 * two days of your own, kept in the address. A change reloads the totals from
 * the server; the old ones stay, dimmed, until the new ones arrive.
 */
export function MoneyRangePicker({
  period,
  today,
  children,
}: {
  period: MoneyPeriod;
  /** Today in company time. */
  today: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<MoneyRange>(period.range);
  const [custom, setCustom] = useState(period.range === "custom");
  const [error, setError] = useState<string | null>(null);

  function show(range: MoneyRange, from?: string, to?: string) {
    setError(null);
    startTransition(() => {
      setShown(range);
      router.replace(pathOf(range, from, to), { scroll: false });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const from = String(form.get("from") ?? "");
    const to = String(form.get("to") ?? "");
    if (!from || !to) return setError("Choose both days.");
    if (from > to) return setError("The first day comes before the last.");
    show("custom", from, to);
  }

  const customOpen = custom || shown === "custom";
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
          {PRESETS.map((range) => {
            const active = shown === range && !custom;
            return (
              <Button
                key={range}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                onClick={() => {
                  setCustom(false);
                  show(range);
                }}
              >
                {MONEY_RANGE_LABELS[range]}
              </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant={customOpen ? "default" : "outline"}
            aria-pressed={customOpen}
            aria-expanded={customOpen}
            aria-controls="money-custom"
            onClick={() => setCustom(true)}
          >
            {MONEY_RANGE_LABELS.custom}
          </Button>
        </div>
        {customOpen && (
          <form
            id="money-custom"
            key={`${period.from}:${period.to}`}
            onSubmit={submit}
            className="grid grid-cols-2 items-end gap-3 sm:flex"
          >
            <label className="grid gap-1.5 text-sm">
              <span className="eyebrow">From</span>
              <Input
                type="date"
                name="from"
                defaultValue={period.from ?? ""}
                max={today}
                className="sm:w-44"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="eyebrow">To</span>
              <Input
                type="date"
                name="to"
                defaultValue={period.to}
                max={today}
                className="sm:w-44"
              />
            </label>
            <Button type="submit" variant="outline" className="col-span-2 sm:col-span-1">
              Show these days
            </Button>
            {error && (
              <p role="alert" className="col-span-2 text-sm text-destructive sm:self-center">
                {error}
              </p>
            )}
          </form>
        )}
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
