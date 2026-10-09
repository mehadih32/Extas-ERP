"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

type CardView = { store: string | null; from: string | null; to: string | null };

/** "?store=…&from=2026-09-01&to=2026-09-30", or "" for every store and every day. */
function cardSearch(view: CardView): string {
  const params = new URLSearchParams();
  if (view.store) params.set("store", view.store);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function presets(today: string): Array<{ label: string; from: string | null; to: string | null }> {
  return [
    { label: "Everything", from: null, to: null },
    { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
    { label: "Last 90 days", from: addDays(today, -89), to: today },
    { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

/**
 * What a stock card covers: one store or all of them, and quick choices of days
 * or two dates, kept in the address. A change reloads the card from the server;
 * the old one stays, dimmed, until the new one arrives.
 */
export function CardFilters({
  store,
  from,
  to,
  today,
  stores,
  children,
}: {
  store: string | null;
  from: string | null;
  to: string | null;
  /** Today in company time ("2026-10-08"). */
  today: string;
  stores: ReadonlyArray<{ id: string; name: string }>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<CardView>({ store, from, to });

  function show(view: CardView) {
    startTransition(() => {
      setShown(view);
      router.replace(`${pathname}${cardSearch(view)}`, { scroll: false });
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const day = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value ? value : null;
    };
    show({ ...shown, from: day("from"), to: day("to") });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {stores.length > 1 && (
            <div className="sm:w-56">
              <label className="sr-only" htmlFor="card-store">
                Store
              </label>
              <NativeSelect
                id="card-store"
                value={shown.store ?? ""}
                onChange={(e) => show({ ...shown, store: e.target.value || null })}
              >
                <option value="">Every store</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div role="group" aria-label="Quick choices of days" className="flex flex-wrap gap-2">
            {presets(today).map((preset) => {
              const active = preset.from === shown.from && preset.to === shown.to;
              return (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => show({ ...shown, from: preset.from, to: preset.to })}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>
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
