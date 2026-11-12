import { ChevronLeftIcon, ChevronRightIcon, SettingsIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/dashboard/section-error";
import { ProductionNoAccess } from "@/components/production/no-access";
import { ColourChip } from "@/components/ta/order-ta";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { taCalendar } from "@/modules/ta/ta.service";
import { getTaCalendarAction } from "@/server/actions/ta.actions";
import { requireCompanyPage } from "@/server/pages/guards";

export const metadata: Metadata = { title: "T&A calendar" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

const STATUS_WORDS = {
  late: "Late",
  soon: "Due soon",
  open: "Not done",
  done: "Done",
} as const;

/**
 * Every order's T&A steps by week or month (sales.view or production.view):
 * each step's colour, late steps from before, and the orders whose ship date is
 * at risk. Filters for the buyer and the step's state; on a phone the days are
 * one list.
 */
export default async function TaCalendarPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireCompanyPage();
  const params = await searchParams;
  const filters = {
    view: one(params.view) === "month" ? "month" : "week",
    on: one(params.on),
    buyer: one(params.buyer),
    status: one(params.status),
  };
  const result = await getTaCalendarAction(filters);
  if (!result.ok) {
    if (result.error.code === "FORBIDDEN") {
      return (
        <ProductionNoAccess title="The T&A calendar is not part of your role">
          Your administrator can give your role the permission to see sales or production.
        </ProductionNoAccess>
      );
    }
    if (result.error.code === "VALIDATION") {
      return (
        <SectionError
          title="T&A calendar"
          heading="Those filters are not right"
          error={result.error}
        />
      );
    }
    return (
      <SectionError
        title="T&A calendar"
        heading="The calendar could not load"
        error={result.error}
      />
    );
  }
  const c = result.data;
  const link = (over: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const all = { view: c.view, on: c.on, buyer: c.buyer, status: c.status, ...over };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    return `/production/ta-calendar?${q.toString()}`;
  };
  const shown = c.days.filter((d) => d.items.length > 0);

  return (
    <section aria-labelledby="ta-calendar-heading" className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="ta-calendar-heading" className="font-serif text-2xl text-primary">
            T&amp;A calendar
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every order&apos;s steps from its ship date. Steps tick themselves from the ERP&apos;s
            records; a late step tells the order&apos;s maker and the owner once.
          </p>
        </div>
        {c.can.template && (
          <Button asChild variant="outline">
            <Link href="/production/ta-calendar/template">
              <SettingsIcon aria-hidden />
              T&amp;A template
            </Link>
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-md border p-3">
          <dt className="text-[0.8125rem] text-muted-foreground">Late steps</dt>
          <dd className={cn("mt-1 text-lg tabular-nums", c.late > 0 && "text-destructive")}>
            {c.late}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-[0.8125rem] text-muted-foreground">Ship date at risk</dt>
          <dd className={cn("mt-1 text-lg tabular-nums", c.atRiskOrders > 0 && "text-destructive")}>
            {c.atRiskOrders}
          </dd>
        </div>
      </dl>

      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="on" value={c.on} />
        <div className="grid gap-2">
          <Label htmlFor="ta-view">Show</Label>
          <NativeSelect id="ta-view" name="view" defaultValue={c.view} containerClassName="w-full">
            <option value="week">Week</option>
            <option value="month">Month</option>
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ta-buyer">Buyer</Label>
          <NativeSelect
            id="ta-buyer"
            name="buyer"
            defaultValue={c.buyer ?? ""}
            containerClassName="w-full"
          >
            <option value="">All buyers</option>
            {c.buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ta-status">Status</Label>
          <NativeSelect
            id="ta-status"
            name="status"
            defaultValue={c.status ?? ""}
            containerClassName="w-full"
          >
            <option value="">All steps</option>
            {Object.entries(STATUS_WORDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit">Filter</Button>
      </form>

      <nav aria-label="Weeks and months" className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={link({ on: c.previous })}>
            <ChevronLeftIcon aria-hidden />
            Earlier
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={link({ on: c.today })}>Today</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={link({ on: c.next })}>
            Later
            <ChevronRightIcon aria-hidden />
          </Link>
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatDay(c.from)} to {formatDay(c.to)}
        </span>
      </nav>

      {c.lateBefore.length > 0 && (
        <section
          aria-labelledby="ta-late-before"
          className="rounded-md border border-destructive/40 p-4"
        >
          <h3 id="ta-late-before" className="font-serif text-lg text-destructive">
            Still late from before
          </h3>
          <StepList items={c.lateBefore} />
        </section>
      )}

      {shown.length === 0 && c.lateBefore.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No T&amp;A step falls in these days. Orders get their T&amp;A once they have a ship date.
        </p>
      ) : (
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((d) => (
            <li
              key={d.day}
              className={cn("min-w-0 rounded-md border p-4", d.day === c.today && "border-primary")}
            >
              <h3 className="text-sm font-medium">
                {formatDay(d.day)}
                {d.day === c.today ? " · today" : ""}
              </h3>
              <StepList items={d.items} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type Item = Awaited<ReturnType<typeof taCalendar>>["days"][number]["items"][number];

function StepList({ items }: { items: Item[] }) {
  return (
    <ul className="mt-2 grid gap-2">
      {items.map((s) => (
        <li key={s.id} className="grid gap-1 border-l-2 pl-3 text-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Link
              href={`/sales/orders/${encodeURIComponent(s.orderId)}`}
              className="min-w-0 font-medium break-words text-primary hover:underline"
            >
              {s.orderNumber} {s.name}
            </Link>
            <ColourChip colour={s.colour} />
          </div>
          <span className="text-[0.8125rem] break-words text-muted-foreground">
            {s.buyer ?? "No buyer"} · due {formatDay(s.dueOn)}
            {s.shipOn ? ` · ship ${formatDay(s.shipOn)}` : ""}
          </span>
          {s.atRisk && (
            <span className="text-[0.8125rem] font-medium text-destructive">Ship date at risk</span>
          )}
        </li>
      ))}
    </ul>
  );
}
