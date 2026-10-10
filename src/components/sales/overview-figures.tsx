import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { formatCount, groupAmount } from "@/lib/display";
import { cn } from "@/lib/utils";
import type { SalesOverview } from "@/modules/sales/overview.service";

import { salesListSearch } from "./list-view";

type Tile = {
  label: string;
  /** An amount ("12500.00") or a count. */
  figure: { amount: string } | { count: number };
  caption: string;
  href: string;
  /** Red when it needs someone's attention. */
  alert?: boolean;
};

function tilesFor(o: SalesOverview): Tile[] {
  const f = o.figures;
  const count = (n: number) => formatCount(n, o.currency);
  const amount = (fixed: string) => `${o.currency} ${groupAmount(fixed, o.currency)}`;
  return [
    {
      label: "Orders today",
      figure: { count: f.ordersToday.count },
      caption: `Worth ${amount(f.ordersToday.value)}`,
      href: "/sales/orders",
    },
    {
      label: "Sales invoiced today",
      figure: { amount: f.invoicedToday.value },
      caption: `${count(f.invoicedToday.count)} invoice${f.invoicedToday.count === 1 ? "" : "s"}`,
      href: "/sales/invoices",
    },
    {
      label: "Collected today",
      figure: { amount: f.collectedToday.value },
      caption: /[1-9]/.test(f.collectedToday.refunded)
        ? `After ${amount(f.collectedToday.refunded)} paid back`
        : "Money received, less refunds",
      href: `/sales/payments${salesListSearch({ list: "payments", show: "received", from: o.today, to: o.today })}`,
    },
    {
      label: "Waiting to deliver",
      figure: { count: f.toDeliver.count },
      caption:
        f.toDeliver.late > 0
          ? `${count(f.toDeliver.late)} past the ship-by day`
          : `Orders worth ${amount(f.toDeliver.value)}`,
      href: "/sales/orders",
      alert: f.toDeliver.late > 0,
    },
    {
      label: "Dues outstanding",
      figure: { amount: f.outstanding.value },
      caption: `${count(f.outstanding.count)} unpaid invoice${f.outstanding.count === 1 ? "" : "s"}`,
      href: "/sales/invoices",
    },
    {
      label: "Overdue",
      figure: { amount: f.overdue.value },
      caption: `${count(f.overdue.count)} invoice${f.overdue.count === 1 ? "" : "s"} past due`,
      href: `/sales/invoices${salesListSearch({ list: "invoices", q: "", status: "OVERDUE" })}`,
      alert: f.overdue.count > 0,
    },
    {
      label: "Open quotations",
      figure: { count: f.openQuotations },
      caption: "Draft or sent, waiting on the buyer",
      href: "/sales/quotations",
    },
    {
      label: "PIs waiting for advance",
      figure: { count: f.awaitingAdvance },
      caption: "Production starts when it is paid",
      href: `/sales/proformas${salesListSearch({ list: "proformas", status: "ISSUED" })}`,
    },
  ];
}

/** Today's sales figures as tappable tiles, each opening the list behind it. */
export function OverviewFigures({ overview }: { overview: SalesOverview }) {
  return (
    <ul
      className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4"
      aria-label="Today in sales"
    >
      {tilesFor(overview).map((tile) => (
        <li key={tile.label} className="min-w-0">
          <Link
            href={tile.href}
            className={cn(
              "group flex h-full min-w-0 flex-col rounded-lg border bg-card p-4 transition-colors outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/25 sm:p-5",
              tile.alert && "border-destructive/30",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="eyebrow">{tile.label}</span>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
            <span
              className={cn(
                "mt-3 font-serif text-[1.5rem] leading-tight tracking-tight break-words tabular-nums sm:text-[1.75rem]",
                tile.alert ? "text-destructive" : "text-primary",
              )}
            >
              {"count" in tile.figure
                ? formatCount(tile.figure.count, overview.currency)
                : groupAmount(tile.figure.amount, overview.currency)}
            </span>
            <span className="mt-1 text-[0.8125rem] text-muted-foreground">
              {"amount" in tile.figure ? `${overview.currency} · ` : ""}
              {tile.caption}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
